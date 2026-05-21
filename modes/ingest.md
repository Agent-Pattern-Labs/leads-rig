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
3. Confirm upstream ingest settings are available through environment variables, flags, or `config/profile.yml`. Do not print token values.
   - `PUBLIC_LEADS_API`
   - `PUBLIC_LEADS_API_TOKEN`
   - `PUBLIC_LEADS_OPERATOR_EMAIL`

## Dry Run

Use dry-run before live ingest unless the user explicitly requested live submission:

```bash
PUBLIC_LEADS_API=https://cold-agent-leads.example.com npx public-leads ingest --input <artifact> --dry-run --out data/ingest-response.json
```

## Live Ingest

```bash
npx public-leads ingest --input <artifact> --out data/ingest-response.json
```

## Output

Return HTTP status, job ID if present, lead count, and response artifact path.
