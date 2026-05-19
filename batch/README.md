# Batch Lead Discovery

`batch/` contains the durable runner for processing many company domains with headless agent workers.

## Input

Create `batch/batch-input.tsv`:

```text
id	domain	company	notes
1	example.com	Example	Seed target
2	example.org	Example Org	Official site
```

## Commands

```bash
batch/batch-runner.sh --dry-run
batch/batch-runner.sh --parallel 2
batch/batch-runner.sh --runner codex --parallel 2
```

The runner writes:

- `batch/batch-state.tsv`
- `batch/logs/*.log`
- `batch/lead-results-*.json`
- `.public-leads-runs/` durable workflow records

After a run:

```bash
npm run verify
npx public-leads ingest --input batch/lead-results-1.json --dry-run
```
