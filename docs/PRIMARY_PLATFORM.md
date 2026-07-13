# Primary Platform Enrichment

`public-leads enrich:platform` adds a refreshable channel recommendation to a
validated lead artifact without paid APIs.

```bash
public-leads enrich:platform \
  --input data/leads.json \
  --out data/leads-primary-platform.json \
  --report data/leads-primary-platform-report.json \
  --checkpoint data/leads-primary-platform.checkpoint.json \
  --activity-window-days 90 \
  --refresh-days 7 \
  --concurrency 4
```

Run the same command weekly with the same checkpoint. Fresh profile
measurements are reused. `GITHUB_TOKEN` is optional and only raises GitHub's
public REST rate limit.

## Selection Methods

- `observed_public_activity` means a supported public endpoint returned dated
  actions inside the configured activity window.
- `fallback_presence_priority` means no comparable dated signal was available;
  the configured B2B platform order selected the best known public profile.

The worker uses GitHub public events, Bluesky's public author feed, and YouTube
channel Atom feeds. It does not request LinkedIn, X, Facebook, or Instagram
profile pages. It stores aggregate counts and timestamps, not post content.

Page-level social links are accepted only when the profile username matches the
named contact. Explicit person-profile fields such as `linkedinUrl` are trusted
inputs. This prevents company footer accounts from being assigned to an
individual lead.
