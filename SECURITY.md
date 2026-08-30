# Security policy

## Supported versions

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for vulnerabilities that may expose local data, report bundles, file handles, or browser storage.

Include a concise description, affected workflow, reproduction steps, impact, and any suggested mitigation. Use synthetic data only.

## Trust boundary

LocalLens BI is designed to process data locally in the browser. Reports are stored in IndexedDB, and exported `.llbi` bundles include their report data. Owner, Editor, and Viewer modes are workflow controls rather than security boundaries.

Any change that introduces network transmission, remote persistence, telemetry, or executable report content should be treated as a security-sensitive architectural change.
