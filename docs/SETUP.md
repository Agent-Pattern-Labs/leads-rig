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
npx -p @agent-pattern-labs/leads-rig create-public-leads-harness my-lead-project
cd my-lead-project
npm install
```

Then edit:

- `config/profile.yml`
- `data/domains.tsv`

Use environment variables for secrets:

```bash
export ADMIN_API_TOKEN=...
```

## Validate A Payload

```bash
npx public-leads validate --input examples/sample-leads.json
```

## Crawl Domains

```bash
npx public-leads crawl --input data/domains.tsv --out data/lead-results.json
npx public-leads pipeline --input data/domains.tsv --out data/lead-results.json
```

## Dry-Run Ingest

```bash
npx public-leads ingest --input examples/sample-leads.json --dry-run --out output/sample-ingest.json
```

## Live Ingest

```bash
npx public-leads pipeline --input data/domains.tsv --ingest --target-project /path/to/cold-agent-leads
npx public-leads ingest --input data/lead-results.json --target-project /path/to/cold-agent-leads
```

Required request settings come from flags, environment, or `config/profile.yml`:

- `api.base_url`
- `api.ingest_path`
- `api.target_project`
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
