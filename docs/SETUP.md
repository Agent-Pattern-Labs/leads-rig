# Setup

## Harness Development

```bash
npm install
npm run verify
npm run smoke:iso
```

Build generated harness config locally:

```bash
npm run build:config
```

The generated config files are ignored in git. They are created for local smoke testing and during package packing.

## Consumer Project

```bash
npx create-public-leads-harness my-lead-project
cd my-lead-project
npm install
```

Then edit:

- `config/profile.yml`
- `data/domains.tsv`

Use environment variables for secrets:

```bash
export PUBLIC_LEADS_API_TOKEN=...
```

## Validate A Payload

```bash
npx public-leads validate --input examples/sample-leads.json
```

## Dry-Run Ingest

```bash
npx public-leads ingest --input examples/sample-leads.json --dry-run --out output/sample-ingest.json
```

## Live Ingest

```bash
npx public-leads ingest --input data/lead-results.json --api https://api.example.com
```

Required request settings come from flags, environment, or `config/profile.yml`:

- `api.base_url`
- `api.ingest_path`
- `api.operator_email`
- `api.operator_email_header`
- `api.auth_header`
- `api.auth_scheme`
- `api.auth_token_env`

## Batch

Create `batch/batch-input.tsv`:

```text
id	domain	company	notes
1	example.com	Example	Seed target
```

Run:

```bash
batch/batch-runner.sh --dry-run
batch/batch-runner.sh --parallel 2
```
