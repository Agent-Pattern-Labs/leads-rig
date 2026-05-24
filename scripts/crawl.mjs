#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { crawlDomains } from '../lib/leadharness-crawler.mjs';
import {
  loadProfileConfig,
  parseArgs,
  relativeProjectPath,
  resolveProjectPath,
  validatePayload,
  writeJson,
} from '../lib/leadharness-leads.mjs';

const USAGE = `public-leads crawl -- crawl public company pages into a lead artifact

Usage:
  public-leads crawl [--domain example.com | --domains example.com,example.org]
                     [--input data/domains.tsv] [--out data/lead-results.json]
                     [--max-pages 10] [--min-confidence 30]
                     [--include-blocked] [--allow-empty] [--json]

When no domain or input is supplied, the first existing file is used:
  data/domains.tsv, then data/pipeline.md
`;

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const profile = loadProfileConfig();
  const domains = readRequestedDomains(opts);
  const out = opts.out || 'data/lead-results.json';
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
  if (opts.json) {
    console.log(JSON.stringify({ output: out, validation, summary: validation.summary }, null, 2));
  } else {
    console.log(`crawl: wrote ${relativeProjectPath(resolveProjectPath(out))}`);
    console.log(`domains=${validation.summary.domainCount} leads=${validation.summary.leadCount} goodLeads=${validation.summary.goodLeadCount} results=${validation.summary.resultCount} errors=${payload.errors.length}`);
  }

  if (!validation.ok) {
    for (const item of validation.issues.filter((issue) => issue.severity === 'error')) {
      console.error(`error: ${item.path}: ${item.code}: ${item.message}`);
    }
    process.exit(1);
  }
}

export function readRequestedDomains(opts) {
  const inline = [
    ...splitDomainList(opts.domain),
    ...splitDomainList(opts.domains),
    ...splitDomainList(opts._ || []),
  ];
  if (inline.length > 0) return inline;

  const input = opts.input || firstExisting(['data/domains.tsv', 'data/pipeline.md']);
  if (!input) {
    throw new Error('no domains supplied; pass --domain, --domains, or create data/domains.tsv');
  }
  return readDomainsFile(input);
}

export function readDomainsFile(path) {
  const abs = resolveProjectPath(path);
  if (!existsSync(abs)) throw new Error(`input not found: ${path}`);
  const text = readFileSync(abs, 'utf8');
  if (path.endsWith('.md')) return readPipelineMarkdown(text);
  return readDomainsTSV(text);
}

function readDomainsTSV(text) {
  const domains = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (/^domain$/i.test(parts[0])) continue;
    const domain = (parts[0] || '').trim();
    if (domain) domains.push(domain);
  }
  return domains;
}

function readPipelineMarkdown(text) {
  const domains = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*\[[ xX-]\]\s*([^|\s]+)(?:\s*\||\s*$)/);
    if (match?.[1]) domains.push(match[1]);
  }
  return domains;
}

function splitDomainList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item || '').split(/[,\s]+/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(resolveProjectPath(path))) || '';
}

function isDirectRun() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
