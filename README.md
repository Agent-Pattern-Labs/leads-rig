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
npx public-leads pipeline --input data/domains.tsv --ingest --target-project /path/to/cold-agent-leads
npx public-leads validate --input examples/sample-leads.json
npx public-leads ingest --input examples/sample-leads.json --dry-run --out output/sample-ingest.json
batch/batch-runner.sh --help
```

## Reference Ingest Handoff

The default reference client posts to the Cold Agent Leads ingest API:

```http
POST /api/lead-ingests
Authorization: Bearer $ADMIN_API_TOKEN
X-Admin-Email: admin@example.com
Content-Type: application/json
```

All endpoint details are configurable through `config/profile.yml`, CLI flags, environment variables, or `--target-project /path/to/cold-agent-leads` for reading that app's `.env` at runtime. Payloads contain `jobId`, `domains`, `leads`, `results`, and `errors`, with the schema defined in `templates/lead-schema.json`.

Legacy aliases `lead-harness` and `create-leads-harness` remain available for compatibility.

## Publishing

The npm package publishes as `@agent-pattern-labs/leads-rig` with public scoped access. The GitHub Actions publish workflow expects `NPM_TOKEN` to be available as a repo or organization secret.

```bash
gh workflow run publish.yml --ref main
gh run watch
```

You can also publish by creating a GitHub release for the package version:

```bash
gh release create v0.1.3 --title v0.1.3 --generate-notes
```

The package version must not already exist on npm.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONSTRUCTION.md](docs/CONSTRUCTION.md), [docs/SETUP.md](docs/SETUP.md), and [batch/README.md](batch/README.md).
