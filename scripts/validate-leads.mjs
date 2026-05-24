#!/usr/bin/env node

import {
  parseArgs,
  readLeadArtifact,
  relativeProjectPath,
  validatePayload,
  writeJson,
} from '../lib/leadharness-leads.mjs';

const USAGE = `public-leads validate -- validate lead artifacts

Usage:
  public-leads validate --input <file> [--json] [--out <file>] [--allow-empty]

Accepted input:
  - JSON object with { jobId?, domains?, leads, results?, errors? }
  - JSON array of lead records
  - JSONL lead records
`;

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.input) {
  console.log(USAGE);
  process.exit(opts.help ? 0 : 2);
}

try {
  const payload = readLeadArtifact(opts.input);
  const result = validatePayload(payload, { allowEmpty: Boolean(opts.allowEmpty) });
  const report = {
    input: opts.input,
    ok: result.ok,
    summary: result.summary,
    errors: result.errors,
    warnings: result.warnings,
    issues: result.issues,
    payload,
  };

  if (opts.out) {
    writeJson(opts.out, report);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function printReport(report) {
  const rel = relativeProjectPath(report.input);
  console.log(`${report.ok ? 'OK' : 'ERROR'} ${rel}`);
  console.log(`domains=${report.summary.domainCount} leads=${report.summary.leadCount} goodLeads=${report.summary.goodLeadCount} results=${report.summary.resultCount} avgConfidence=${report.summary.averageConfidence}`);
  if (Object.keys(report.summary.byType).length > 0) {
    console.log(`types=${Object.entries(report.summary.byType).map(([type, count]) => `${type}:${count}`).join(', ')}`);
  }
  for (const item of report.issues) {
    const prefix = item.severity === 'error' ? 'error' : 'warn';
    console.log(`${prefix}: ${item.path}: ${item.code}: ${item.message}`);
  }
}
