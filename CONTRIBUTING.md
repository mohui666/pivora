# Contributing to LocalLens BI

Thank you for helping make local-first analytics better.

## Ground rules

- Keep imported data on the user's device by default.
- Do not add telemetry, accounts, or outbound data transfer without an explicit design discussion.
- Prefer small, focused changes with clear tests.
- Preserve the no-server quick-start experience.
- Document changes to persistence, file access, or report bundle compatibility.

## Development setup

```bash
git clone https://github.com/mohui666/locallens-bi.git
cd locallens-bi
npm install
npm run dev
```

## Before opening a pull request

```bash
npm test
npm run lint
npm run build
```

Please include:

- The problem being solved
- The chosen behavior and notable tradeoffs
- Test coverage or a concise manual verification procedure
- Screenshots for visible UI changes
- Any impact on local data, IndexedDB, file permissions, or `.llbi` compatibility

## Project structure

- `app/` — application shell and styling
- `components/bi/` — analytics-specific UI
- `lib/data-import.ts` — source adapters
- `lib/bi-model.ts` — semantic model and materialization
- `lib/report-storage.ts` — local persistence
- `lib/*.test.ts` — focused model and import tests

## Reporting bugs

Use a GitHub issue for normal bugs. Include the browser, operating system, source format, reproduction steps, expected behavior, and actual behavior. Do not attach private datasets; use a minimal synthetic sample.

For security issues, follow [`SECURITY.md`](./SECURITY.md).
