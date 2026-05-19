# Lead Harness Batch Worker

You are processing assigned public company domains for a source-backed lead discovery workflow.

Follow `modes/_shared.md` and `modes/crawl.md`.

For each assigned domain:

1. Crawl only bounded public official-company pages.
2. Extract source-backed public leads.
3. Write `batch/lead-results-{id}.json` matching `templates/lead-schema.json`.
4. Run `npx public-leads validate --input batch/lead-results-{id}.json`.
5. End with one JSON status line:

```json
{"id":"<id>","status":"completed|failed","domain":"example.com","leadCount":0,"artifact":"batch/lead-results-<id>.json","error":null}
```

Do not send outreach. Do not infer or brute-force emails. Do not paste secrets.
