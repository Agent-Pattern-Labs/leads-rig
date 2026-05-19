---
name: lead-harness
description: Legacy alias for the public-leads command center.
user_invocable: true
args: mode
---

# lead-harness -- Legacy Alias

## Mode Routing

Determine the mode from `{{mode}}`:

| Input | Mode |
|---|---|
| empty/no args | discovery |
| `setup` | setup |
| `crawl` | crawl |
| `pipeline` | pipeline |
| `batch` | batch |
| `ingest` | ingest |
| `review` | review |
| domain list or lead request | pipeline |

If the input is a domain, URL, or pasted domain list, run `pipeline`.

## Discovery

Show this menu:

```
public-leads -- Command Center

Available commands:
  /public-leads setup     -> Create/check config and domain input files
  /public-leads crawl     -> Crawl one or more assigned domains
  /public-leads pipeline  -> Process data/pipeline.md or data/domains.tsv
  /public-leads batch     -> Run batch/batch-runner.sh
  /public-leads ingest    -> Submit validated leads to the configured ingest API
  /public-leads review    -> Inspect lead artifacts and ingest state

Local commands:
  npx public-leads crawl --input data/domains.tsv --out data/lead-results.json
  npx public-leads pipeline --input data/domains.tsv --ingest --target-project /path/to/cold-agent-leads
  npx public-leads validate --input data/lead-results.json
  npx public-leads manifest --input data/lead-results.json
  npx public-leads ingest --input data/lead-results.json --target-project /path/to/cold-agent-leads
  npx public-leads verify
```

## Load Context

Read `modes/_shared.md` plus `modes/{mode}.md` for `crawl`, `pipeline`, `batch`, and `ingest`.
Read only `modes/{mode}.md` for `setup` and `review`.

Execute the selected mode exactly.
