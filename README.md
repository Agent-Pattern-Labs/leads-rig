# public-leads-harness

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

npx public-leads validate --input examples/sample-leads.json
npx public-leads ingest --input examples/sample-leads.json --dry-run --out output/sample-ingest.json
batch/batch-runner.sh --help
```

## Reference Ingest Handoff

The default reference client posts to:

```http
POST /api/lead-ingests
Authorization: Bearer $PUBLIC_LEADS_API_TOKEN
X-Operator-Email: ops@example.com
Content-Type: application/json
```

All endpoint details are configurable through `config/profile.yml`, CLI flags, or environment variables. Payloads contain `jobId`, `domains`, `leads`, `results`, and `errors`, with the schema defined in `templates/lead-schema.json`.

Legacy aliases `lead-harness` and `create-leads-harness` remain available for compatibility.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SETUP.md](docs/SETUP.md), and [batch/README.md](batch/README.md).
