#!/usr/bin/env node

import { existsSync } from 'fs';
import { crawlDomains } from '../lib/leadharness-crawler.mjs';
import { ingestPayload } from '../lib/leadharness-ingest.mjs';
import {
  createManifestRecord,
  loadProfileConfig,
  parseArgs,
  readJson,
  relativeProjectPath,
  resolveProjectPath,
  validatePayload,
  writeJson,
} from '../lib/leadharness-leads.mjs';
import { readRequestedDomains } from './crawl.mjs';

const USAGE = `public-leads pipeline -- crawl, validate, manifest, and optionally ingest leads

Usage:
  public-leads pipeline [--domain example.com | --domains example.com,example.org]
                        [--input data/domains.tsv] [--out data/lead-results.json]
                        [--manifest data/lead-manifest.json]
                        [--max-pages 10] [--min-confidence 30]
                        [--ingest | --upload] [--dry-run]
                        [--api https://cold-agent-leads.example.com]

Examples:
  public-leads pipeline --domains example.com,example.org
  PUBLIC_LEADS_API=https://cold-agent-leads.example.com public-leads pipeline --input data/domains.tsv --ingest
`;

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

try {
  const profile = loadProfileConfig();
  const domains = readRequestedDomains(opts);
  const out = opts.out || 'data/lead-results.json';
  const manifestPath = opts.manifest || 'data/lead-manifest.json';
  const ingestOut = opts.ingestOut || opts.ingestResponse || 'data/ingest-response.json';

  const payload = await crawlDomains(domains, {
    maxPages: opts.maxPages || profile.maxPages,
    minConfidence: opts.minConfidence || profile.minConfidence,
    userAgent: opts.userAgent || profile.userAgent,
    includeBlocked: Boolean(opts.includeBlocked),
    delayMs: opts.delayMs,
    timeoutMs: opts.timeoutMs,
    jobId: opts.jobId,
  });
  writeJson(resolveProjectPath(out), payload);

  const validation = validatePayload(payload, { allowEmpty: Boolean(opts.allowEmpty) });
  if (!validation.ok) {
    for (const item of validation.issues.filter((issue) => issue.severity === 'error')) {
      console.error(`error: ${item.path}: ${item.code}: ${item.message}`);
    }
    process.exit(1);
  }

  const manifest = upsertManifest(manifestPath, out, payload, validation);
  console.log(`pipeline: wrote ${relativeProjectPath(resolveProjectPath(out))}`);
  console.log(`manifest: ${relativeProjectPath(resolveProjectPath(manifestPath))}`);
  console.log(`domains=${validation.summary.domainCount} leads=${validation.summary.leadCount} goodLeads=${validation.summary.goodLeadCount} results=${validation.summary.resultCount} errors=${payload.errors.length}`);

  if (opts.ingest || opts.upload) {
    const ingestResult = await ingestPayload(payload, {
      ...opts,
      input: out,
      out: ingestOut,
      dryRun: Boolean(opts.dryRun),
    });
    if (opts.dryRun) {
      console.log(`dry-run ingest: wrote ${relativeProjectPath(resolveProjectPath(ingestOut))}`);
    } else {
      const jobId = ingestResult.response?.job?.id || payload.jobId || '';
      console.log(`ingested ${ingestResult.leadCount} leads${jobId ? ` as job ${jobId}` : ''}; wrote ${relativeProjectPath(resolveProjectPath(ingestOut))}`);
    }
  } else {
    console.log('next: public-leads ingest --input ' + out);
  }

  if (opts.json) {
    console.log(JSON.stringify({ artifact: out, manifest: manifestPath, summary: manifest.summary }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function upsertManifest(manifestPath, inputPath, payload, validation) {
  const abs = resolveProjectPath(manifestPath);
  const record = createManifestRecord({ inputPath, payload, validation });
  const manifest = existsSync(abs)
    ? readJson(abs)
    : { version: 1, generatedAt: new Date().toISOString(), batches: [] };

  manifest.version = 1;
  manifest.generatedAt = new Date().toISOString();
  manifest.batches = Array.isArray(manifest.batches) ? manifest.batches : [];
  const index = manifest.batches.findIndex((item) => item.input === record.input);
  if (index === -1) manifest.batches.push(record);
  else manifest.batches[index] = record;
  manifest.summary = {
    batchCount: manifest.batches.length,
    readyForIngest: manifest.batches.filter((item) => item.readyForIngest).length,
    leadCount: manifest.batches.reduce((sum, item) => sum + item.leadCount, 0),
    goodLeadCount: manifest.batches.reduce((sum, item) => sum + (item.goodLeadCount || 0), 0),
    errorCount: manifest.batches.reduce((sum, item) => sum + item.validation.errors, 0),
    warningCount: manifest.batches.reduce((sum, item) => sum + item.validation.warnings, 0),
  };
  writeJson(abs, manifest);
  return manifest;
}
