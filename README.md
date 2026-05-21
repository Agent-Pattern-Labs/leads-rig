# @agent-pattern-labs/leads-rig

Agentic public-web lead discovery harness for portable, source-backed lead artifacts. It uses a package-oriented harness shape with an installable npm package, `iso/` source for multi-agent config, mode files, deterministic local helpers, batch orchestration, and a verifier gate.

## What It Does

- Crawls public company websites through agent workflows.
- Produces source-backed lead artifacts matching the local lead-ingest contract.
- Validates lead JSON/JSONL before database handoff.
- Builds a local manifest for batch auditability.
- Submits validated payloads to a configured ingest API.
- Ships OpenCode, Claude Code, Cursor, Codex, and Pi harness config from one `iso/` source.

## Core Commands

```bash
npm install
npm run verify
npm run smoke:iso

npx -p @agent-pattern-labs/leads-rig create-public-leads-harness my-lead-project
npx public-leads crawl --domains example.com --out data/lead-results.json
PUBLIC_LEADS_API=https://cold-agent-leads.example.com npx public-leads pipeline --input data/domains.tsv --ingest
npx public-leads validate --input examples/sample-leads.json
PUBLIC_LEADS_API=https://cold-agent-leads.example.com npx public-leads ingest --input examples/sample-leads.json --dry-run --out output/sample-ingest.json
batch/batch-runner.sh --help
```

## Reference Ingest Handoff

The default reference client posts to the Cold Agent Leads ingest API:

```http
POST /api/lead-ingests
Authorization: Bearer $PUBLIC_LEADS_API_TOKEN
X-Admin-Email: admin@example.com
Content-Type: application/json
```

For upstream ingest, set `PUBLIC_LEADS_API`, `PUBLIC_LEADS_API_TOKEN`, and `PUBLIC_LEADS_OPERATOR_EMAIL`; no local Postgres or local Cold Agent Leads server is required. Endpoint details are configurable through environment variables, `config/profile.yml`, or CLI flags. `--target-project /path/to/cold-agent-leads` remains available only as compatibility for reading a local app `.env`. Payloads contain `jobId`, `domains`, `leads`, `results`, and `errors`, with the schema defined in `templates/lead-schema.json`.

Run from a Cold Agent Leads checkout without installing local package dependencies:

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

Legacy aliases `lead-harness` and `create-leads-harness` remain available for compatibility.

## Publishing

The npm package publishes as `@agent-pattern-labs/leads-rig` with public scoped access. The GitHub Actions publish workflow expects `NPM_TOKEN` to be available as a repo or organization secret.

```bash
gh workflow run publish.yml --ref main
gh run watch
```

You can also publish by creating a GitHub release for the package version:

```bash
gh release create v0.1.4 --title v0.1.4 --generate-notes
```

The package version must not already exist on npm.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONSTRUCTION.md](docs/CONSTRUCTION.md), [docs/SETUP.md](docs/SETUP.md), and [batch/README.md](batch/README.md).
