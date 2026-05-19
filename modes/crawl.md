# Crawl Mode

Use this for one or more assigned domains.

## Procedure

1. Normalize the domain to lowercase without protocol or `www.`.
2. Visit only bounded public pages from the official site.
3. Prefer the deterministic crawler when no browser-only blocker exists:
   `npx public-leads crawl --input data/domains.tsv --out data/lead-results.json`
4. Extract public email addresses, person names/titles when visible nearby, contact forms, source URLs, page titles, evidence snippets, and warnings.
5. Emit a JSON payload matching `templates/lead-schema.json`.
6. Save the payload to `data/lead-results.json` for single-domain runs or `batch/lead-results-{id}.json` for batch workers.
7. Run `npx public-leads validate --input <artifact>`.
8. Return the artifact path and validation status.

## Output Contract

For worker/batch mode, end with one JSON status line:

```json
{"id":"<id>","status":"completed|failed","domain":"example.com","leadCount":0,"artifact":"batch/lead-results-<id>.json","error":null}
```

No source-backed lead should be described only in prose.
