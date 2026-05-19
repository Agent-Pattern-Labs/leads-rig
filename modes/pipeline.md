# Pipeline Mode

Use this when the user supplies a list of domains or wants the local domain queue processed.

## Inputs

Read domains from the first available source:

1. Domains in the user's request.
2. `data/domains.tsv` with columns `domain`, optional `company`, optional `notes`.
3. `data/pipeline.md` checkbox lines such as `- [ ] example.com | Example | notes`.

## Procedure

1. Build a deduped candidate list.
2. Drop domains already represented in the manifest unless the user asks to retry.
3. Prefer the deterministic end-to-end command for normal public pages:
   `npx public-leads pipeline --input data/domains.tsv --out data/lead-results.json`
4. Use browser/MCP workers only when the deterministic crawler cannot reach a public page or the site requires rendering.
5. For browser-heavy batch work, use `batch/batch-runner.sh --parallel 2`.
6. Validate every artifact with `npx public-leads validate`.
7. Merge validated artifacts into a manifest with `npx public-leads manifest --input <artifact>`.
8. Ingest with `npx public-leads pipeline --ingest --target-project /path/to/cold-agent-leads` only when upload is requested.

## Output

List processed artifact paths, validation status, manifest path, and the next ingest command.
