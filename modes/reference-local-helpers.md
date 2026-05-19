# Local Helper Reference

Use deterministic helpers instead of repeating schema logic in prompts.

| Need | Command |
|---|---|
| Validate a lead artifact | `npx public-leads validate --input <file>` |
| Build/update manifest | `npx public-leads manifest --input <file>` |
| Dry-run ingest | `npx public-leads ingest --input <file> --dry-run` |
| Live ingest | `npx public-leads ingest --input <file>` |
| Full gate | `npx public-leads verify` |
| Batch dry-run | `batch/batch-runner.sh --dry-run` |
| Batch execute | `batch/batch-runner.sh --parallel 2` |
