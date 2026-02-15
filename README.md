# Conveyance Assessment Cross-Reference

This repository now has two workspace projects:

- `packages/pipeline`: Python data pipeline wrappers
- `app`: Vite + React + Tailwind static UI

## Prereqs

- Python virtual environment at `.venv` with pipeline deps installed
- `pnpm` 10+

## Install

```bash
pnpm install
```

## Pipeline

Run the full data build:

```bash
pnpm pipeline:build
```

Outputs include:

- `chain-of-title.json`
- `working/cross_reference_rows.json`
- `working/conveyance_assessment_data.json`
- `conveyance_assessment_analysis.xlsx`

## Site

Copy pipeline outputs + PDFs into `app/public`:

```bash
pnpm site:prepare-data
```

Start local dev:

```bash
pnpm site:dev
```

Build static site:

```bash
pnpm site:build
```

## End-to-end

```bash
pnpm build
```
