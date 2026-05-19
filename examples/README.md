# Examples

`sample-leads.json` is a fictional artifact that matches the local lead-ingest
payload shape. Use it for local validation smoke tests:

```bash
npx public-leads validate --input examples/sample-leads.json
npx public-leads ingest --input examples/sample-leads.json --dry-run --out output/sample-ingest.json
```
