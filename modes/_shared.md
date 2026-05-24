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
- Use coding-agent judgment for every email candidate. Only emit an email lead when the source evidence identifies one specific human behind that address.
- Prefer named people over organizational inboxes. Do not emit generic catch-all emails such as `info@`, `hello@`, `contact@`, `support@`, `team@`, or similar aliases. If only a general contact path exists, emit `contact_path` instead.
- Reject email records that are role-based, shared, departmental, unknown ownership, blocked operational inboxes, or person-like but missing a visible human name in the source evidence.
- Keep contact forms as `emailType: "contact_path"` with empty `email`.
- Mark operational no-contact inboxes such as `noreply`, `abuse`, `security`, and `legal` as `blocked` with confidence `0`.

## Quality Heuristics

- `goodLeadCount`: counts only `person` email records with a non-generic email and named `contactName` visible in the evidence. Generic, role, unknown, blocked, unnamed, unsupported, and `contact_path` records are not good leads.
- `person`: named human with source context tying that person to the email address.
- `role`: legacy/review-only classification. Do not emit role email records in new artifacts.
- `contact_path`: public form or page where no email is available.
- `blocked`: public address that should not be used for outbound.

Confidence should reflect source quality, person specificity, domain match, and verification. Low-confidence contact paths are allowed if they preserve warnings and evidence; email leads should be high-quality named humans only.

## Local Commands

```bash
npx public-leads validate --input data/lead-results.json
npx public-leads manifest --input data/lead-results.json
PUBLIC_LEADS_API=https://cold-agent-leads.example.com npx public-leads ingest --input data/lead-results.json --dry-run
npx public-leads pipeline --input data/domains.tsv --ingest
npx public-leads verify
```
