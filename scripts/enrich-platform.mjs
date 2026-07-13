#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import {
  parseArgs,
  readLeadArtifact,
  validatePayload,
  writeJson,
} from '../lib/leadharness-leads.mjs';
import { enrichPrimaryPlatforms } from '../lib/leadharness-primary-platform.mjs';

const USAGE = `public-leads enrich:platform -- measure public platform activity and select a primary profile

Usage:
  public-leads enrich:platform --input data/leads.json
      [--out data/leads-primary-platform.json]
      [--report data/leads-primary-platform-report.json]
      [--checkpoint data/leads-primary-platform.checkpoint.json]
      [--activity-window-days 90] [--refresh-days 7]
      [--platform-order linkedin,github,x,bluesky,youtube,instagram,facebook]
      [--limit 0] [--offset 0] [--concurrency 4] [--timeout-ms 8000]
      [--github-token <token>] [--refresh]

Only permitted public activity endpoints are requested. LinkedIn, X, Instagram,
and Facebook are presence-only fallbacks and are never crawled by this command.
GitHub tokens are optional and only increase the public REST API rate limit.
`;

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const input = String(opts.input || opts._?.[0] || '').trim();
  if (!input) throw new Error('--input is required');
  if (!existsSync(input)) throw new Error(`input not found: ${input}`);
  const stem = input.replace(/\.json$/i, '');
  const out = String(opts.out || `${stem}-primary-platform.json`);
  const reportOut = String(opts.report || `${stem}-primary-platform-report.json`);
  const checkpoint = String(opts.checkpoint || `${stem}-primary-platform.checkpoint.json`);
  const cache = loadCache(checkpoint);
  const payload = readLeadArtifact(input);

  const enriched = await enrichPrimaryPlatforms(payload, {
    cache,
    activityWindowDays: opts.activityWindowDays,
    refreshDays: opts.refreshDays,
    platformOrder: opts.platformOrder,
    limit: opts.limit,
    offset: opts.offset,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
    maxProfiles: opts.maxProfiles,
    githubToken: opts.githubToken,
    refresh: Boolean(opts.refresh),
  });
  const validation = validatePayload(enriched.payload, { allowEmpty: true });
  enriched.report.validation = validation.summary;

  writeJson(out, enriched.payload);
  writeJson(reportOut, enriched.report);
  writeJson(checkpoint, enriched.cache);
  if (!validation.ok) {
    const errors = validation.issues.filter((issue) => issue.severity === 'error');
    throw new Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  }

  console.log(JSON.stringify({
    status: 'COMPLETED',
    ...enriched.report,
    out,
    report: reportOut,
    checkpoint,
  }, null, 2));
}

function loadCache(path) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
