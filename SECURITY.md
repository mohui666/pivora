# Security policy

## Supported versions

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for vulnerabilities that may expose local data, report bundles, file handles, or browser storage.

Include a concise description, affected workflow, reproduction steps, impact, and any suggested mitigation. Use synthetic data only.

## Trust boundary

Pivora is designed to process data locally in the browser. Reports are stored in IndexedDB, and exported `.pivora` bundles include their report data. Owner, Editor, and Viewer modes are workflow controls rather than security boundaries.

Network access is opt-in. Web/API and data-lake connectors run only after an explicit user action; request headers, SAS parameters, presigned URL queries, ODBC connection strings, and ODBC SQL are session-only and are not written into reports. Imported rows and non-secret source labels do persist. Treat connector endpoints and manifests as untrusted input, and use least-privilege, short-lived credentials.

The Windows desktop ODBC bridge is exposed only to the Pivora loopback origin. It accepts one bounded `SELECT`/`WITH` statement at a time and rejects write-capable SQL keywords, but this lexical guard is not a database authorization boundary. Configure the DSN or database account itself as read-only.

Any change that introduces network transmission, remote persistence, telemetry, or executable report content should be treated as a security-sensitive architectural change.
