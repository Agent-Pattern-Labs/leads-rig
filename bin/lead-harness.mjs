#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const PROJECT_DIR = process.env.PUBLIC_LEADS_PROJECT || process.env.LEAD_HARNESS_PROJECT || process.cwd();
const require = createRequire(import.meta.url);

const commands = {
  crawl: 'scripts/crawl.mjs',
  pipeline: 'scripts/pipeline.mjs',
  validate: 'scripts/validate-leads.mjs',
  manifest: 'scripts/manifest.mjs',
  ingest: 'scripts/ingest.mjs',
  batch: 'scripts/batch-orchestrator.mjs',
  verify: 'verify-pipeline.mjs',
  sync: 'bin/sync.mjs',
};

const helperAliases = {
  'trace:list': ['@razroo/iso-trace', 'list'],
  'trace:stats': ['@razroo/iso-trace', 'stats'],
  'trace:show': ['@razroo/iso-trace', 'show'],
  'guard:audit': ['@razroo/iso-guard', 'audit'],
  'guard:explain': ['@razroo/iso-guard', 'explain'],
  'ledger:status': ['@razroo/iso-ledger', 'status'],
  'ledger:rebuild': ['@razroo/iso-ledger', 'rebuild'],
  'ledger:verify': ['@razroo/iso-ledger', 'verify'],
  'capabilities:list': ['@razroo/iso-capabilities', 'list'],
  'capabilities:explain': ['@razroo/iso-capabilities', 'explain'],
  'capabilities:check': ['@razroo/iso-capabilities', 'check'],
  'context:list': ['@razroo/iso-context', 'list'],
  'context:explain': ['@razroo/iso-context', 'explain'],
  'context:plan': ['@razroo/iso-context', 'plan'],
  'context:check': ['@razroo/iso-context', 'check'],
  'context:render': ['@razroo/iso-context', 'render'],
  'cache:key': ['@razroo/iso-cache', 'key'],
  'cache:has': ['@razroo/iso-cache', 'has'],
  'cache:get': ['@razroo/iso-cache', 'get'],
  'cache:put': ['@razroo/iso-cache', 'put'],
  'cache:status': ['@razroo/iso-cache', 'status'],
  'cache:list': ['@razroo/iso-cache', 'list'],
  'cache:verify': ['@razroo/iso-cache', 'verify'],
  'cache:prune': ['@razroo/iso-cache', 'prune'],
  'index:build': ['@razroo/iso-index', 'build'],
  'index:status': ['@razroo/iso-index', 'status'],
  'index:query': ['@razroo/iso-index', 'query'],
  'index:has': ['@razroo/iso-index', 'has'],
  'index:verify': ['@razroo/iso-index', 'verify'],
  'facts:build': ['@razroo/iso-facts', 'build'],
  'facts:status': ['@razroo/iso-facts', 'status'],
  'facts:query': ['@razroo/iso-facts', 'query'],
  'facts:has': ['@razroo/iso-facts', 'has'],
  'facts:verify': ['@razroo/iso-facts', 'verify'],
  'score:compute': ['@razroo/iso-score', 'compute'],
  'score:verify': ['@razroo/iso-score', 'verify'],
  'score:check': ['@razroo/iso-score', 'check'],
  'score:gate': ['@razroo/iso-score', 'gate'],
  'score:compare': ['@razroo/iso-score', 'compare'],
  'score:explain': ['@razroo/iso-score', 'explain'],
  'canon:normalize': ['@razroo/iso-canon', 'normalize'],
  'canon:key': ['@razroo/iso-canon', 'key'],
  'canon:compare': ['@razroo/iso-canon', 'compare'],
  'canon:explain': ['@razroo/iso-canon', 'explain'],
  'preflight:plan': ['@razroo/iso-preflight', 'plan'],
  'preflight:check': ['@razroo/iso-preflight', 'check'],
  'preflight:explain': ['@razroo/iso-preflight', 'explain'],
  'postflight:status': ['@razroo/iso-postflight', 'status'],
  'postflight:check': ['@razroo/iso-postflight', 'check'],
  'postflight:explain': ['@razroo/iso-postflight', 'explain'],
  'timeline:status': ['@razroo/iso-timeline', 'status'],
  'timeline:build': ['@razroo/iso-timeline', 'build'],
  'timeline:plan': ['@razroo/iso-timeline', 'plan'],
  'timeline:due': ['@razroo/iso-timeline', 'due'],
  'timeline:check': ['@razroo/iso-timeline', 'check'],
  'timeline:verify': ['@razroo/iso-timeline', 'verify'],
  'prioritize:status': ['@razroo/iso-prioritize', 'status'],
  'prioritize:items': ['@razroo/iso-prioritize', 'items'],
  'prioritize:build': ['@razroo/iso-prioritize', 'build'],
  'prioritize:rank': ['@razroo/iso-prioritize', 'rank'],
  'prioritize:select': ['@razroo/iso-prioritize', 'select'],
  'prioritize:check': ['@razroo/iso-prioritize', 'check'],
  'prioritize:verify': ['@razroo/iso-prioritize', 'verify'],
  'lineage:status': ['@razroo/iso-lineage', 'status'],
  'lineage:record': ['@razroo/iso-lineage', 'record'],
  'lineage:check': ['@razroo/iso-lineage', 'check'],
  'lineage:stale': ['@razroo/iso-lineage', 'stale'],
  'lineage:verify': ['@razroo/iso-lineage', 'verify'],
  'redact:scan': ['@razroo/iso-redact', 'scan'],
  'redact:verify': ['@razroo/iso-redact', 'verify'],
  'redact:apply': ['@razroo/iso-redact', 'apply'],
  'migrate:plan': ['@razroo/iso-migrate', 'plan'],
  'migrate:apply': ['@razroo/iso-migrate', 'apply'],
  'migrate:check': ['@razroo/iso-migrate', 'check'],
};

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp();
  process.exit(cmd ? 0 : 1);
}

if (commands[cmd]) {
  runScript(commands[cmd], rest);
}

if (helperAliases[cmd]) {
  const [pkgName, subcommand] = helperAliases[cmd];
  runIsoCli(pkgName, [subcommand, ...defaultIsoArgs(pkgName, subcommand, rest), ...rest]);
}

console.error(`Unknown command: ${cmd}\n`);
printHelp();
process.exit(1);

function runScript(relScript, args) {
  const scriptPath = join(PKG_ROOT, relScript);
  if (!existsSync(scriptPath)) {
    console.error(`public-leads: script not found: ${relScript}`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      PUBLIC_LEADS_PROJECT: PROJECT_DIR,
      PUBLIC_LEADS_ROOT: PKG_ROOT,
      LEAD_HARNESS_PROJECT: PROJECT_DIR,
      LEAD_HARNESS_ROOT: PKG_ROOT,
    },
  });
  process.exit(result.status ?? 1);
}

function runIsoCli(pkgName, args) {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkg = JSON.parse(require('fs').readFileSync(pkgJsonPath, 'utf8'));
  const binRel = typeof pkg.bin === 'string'
    ? pkg.bin
    : Object.values(pkg.bin || {})[0];
  if (!binRel) {
    console.error(`public-leads: ${pkgName} does not expose a CLI bin`);
    process.exit(1);
  }
  const cliPath = join(dirname(pkgJsonPath), binRel);
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

function defaultIsoArgs(pkgName, subcommand, args) {
  const defaults = [];
  if (pkgName === '@razroo/iso-trace') {
    if (!hasFlag(args, '--cwd')) defaults.push('--cwd', PROJECT_DIR);
    if ((subcommand === 'list' || subcommand === 'stats') && !hasFlag(args, '--since')) {
      defaults.push('--since', '7d');
    }
  }
  return defaults;
}

function hasFlag(args, flag) {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function printHelp() {
  console.log(`public-leads — CLI for the @agent-pattern-labs/leads-rig package

Usage:
  public-leads <command> [args...]

Core commands:
  crawl         Crawl public company pages and write a lead artifact
  pipeline      Crawl, validate, manifest, and optionally ingest leads
  validate      Validate lead artifacts against the local contract
  manifest      Build/update data/lead-manifest.json from lead artifacts
  ingest        Submit a validated payload to the configured ingest API
  verify        Run the full harness verification gate
  sync          Re-run consumer-project symlink sync

Helper command families:
  trace:*, guard:*, ledger:*, capabilities:*, context:*, cache:*, index:*,
  facts:*, score:*, canon:*, preflight:*, postflight:*, timeline:*,
  prioritize:*, lineage:*,
  redact:*, migrate:*

Legacy alias:
  lead-harness <command> ...
`);
}
