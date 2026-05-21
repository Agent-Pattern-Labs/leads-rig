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
export PUBLIC_LEADS_API=https://cold-agent-leads.example.com
export PUBLIC_LEADS_API_TOKEN=...
export PUBLIC_LEADS_OPERATOR_EMAIL=admin@example.com
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
PUBLIC_LEADS_API=https://cold-agent-leads.example.com npx public-leads ingest --input examples/sample-leads.json --dry-run --out output/sample-ingest.json
```

## Live Ingest

```bash
npx public-leads pipeline --input data/domains.tsv --ingest
npx public-leads ingest --input data/lead-results.json
```

Run from `/Users/charlie/Razroo/cold-agent-leads` without local Postgres or a local API:

```bash
cd /Users/charlie/Razroo/cold-agent-leads
export PUBLIC_LEADS_API=https://cold-agent-leads.example.com
export PUBLIC_LEADS_API_TOKEN=...
export PUBLIC_LEADS_OPERATOR_EMAIL=admin@example.com
npx -p @agent-pattern-labs/leads-rig public-leads pipeline \
  --domains example.com \
  --ingest \
  --out data/lead-results.json \
  --manifest data/lead-manifest.json \
  --ingest-out data/ingest-response.json
```

Required request settings come from flags, environment, or `config/profile.yml`:

- `api.base_url`
- `api.ingest_path`
- `api.operator_email`
- `api.operator_email_header`
- `api.auth_header`
- `api.auth_scheme`
- `api.auth_token_env`

Use `api.target_project` only when intentionally reading credentials from a local Cold Agent Leads checkout. Upstream ingest should use `PUBLIC_LEADS_API`, `PUBLIC_LEADS_API_TOKEN`, and `PUBLIC_LEADS_OPERATOR_EMAIL`.

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
