# Architecture

`@agent-pattern-labs/leads-rig` follows a package-oriented harness pattern.

## Package Architecture

The harness repo is the npm package. Consumer projects install it, keep private data locally, and receive shared harness files through symlinks created by `bin/sync.mjs`.

```text
consumer-project/
├── package.json                    # depends on @agent-pattern-labs/leads-rig
├── opencode.json                   # thin local config
├── config/profile.yml              # local API settings and secret env names
├── data/domains.tsv                # local target domains
├── data/lead-manifest.json         # generated, local
├── batch/batch-input.tsv           # local batch queue
├── batch/batch-state.tsv           # generated state
├── batch/lead-results-*.json       # generated lead artifacts
├── AGENTS.md                       # local overrides
├── AGENTS.harness.md               # symlink to package AGENTS.md
├── CLAUDE.harness.md               # symlink to package CLAUDE.md
├── modes/                          # symlink to package modes
├── templates/                      # symlink to package templates
└── node_modules/@agent-pattern-labs/leads-rig/
```

## Source Of Truth

`iso/` is the source for multi-harness agent configuration. `npm run build:config` runs:

```bash
iso-route build models.yaml --out .
iso-harness build
```

This generates:

- `AGENTS.md` / `CLAUDE.md`
- `.opencode/agents/*`
- `.opencode/skills/public-leads.md`
- `.codex/config.toml`
- `.cursor/rules/*`
- `.pi/skills/*`
- `.pi/prompts/*`
- `.mcp.json`

Generated harness config is tracked for Git/source installs and refreshed at package time through `prepack`.

## Runtime Flow

```text
domain input
  -> mode routing (/public-leads pipeline|crawl|batch)
  -> deterministic bounded public crawler or bounded crawl workers
  -> lead JSON artifacts
  -> public-leads validate
  -> public-leads manifest
  -> public-leads ingest
  -> configured lead store or review API
```

## Deterministic Helpers

| Helper | Purpose |
|---|---|
| `scripts/crawl.mjs` | Crawls bounded public company pages and writes lead artifacts |
| `scripts/pipeline.mjs` | Runs crawl, validation, manifest update, and optional ingest |
| `scripts/validate-leads.mjs` | Normalizes and validates JSON/JSONL lead artifacts |
| `scripts/manifest.mjs` | Records validated batches in `data/lead-manifest.json` |
| `scripts/ingest.mjs` | Posts to the configured ingest endpoint |
| `scripts/batch-orchestrator.mjs` | Durable batch runner using `@agent-pattern-labs/iso-orchestrator` |
| `verify-pipeline.mjs` | Repo/consumer health gate |

The package also carries the `@agent-pattern-labs/iso-*` helper ecosystem for trace, guard, ledger, cache, canon, context, preflight, postflight, prioritize, lineage, redact, migrate, score, and timeline commands.

## Data Contract

`templates/lead-schema.json` defines the portable lead artifact and ingest payload:

- lead records
- crawl results
- page visits
- ingest requests

The validator intentionally accepts the same defaults the local runtime normalizes, but it fails missing source evidence, invalid URL fields, invalid `emailType`, invalid `verificationStatus`, invalid confidence, person leads without email, and generic catch-all inboxes such as `info@`, `hello@`, or similar organizational aliases. Any email record must be a named `person` lead with a non-generic email and a human owner visible in the evidence; role inboxes, unknown-owner emails, blocked emails, unsupported emails, and unnamed person-like emails fail validation. Summaries expose `goodLeadCount`, which only counts those high-quality named human email records.
