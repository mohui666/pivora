export type DataLakeProvider = 's3' | 'azure' | 'gcs' | 'manifest';

export type DataLakeObject = {
  id: string;
  provider: DataLakeProvider;
  key: string;
  name: string;
  url: string;
  size?: number;
  lastModified?: string;
  requestHeaders?: Record<string, string>;
};

export type DataLakeDiscovery = {
  objects: DataLakeObject[];
  scanned: number;
  truncated: boolean;
};

export type DataLakeDiscoveryOptions = {
  provider: DataLakeProvider;
  endpoint: string;
  prefix?: string;
  headers?: Record<string, string>;
  maxObjects?: number;
};

type FetchLike = typeof fetch;

const SUPPORTED_EXTENSIONS = new Set([
  'csv',
  'json',
  'xml',
  'parquet',
  'xlsx',
  'xls',
  'xlsm',
  'sqlite',
  'sqlite3',
  'db',
]);
const MAX_DISCOVERED_OBJECTS = 1_000;
const MAX_REMOTE_OBJECT_BYTES = 512 * 1024 * 1024;

function boundedObjectCount(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isFinite(value)) return 100;
  return Math.min(MAX_DISCOVERED_OBJECTS, Math.max(1, Math.floor(value)));
}

function requireHttpUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${label} must be an HTTP or HTTPS URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must be an HTTP or HTTPS URL.`);
  }
  return url;
}

function decodeXml(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/giu,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hexadecimal)
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      return (
        {
          amp: '&',
          apos: "'",
          gt: '>',
          lt: '<',
          quot: '"',
        }[named.toLowerCase()] ?? entity
      );
    },
  );
}

function xmlBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`,
    'giu',
  );
  return Array.from(xml.matchAll(pattern), (match) => match[1] ?? '');
}

function xmlValue(xml: string, tag: string): string {
  return decodeXml(xmlBlocks(xml, tag)[0]?.trim() ?? '');
}

function encodeObjectPath(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function objectUrl(base: URL, key: string): string {
  const url = new URL(base.href);
  url.pathname = `${base.pathname.replace(/\/?$/u, '/')}${encodeObjectPath(key)}`;
  return url.href;
}

function objectName(key: string): string {
  return key.split('/').filter(Boolean).at(-1) ?? key;
}

function createObject(
  provider: DataLakeProvider,
  key: string,
  url: string,
  size?: number,
  lastModified?: string,
  requestHeaders?: Record<string, string>,
): DataLakeObject {
  return {
    id: `${provider}:${key}:${url}`,
    provider,
    key,
    name: objectName(key),
    url,
    size: Number.isFinite(size) ? size : undefined,
    lastModified: lastModified || undefined,
    requestHeaders,
  };
}

async function responseText(response: Response, activity: string) {
  if (!response.ok) {
    throw new Error(`${activity} returned HTTP ${response.status}.`);
  }
  return response.text();
}

function supportedOnly(objects: DataLakeObject[], maximum: number) {
  const supported = objects.filter((object) =>
    isSupportedDataLakeObject(object),
  );
  return {
    objects: supported.slice(0, maximum),
    scanned: objects.length,
    truncated: supported.length > maximum,
  };
}

function shouldContinueDiscovery(
  objects: DataLakeObject[],
  maximum: number,
): boolean {
  const scanLimit = Math.min(10_000, Math.max(100, maximum * 20));
  return (
    objects.length < scanLimit &&
    objects.filter((object) => isSupportedDataLakeObject(object)).length <=
      maximum
  );
}

async function discoverS3(
  options: DataLakeDiscoveryOptions,
  fetcher: FetchLike,
): Promise<DataLakeDiscovery> {
  const base = requireHttpUrl(options.endpoint, 'S3 container URL');
  const maximum = boundedObjectCount(options.maxObjects);
  const objects: DataLakeObject[] = [];
  let continuation = '';
  let more = true;

  while (more && shouldContinueDiscovery(objects, maximum)) {
    const listUrl = new URL(base.href);
    listUrl.searchParams.set('list-type', '2');
    listUrl.searchParams.set('encoding-type', 'url');
    listUrl.searchParams.set('max-keys', String(Math.min(1_000, maximum + 1)));
    if (options.prefix) listUrl.searchParams.set('prefix', options.prefix);
    if (continuation)
      listUrl.searchParams.set('continuation-token', continuation);
    const response = await fetcher(listUrl, {
      cache: 'no-store',
      headers: options.headers,
    });
    const xml = await responseText(response, 'S3 object listing');
    const page = xmlBlocks(xml, 'Contents').map((entry) => {
      const encodedKey = xmlValue(entry, 'Key');
      const key = (() => {
        try {
          return decodeURIComponent(encodedKey);
        } catch {
          return encodedKey;
        }
      })();
      return createObject(
        's3',
        key,
        objectUrl(base, key),
        Number(xmlValue(entry, 'Size')),
        xmlValue(entry, 'LastModified'),
      );
    });
    objects.push(...page);
    more = xmlValue(xml, 'IsTruncated').toLowerCase() === 'true';
    continuation = xmlValue(xml, 'NextContinuationToken');
    if (more && !continuation) {
      throw new Error('S3 listing was truncated without a continuation token.');
    }
  }

  const result = supportedOnly(objects, maximum);
  return { ...result, truncated: result.truncated || more };
}

async function discoverAzure(
  options: DataLakeDiscoveryOptions,
  fetcher: FetchLike,
): Promise<DataLakeDiscovery> {
  const base = requireHttpUrl(options.endpoint, 'Azure container URL');
  const maximum = boundedObjectCount(options.maxObjects);
  const objects: DataLakeObject[] = [];
  let marker = '';
  let more = true;

  while (more && shouldContinueDiscovery(objects, maximum)) {
    const listUrl = new URL(base.href);
    listUrl.searchParams.set('restype', 'container');
    listUrl.searchParams.set('comp', 'list');
    listUrl.searchParams.set(
      'maxresults',
      String(Math.min(5_000, maximum + 1)),
    );
    if (options.prefix) listUrl.searchParams.set('prefix', options.prefix);
    if (marker) listUrl.searchParams.set('marker', marker);
    const response = await fetcher(listUrl, {
      cache: 'no-store',
      headers: options.headers,
    });
    const xml = await responseText(response, 'Azure Blob listing');
    objects.push(
      ...xmlBlocks(xml, 'Blob').map((entry) => {
        const key = xmlValue(entry, 'Name');
        return createObject(
          'azure',
          key,
          objectUrl(base, key),
          Number(xmlValue(entry, 'Content-Length')),
          xmlValue(entry, 'Last-Modified'),
        );
      }),
    );
    marker = xmlValue(xml, 'NextMarker');
    more = Boolean(marker);
  }

  const result = supportedOnly(objects, maximum);
  return { ...result, truncated: result.truncated || more };
}

function parseGcsLocation(raw: string): { bucket: string; prefix: string } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Google Cloud Storage bucket is required.');
  if (!trimmed.includes('://')) return { bucket: trimmed, prefix: '' };
  const url = new URL(trimmed);
  if (url.protocol === 'gs:') {
    return {
      bucket: url.hostname,
      prefix: decodeURIComponent(url.pathname.replace(/^\//u, '')),
    };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Google Cloud Storage bucket is invalid.');
  }
  if (url.hostname.endsWith('.storage.googleapis.com')) {
    return {
      bucket: url.hostname.slice(0, -'.storage.googleapis.com'.length),
      prefix: decodeURIComponent(url.pathname.replace(/^\//u, '')),
    };
  }
  if (url.hostname === 'storage.googleapis.com') {
    const [bucket, ...parts] = url.pathname.split('/').filter(Boolean);
    if (!bucket) throw new Error('Google Cloud Storage bucket is invalid.');
    return { bucket, prefix: decodeURIComponent(parts.join('/')) };
  }
  throw new Error('Google Cloud Storage bucket is invalid.');
}

async function discoverGcs(
  options: DataLakeDiscoveryOptions,
  fetcher: FetchLike,
): Promise<DataLakeDiscovery> {
  const location = parseGcsLocation(options.endpoint);
  const maximum = boundedObjectCount(options.maxObjects);
  const prefix = [location.prefix, options.prefix]
    .filter(Boolean)
    .join('/')
    .replace(/\/{2,}/gu, '/');
  const objects: DataLakeObject[] = [];
  let pageToken = '';
  let more = true;

  while (more && shouldContinueDiscovery(objects, maximum)) {
    const listUrl = new URL(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(location.bucket)}/o`,
    );
    listUrl.searchParams.set(
      'maxResults',
      String(Math.min(1_000, maximum + 1)),
    );
    if (prefix) listUrl.searchParams.set('prefix', prefix);
    if (pageToken) listUrl.searchParams.set('pageToken', pageToken);
    const response = await fetcher(listUrl, {
      cache: 'no-store',
      headers: options.headers,
    });
    const text = await responseText(response, 'Google Cloud Storage listing');
    const payload = JSON.parse(text) as {
      items?: Array<{
        name?: string;
        size?: string;
        updated?: string;
        mediaLink?: string;
      }>;
      nextPageToken?: string;
    };
    for (const item of payload.items ?? []) {
      if (!item.name) continue;
      const downloadUrl =
        item.mediaLink ??
        `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(location.bucket)}/o/${encodeURIComponent(item.name)}?alt=media`;
      objects.push(
        createObject(
          'gcs',
          item.name,
          downloadUrl,
          Number(item.size),
          item.updated,
        ),
      );
    }
    pageToken = payload.nextPageToken ?? '';
    more = Boolean(pageToken);
  }

  const result = supportedOnly(objects, maximum);
  return { ...result, truncated: result.truncated || more };
}

function manifestRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const objects = (value as { objects?: unknown }).objects;
    if (Array.isArray(objects)) return objects;
  }
  throw new Error('A data lake manifest must contain an object URL array.');
}

async function discoverManifest(
  options: DataLakeDiscoveryOptions,
  fetcher: FetchLike,
): Promise<DataLakeDiscovery> {
  const manifestUrl = requireHttpUrl(options.endpoint, 'Manifest URL');
  const manifestDirectory = decodeURIComponent(
    new URL('.', manifestUrl).pathname,
  );
  const maximum = boundedObjectCount(options.maxObjects);
  const response = await fetcher(manifestUrl, {
    cache: 'no-store',
    headers: options.headers,
  });
  const text = await responseText(response, 'Data lake manifest');
  let rows: unknown[];
  try {
    rows = manifestRows(JSON.parse(text) as unknown);
  } catch (error) {
    if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
      throw error;
    }
    rows = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const objects = rows.flatMap((row) => {
    const descriptor =
      typeof row === 'string'
        ? { url: row }
        : row && typeof row === 'object'
          ? (row as Record<string, unknown>)
          : undefined;
    if (!descriptor || typeof descriptor.url !== 'string') return [];
    const url = requireHttpUrl(
      new URL(descriptor.url, manifestUrl).href,
      'Manifest object URL',
    );
    const key =
      typeof descriptor.key === 'string'
        ? descriptor.key
        : typeof descriptor.name === 'string'
          ? descriptor.name
          : (() => {
              const objectPath = decodeURIComponent(url.pathname);
              const relativePath =
                url.origin === manifestUrl.origin &&
                objectPath.startsWith(manifestDirectory)
                  ? objectPath.slice(manifestDirectory.length)
                  : objectPath.replace(/^\/+/, '');
              return relativePath || 'data';
            })();
    if (options.prefix && !key.startsWith(options.prefix)) return [];
    const requestHeaders =
      descriptor.headers &&
      typeof descriptor.headers === 'object' &&
      !Array.isArray(descriptor.headers) &&
      Object.values(descriptor.headers).every(
        (value) => typeof value === 'string',
      )
        ? (descriptor.headers as Record<string, string>)
        : undefined;
    return [
      createObject(
        'manifest',
        key,
        url.href,
        typeof descriptor.size === 'number' ? descriptor.size : undefined,
        typeof descriptor.lastModified === 'string'
          ? descriptor.lastModified
          : undefined,
        requestHeaders,
      ),
    ];
  });
  return supportedOnly(objects, maximum);
}

export function parseSessionHeaders(input: string): Record<string, string> {
  if (!input.trim()) return {};
  const candidate = JSON.parse(input) as unknown;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate) ||
    Object.values(candidate).some((value) => typeof value !== 'string')
  ) {
    throw new Error('Request headers must be a JSON object of strings.');
  }
  return candidate as Record<string, string>;
}

export function isSupportedDataLakeObject(
  object: Pick<DataLakeObject, 'name'>,
) {
  const extension = object.name.split('.').at(-1)?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS.has(extension);
}

export function safeDataLakeSourceLabel(rawUrl: string): string {
  const url = requireHttpUrl(rawUrl, 'Data lake object URL');
  return `${url.origin}${url.pathname}`;
}

export async function discoverDataLakeObjects(
  options: DataLakeDiscoveryOptions,
  fetcher: FetchLike = fetch,
): Promise<DataLakeDiscovery> {
  if (options.provider === 's3') return discoverS3(options, fetcher);
  if (options.provider === 'azure') return discoverAzure(options, fetcher);
  if (options.provider === 'gcs') return discoverGcs(options, fetcher);
  return discoverManifest(options, fetcher);
}

export async function downloadDataLakeObject(
  object: DataLakeObject,
  sessionHeaders: Record<string, string> = {},
  fetcher: FetchLike = fetch,
): Promise<File> {
  const url = requireHttpUrl(object.url, 'Data lake object URL');
  const response = await fetcher(url, {
    cache: 'no-store',
    headers: { ...sessionHeaders, ...object.requestHeaders },
  });
  if (!response.ok) {
    throw new Error(
      `Data lake object “${object.name}” returned HTTP ${response.status}.`,
    );
  }
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > MAX_REMOTE_OBJECT_BYTES) {
    throw new Error(`Data lake object “${object.name}” exceeds 512 MB.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_REMOTE_OBJECT_BYTES) {
    throw new Error(`Data lake object “${object.name}” exceeds 512 MB.`);
  }
  return new File([bytes], object.name, {
    type: response.headers.get('content-type') ?? '',
  });
}
