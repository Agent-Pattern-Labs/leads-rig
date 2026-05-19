# Construction

`@agent-pattern-labs/public-leads-harness` follows the reusable agentic harness pattern used by Agent Pattern Labs: a published harness package owns shared behavior, while consumer projects own private inputs, generated artifacts, and local overrides.

## Construction Map

| Pattern Area | This Harness |
|---|---|
| Package entry points | `bin/lead-harness.mjs`, `bin/create-leads-harness.mjs`, `bin/sync.mjs` |
| Source of truth | `iso/` instructions, subagents, commands, MCP declarations, and model routing |
| Runtime surfaces | `AGENTS.md`, `CLAUDE.md`, `.codex/`, `.claude/`, `.cursor/`, `.opencode/`, `.pi/`, `.mcp.json` |
| Workflow modes | `modes/_shared.md` plus `modes/{setup,crawl,pipeline,batch,ingest,review}.md` |
| Executable policy | `templates/lead-schema.json`, `templates/states.yml`, and `templates/*.json` helper policy files |
| Deterministic helpers | `scripts/crawl.mjs`, `scripts/pipeline.mjs`, `scripts/validate-leads.mjs`, `scripts/manifest.mjs`, `scripts/ingest.mjs`, `scripts/batch-orchestrator.mjs` |
| Consumer scaffold | `create-public-leads-harness <dir>` writes local config, input, output, and ignore files |
| Consumer sync | `public-leads sync` symlinks shared harness files from the installed package |
| Batch orchestration | `batch/batch-runner.sh` delegates to `@razroo/iso-orchestrator` with bounded parallelism |
| Verification gates | `npm run verify`, `npm run smoke:iso`, sample validate/manifest/ingest, `npm pack` |

## Maintainer Rules

- Treat `iso/` as the source for shared agent instructions and generated runtime config.
- Keep private data in consumer projects under `config/`, `data/`, `batch/`, `reports/`, and `output/`.
- Add domain behavior through `modes/`, not by bloating always-loaded instructions.
- Prefer deterministic helpers in `scripts/` or `lib/` over prose-only workflow rules.
- Keep subagent roles narrow: procedural crawl work, quality reasoning, and small JSON transforms stay separate.
- Regenerate runtime config with `npm run build:config` after changing `iso/` or `models.yaml`.
- Run `npm run verify`, `npm run smoke:iso`, and package/install smoke tests before release.

## Release Checklist

1. Verify `config/profile.yml`, lead artifacts, reports, logs, and output files are gitignored.
2. Run `npm run build:config` and inspect generated config diffs.
3. Run `npm run verify` and `npm run smoke:iso`.
4. Run `npx public-leads validate --input examples/sample-leads.json`.
5. Run dry-run manifest and ingest checks against the sample artifact.
6. Run `npm audit`.
7. Run `npm pack` and confirm generated runtime surfaces are included.
8. Scaffold a clean consumer project and test install-time sync from the packed package or source tree.
9. Publish through GitHub Actions with `gh workflow run publish.yml --ref main`, or create a published release with `gh release create v0.1.0 --title v0.1.0 --generate-notes`.
