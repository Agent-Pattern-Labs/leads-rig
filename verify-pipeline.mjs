#!/usr/bin/env node

import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  discoverLeadArtifacts,
  PROJECT_DIR,
  readLeadArtifact,
  relativeProjectPath,
  validatePayload,
} from './lib/leadharness-leads.mjs';

let errors = 0;
let warnings = 0;

const requiredFiles = [
  'package.json',
  'bin/lead-harness.mjs',
  'bin/sync.mjs',
  'iso/instructions.md',
  'iso/commands/public-leads.md',
  'templates/lead-schema.json',
  'templates/contracts.json',
  'templates/states.yml',
  'config/profile.example.yml',
  'modes/_shared.md',
  'modes/crawl.md',
  'modes/pipeline.md',
  'modes/batch.md',
  'modes/ingest.md',
  'batch/batch-prompt.md',
  'batch/batch-runner.sh',
  'scripts/batch-orchestrator.mjs',
  'docs/ARCHITECTURE.md',
];

for (const rel of requiredFiles) {
  if (existsSync(join(PROJECT_DIR, rel))) ok(`${rel} exists`);
  else error(`${rel} is missing`);
}

const artifacts = discoverLeadArtifacts(PROJECT_DIR);
if (artifacts.length === 0) {
  ok('No lead artifacts found; fresh setup is valid');
} else {
  for (const artifact of artifacts) {
    verifyArtifact(artifact);
  }
}

verifyManifestIfPresent();

if (errors > 0) {
  console.log(`\npublic-leads verify failed: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(1);
}

console.log(`\npublic-leads verify passed: ${warnings} warning(s)`);

function verifyArtifact(path) {
  try {
    const payload = readLeadArtifact(path);
    const result = validatePayload(payload);
    for (const item of result.issues) {
      const message = `${relativeProjectPath(path)} ${item.path}: ${item.code}: ${item.message}`;
      if (item.severity === 'error') error(message);
      else warn(message);
    }
    if (result.ok) {
      ok(`${relativeProjectPath(path)} valid (${result.summary.leadCount} leads, ${result.summary.domainCount} domains)`);
    }
  } catch (error_) {
    error(`${relativeProjectPath(path)}: ${error_ instanceof Error ? error_.message : String(error_)}`);
  }
}

function verifyManifestIfPresent() {
  const path = join(PROJECT_DIR, 'data/lead-manifest.json');
  if (!existsSync(path)) {
    ok('Manifest not initialized');
    return;
  }
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(manifest.batches)) {
      error('data/lead-manifest.json batches must be an array');
      return;
    }
    for (const batch of manifest.batches) {
      if (!batch.input) {
        error('manifest batch missing input');
        continue;
      }
      const inputPath = join(PROJECT_DIR, batch.input);
      if (!existsSync(inputPath)) {
        error(`manifest input missing: ${batch.input}`);
      }
      if (batch.readyForIngest && batch.validation?.errors > 0) {
        error(`manifest batch ${batch.id || batch.input} is readyForIngest with validation errors`);
      }
    }
    ok(`Manifest valid (${manifest.batches.length} batch records)`);
  } catch (error_) {
    error(`data/lead-manifest.json: ${error_ instanceof Error ? error_.message : String(error_)}`);
  }
}

function ok(message) {
  console.log(`OK ${message}`);
}

function warn(message) {
  warnings++;
  console.log(`WARN ${message}`);
}

function error(message) {
  errors++;
  console.log(`ERROR ${message}`);
}
