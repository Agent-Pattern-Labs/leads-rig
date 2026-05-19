# Ingest Mode

Use this when the user asks to store validated leads in a configured ingest API.

## Preflight

1. Validate the artifact:
   ```bash
   npx public-leads validate --input <artifact>
   ```
2. Update the manifest:
   ```bash
   npx public-leads manifest --input <artifact>
   ```
3. Confirm ingest credentials and request settings are available through `config/profile.yml` and the configured environment variable. Do not print token values.

## Dry Run

Use dry-run before live ingest unless the user explicitly requested live submission:

```bash
npx public-leads ingest --input <artifact> --dry-run --out data/ingest-response.json
```

## Live Ingest

```bash
npx public-leads ingest --input <artifact> --target-project /path/to/cold-agent-leads --out data/ingest-response.json
```

## Output

Return HTTP status, job ID if present, lead count, and response artifact path.
