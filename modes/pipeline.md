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
3. For 1-2 domains, crawl inline or dispatch at most two procedural subagents.
4. For 3+ domains, use `batch/batch-runner.sh`.
5. Validate every artifact with `npx public-leads validate`.
6. Merge validated artifacts into a manifest with `npx public-leads manifest --input <artifact>`.
7. Ask for confirmation before real ingest unless the user already requested ingest.

## Output

List processed artifact paths, validation status, manifest path, and the next ingest command.
