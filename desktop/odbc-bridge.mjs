import { spawn } from 'node:child_process';
import { join } from 'node:path';

const BRIDGE_TIMEOUT_MS = 90_000;
const MAX_BRIDGE_OUTPUT_BYTES = 64 * 1024 * 1024;

const POWERSHELL_BRIDGE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = $env:PIVORA_ODBC_REQUEST | ConvertFrom-Json

if ($request.action -eq 'list') {
  Import-Module Wdac -ErrorAction Stop
  $sources = @(
    Get-OdbcDsn -ErrorAction Stop | ForEach-Object {
      [ordered]@{
        name = [string]$_.Name
        driver = [string]$_.DriverName
        type = [string]$_.DsnType
        platform = [string]$_.Platform
      }
    }
  )
  $drivers = @(
    Get-OdbcDriver -ErrorAction Stop | ForEach-Object {
      [ordered]@{
        name = [string]$_.Name
        platform = [string]$_.Platform
      }
    }
  )
  [ordered]@{
    available = $true
    sources = $sources
    drivers = $drivers
  } | ConvertTo-Json -Depth 6 -Compress
  exit 0
}

if ($request.action -ne 'query') {
  throw 'Unsupported ODBC bridge action.'
}

$connection = New-Object System.Data.Odbc.OdbcConnection([string]$request.connectionString)
$reader = $null
$command = $null
$timer = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $connection.Open()
  $command = $connection.CreateCommand()
  $command.CommandText = [string]$request.query
  $command.CommandTimeout = [int]$request.commandTimeoutSeconds
  $reader = $command.ExecuteReader()
  $columns = New-Object System.Collections.Generic.List[string]
  $columnCounts = @{}
  for ($index = 0; $index -lt $reader.FieldCount; $index += 1) {
    $baseName = [string]$reader.GetName($index)
    if ([string]::IsNullOrWhiteSpace($baseName)) {
      $baseName = "Column$($index + 1)"
    }
    $count = 1
    if ($columnCounts.ContainsKey($baseName)) {
      $count = [int]$columnCounts[$baseName] + 1
    }
    $columnCounts[$baseName] = $count
    $columns.Add($(if ($count -eq 1) { $baseName } else { "{0}_{1}" -f $baseName, $count }))
  }

  $rows = New-Object System.Collections.Generic.List[object]
  $truncated = $false
  while ($reader.Read()) {
    if ($rows.Count -ge [int]$request.maxRows) {
      $truncated = $true
      break
    }
    $row = [ordered]@{}
    for ($index = 0; $index -lt $reader.FieldCount; $index += 1) {
      if ($reader.IsDBNull($index)) {
        $value = $null
      } else {
        $value = $reader.GetValue($index)
        if ($value -is [byte[]]) {
          $value = "[binary $($value.Length) bytes]"
        } elseif ($value -is [DateTime]) {
          $value = $value.ToString('o')
        } elseif ($value -is [DateTimeOffset]) {
          $value = $value.ToString('o')
        } elseif ($value -is [Guid] -or $value -is [TimeSpan]) {
          $value = $value.ToString()
        }
      }
      $row[$columns[$index]] = $value
    }
    $rows.Add($row)
  }
  $timer.Stop()
  [ordered]@{
    columns = @($columns)
    rows = @($rows)
    truncated = $truncated
    durationMs = [Math]::Round($timer.Elapsed.TotalMilliseconds, 2)
    driver = [string]$connection.Driver
    dataSource = [string]$connection.DataSource
    database = [string]$connection.Database
  } | ConvertTo-Json -Depth 8 -Compress
} finally {
  if ($reader) { $reader.Dispose() }
  if ($command) { $command.Dispose() }
  $connection.Dispose()
}
`;

function stripSqlLiteralsAndComments(sql) {
  let output = '';
  let state = 'plain';
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (state === 'line-comment') {
      if (character === '\n') {
        state = 'plain';
        output += '\n';
      } else {
        output += ' ';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        output += '  ';
        index += 1;
        state = 'plain';
      } else {
        output += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'single-quote') {
      if (character === "'" && next === "'") {
        output += '  ';
        index += 1;
      } else if (character === "'") {
        output += ' ';
        state = 'plain';
      } else {
        output += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'double-quote') {
      if (character === '"' && next === '"') {
        output += '  ';
        index += 1;
      } else if (character === '"') {
        output += ' ';
        state = 'plain';
      } else {
        output += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'bracket') {
      if (character === ']' && next === ']') {
        output += '  ';
        index += 1;
      } else if (character === ']') {
        output += ' ';
        state = 'plain';
      } else {
        output += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (character === '-' && next === '-') {
      output += '  ';
      index += 1;
      state = 'line-comment';
    } else if (character === '/' && next === '*') {
      output += '  ';
      index += 1;
      state = 'block-comment';
    } else if (character === "'") {
      output += ' ';
      state = 'single-quote';
    } else if (character === '"') {
      output += ' ';
      state = 'double-quote';
    } else if (character === '[') {
      output += ' ';
      state = 'bracket';
    } else {
      output += character;
    }
  }
  if (state !== 'plain' && state !== 'line-comment') {
    throw new Error(
      'The ODBC query contains an unterminated SQL literal or comment.',
    );
  }
  return output;
}

export function assertReadOnlyOdbcSql(sql) {
  const query = String(sql ?? '').trim();
  if (!query) throw new Error('Enter an ODBC SQL query.');
  if (query.length > 16_000) {
    throw new Error('The ODBC SQL query exceeds 16,000 characters.');
  }
  let sanitized = stripSqlLiteralsAndComments(query).trim();
  const trailingSemicolon = sanitized.endsWith(';');
  if (trailingSemicolon) sanitized = sanitized.slice(0, -1).trimEnd();
  if (sanitized.includes(';')) {
    throw new Error('Run one read-only ODBC statement at a time.');
  }
  if (!/^(select|with)\b/iu.test(sanitized)) {
    throw new Error('The ODBC bridge accepts SELECT and WITH queries only.');
  }
  if (
    /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|exec|execute|copy|attach|detach|pragma|vacuum|replace|upsert|into)\b/iu.test(
      sanitized,
    )
  ) {
    throw new Error('The ODBC bridge rejected a write-capable SQL keyword.');
  }
  return trailingSemicolon ? query.replace(/;\s*$/u, '') : query;
}

export function normalizeOdbcQueryRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('The ODBC request is invalid.');
  }
  const connectionString = String(request.connectionString ?? '').trim();
  if (!connectionString) throw new Error('Enter an ODBC connection string.');
  if (connectionString.length > 4_096) {
    throw new Error('The ODBC connection string exceeds 4,096 characters.');
  }
  return {
    connectionString,
    query: assertReadOnlyOdbcSql(request.query),
    maxRows: Math.min(
      100_000,
      Math.max(1, Math.floor(Number(request.maxRows) || 10_000)),
    ),
    commandTimeoutSeconds: Math.min(
      120,
      Math.max(5, Math.floor(Number(request.commandTimeoutSeconds) || 30)),
    ),
  };
}

export function redactConnectorSecrets(message) {
  return String(message)
    .replace(
      /((?:pwd|password|access[_ -]?token|secret|token)\s*[=:]\s*)(?:\{[^}]*\}|[^;\s,"}]+)/giu,
      '$1[redacted]',
    )
    .slice(0, 4_000);
}

function powershellPath() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  return systemRoot
    ? join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
    : 'powershell.exe';
}

async function invokeBridge(request) {
  if (process.platform !== 'win32') {
    throw new Error('The ODBC desktop bridge is available on Windows only.');
  }
  const encodedScript = Buffer.from(POWERSHELL_BRIDGE, 'utf16le').toString(
    'base64',
  );
  const child = spawn(
    powershellPath(),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedScript,
    ],
    {
      env: {
        ...process.env,
        PIVORA_ODBC_REQUEST: JSON.stringify(request),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let stdout = '';
  let stderr = '';
  let oversized = false;
  const collect = (target, chunk) => {
    const combined = target + String(chunk);
    if (Buffer.byteLength(combined, 'utf8') > MAX_BRIDGE_OUTPUT_BYTES) {
      oversized = true;
      child.kill();
      return target;
    }
    return combined;
  };
  child.stdout.on('data', (chunk) => {
    stdout = collect(stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = collect(stderr, chunk);
  });

  let timeout;
  const exitCode = await Promise.race([
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    }),
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        child.kill();
        reject(new Error('The ODBC bridge timed out.'));
      }, BRIDGE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timeout));

  if (oversized) throw new Error('The ODBC bridge result exceeded 64 MB.');
  if (exitCode !== 0) {
    throw new Error(
      redactConnectorSecrets(
        stderr.trim() || stdout.trim() || 'The ODBC bridge failed.',
      ),
    );
  }
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error('The ODBC bridge returned an invalid response.');
  }
}

export async function listOdbcSources() {
  if (process.platform !== 'win32') {
    return {
      available: false,
      sources: [],
      drivers: [],
      message: 'The ODBC desktop bridge is available on Windows only.',
    };
  }
  return invokeBridge({ action: 'list' });
}

export async function runOdbcQuery(request) {
  const normalized = normalizeOdbcQueryRequest(request);
  return invokeBridge({ action: 'query', ...normalized });
}
