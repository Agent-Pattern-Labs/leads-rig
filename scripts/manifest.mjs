#!/usr/bin/env node

import { existsSync } from 'fs';
import {
  createManifestRecord,
  parseArgs,
  readJson,
  readLeadArtifact,
  relativeProjectPath,
  resolveProjectPath,
  validatePayload,
  writeJson,
} from '../lib/leadharness-leads.mjs';

const USAGE = `public-leads manifest -- build/update the lead artifact manifest

Usage:
  public-leads manifest --input <file> [--manifest data/lead-manifest.json] [--json]
`;

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.input) {
  console.log(USAGE);
  process.exit(opts.help ? 0 : 2);
}

try {
  const manifestPath = resolveProjectPath(opts.manifest || 'data/lead-manifest.json');
  const payload = readLeadArtifact(opts.input);
  const validation = validatePayload(payload);
  const record = createManifestRecord({
    inputPath: opts.input,
    payload,
    validation,
  });
  const manifest = existsSync(manifestPath)
    ? readJson(manifestPath)
    : { version: 1, generatedAt: new Date().toISOString(), batches: [] };

  manifest.version = 1;
  manifest.generatedAt = new Date().toISOString();
  manifest.batches = Array.isArray(manifest.batches) ? manifest.batches : [];

  const existingIndex = manifest.batches.findIndex((item) => item.input === record.input);
  if (existingIndex === -1) manifest.batches.push(record);
  else manifest.batches[existingIndex] = record;

  manifest.summary = {
    batchCount: manifest.batches.length,
    readyForIngest: manifest.batches.filter((item) => item.readyForIngest).length,
    leadCount: manifest.batches.reduce((sum, item) => sum + item.leadCount, 0),
    goodLeadCount: manifest.batches.reduce((sum, item) => sum + (item.goodLeadCount || 0), 0),
    errorCount: manifest.batches.reduce((sum, item) => sum + item.validation.errors, 0),
    warningCount: manifest.batches.reduce((sum, item) => sum + item.validation.warnings, 0),
  };

  writeJson(manifestPath, manifest);

  if (opts.json) {
    console.log(JSON.stringify({ manifest: relativeProjectPath(manifestPath), record, summary: manifest.summary }, null, 2));
  } else {
    console.log(`manifest: ${relativeProjectPath(manifestPath)}`);
    console.log(`batch: ${record.id} leads=${record.leadCount} goodLeads=${record.goodLeadCount} ready=${record.readyForIngest}`);
    console.log(`summary: batches=${manifest.summary.batchCount} ready=${manifest.summary.readyForIngest} leads=${manifest.summary.leadCount} goodLeads=${manifest.summary.goodLeadCount}`);
  }

  process.exit(validation.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
