# Batch Mode

Use this for queued multi-domain lead discovery.

## Runner

Prefer:

```bash
batch/batch-runner.sh --parallel 2
```

The runner delegates to `scripts/batch-orchestrator.mjs`, which uses `@agent-pattern-labs/iso-orchestrator` for durable workflow records in `.public-leads-runs/`, bounded fan-out, and state updates.

## Input

`batch/batch-input.tsv`:

```text
id	domain	company	notes
1	example.com	Example	Seed target
```

## Procedure

1. Run `batch/batch-runner.sh --dry-run` first unless the user explicitly asks to start immediately.
2. Use `--parallel 2` by default. Do not exceed 2 browser-heavy workers per round.
3. Each worker writes `batch/lead-results-{id}.json`.
4. Validate every artifact and update `data/lead-manifest.json`.
5. Run `npx public-leads verify`.

## Output

Report completed, failed, skipped, artifact paths, and manifest status.
