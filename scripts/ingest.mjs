#!/usr/bin/env node

import { ingestArtifact } from '../lib/leadharness-ingest.mjs';
import { parseArgs, relativeProjectPath } from '../lib/leadharness-leads.mjs';

const USAGE = `public-leads ingest -- submit validated leads to an ingest API

Usage:
  public-leads ingest --input <file> [--api <base-url>] [--ingest-path </path>]
                      [--operator-email <email>] [--operator-email-header <header>]
                      [--auth-header <header>] [--auth-scheme <scheme>]
                      [--token <token>] [--token-env ADMIN_API_TOKEN]
                      [--target-project /path/to/cold-agent-leads]
                      [--job-id <id>] [--out data/ingest-response.json] [--dry-run]

Defaults are read from config/profile.yml when present:
  api.base_url, api.ingest_path, api.operator_email, api.operator_email_header,
  api.auth_header, api.auth_scheme, api.auth_token_env, api.target_project

Compatibility fallbacks are still accepted:
  --admin-email, api.admin_email, api.admin_token_env, $PUBLIC_LEADS_API_TOKEN
`;

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.input) {
  console.log(USAGE);
  process.exit(opts.help ? 0 : 2);
}

try {
  const outputPath = opts.out || 'data/ingest-response.json';
  const output = await ingestArtifact(opts.input, {
    ...opts,
    out: outputPath,
  });

  if (opts.dryRun) {
    console.log(`dry run: wrote ${relativeProjectPath(outputPath)} (${output.payload.leads.length} leads)`);
    process.exit(0);
  }

  const jobId = output.response?.job?.id || opts.jobId || '';
  console.log(`ingested ${output.leadCount} leads${jobId ? ` as job ${jobId}` : ''}; wrote ${relativeProjectPath(outputPath)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
