# LocalLens BI

LocalLens BI is an open-source, local-first analytics workbench for people who
need the quick CSV-to-report workflow of a desktop BI tool without uploading
their data or deploying a database server.

## What works today

- Import a CSV file directly in the browser
- Infer number, date, and text fields
- Group by any detected dimension
- Calculate sums, averages, and row counts
- Switch between bar, line, area, and donut charts
- Filter the active dimension
- Inspect the first 100 source rows
- Export the current analysis result as JSON
- Save view settings and theme locally in the browser
- Use the included retail sample immediately

Imported rows stay in the active browser tab. They are not sent to an
application server.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
```

## Scope

This first release deliberately focuses on a coherent local-file analysis
loop. It does not yet implement relationships between multiple tables, DAX,
database connectors, collaboration, or scheduled refreshes.

The market research and selection rationale are in
[`RESEARCH.md`](./RESEARCH.md).

## License

MIT
