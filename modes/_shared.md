# Shared Lead Discovery Policy

This harness creates reviewable, public-source lead records and ingest-ready artifacts.

## Lead Contract

Every persisted lead must validate with:

```bash
npx public-leads validate --input <artifact>
```

Required fields:

| Field | Rule |
|---|---|
| `domain` | Lowercase company domain, no protocol or `www.` |
| `emailType` | `person`, `role`, `blocked`, `contact_path`, or `unknown` |
| `sourceUrl` | Public HTTP(S) page where the evidence was found |
| `evidence` | Short public-source excerpt supporting the lead |
| `extractionMethod` | Method label such as `agentic_harness_public_page` |
| `verificationStatus` | `verified`, `mx_verified`, `unverified`, `not_applicable`, `blocked`, or `unknown` |
| `confidence` | Integer 0-100 |

## Source Rules

- Use official company websites first.
- Prioritize home, contact, about, team, leadership, people, press, blog, careers, and legal pages.
- Respect robots.txt, paywalls, login walls, and obvious anti-scraping notices.
- Do not infer email formats. Do not brute-force guessed addresses.
- Keep contact forms as `emailType: "contact_path"` with empty `email`.
- Mark operational no-contact inboxes such as `noreply`, `abuse`, `security`, and `legal` as `blocked` with confidence `0`.

## Quality Heuristics

- `person`: named person or person-like email with source context.
- `role`: public role inbox such as `sales@`, `partnerships@`, or `press@`.
- `contact_path`: public form or page where no email is available.
- `blocked`: public address that should not be used for outbound.

Confidence should reflect source quality, person specificity, domain match, and verification. Low-confidence records are allowed if they preserve warnings and evidence.

## Local Commands

```bash
npx public-leads validate --input data/lead-results.json
npx public-leads manifest --input data/lead-results.json
npx public-leads ingest --input data/lead-results.json --dry-run
npx public-leads verify
```
