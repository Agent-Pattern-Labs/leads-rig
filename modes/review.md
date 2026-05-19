# Review Mode

Use this to inspect local lead artifacts, manifest state, or ingest responses.

## Procedure

1. Run `npx public-leads verify`.
2. Inspect `data/lead-manifest.json` if present.
3. Validate any specific artifact requested by the user.
4. Summarize counts by domain and `emailType`.
5. Surface validation errors before summaries.

## Output

Findings first, then concise summary and next action.
