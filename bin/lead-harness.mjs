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
  'enrich:platform': 'scripts/enrich-platform.mjs',
  batch: 'scripts/batch-orchestrator.mjs',
  verify: 'verify-pipeline.mjs',
  sync: 'bin/sync.mjs',
};

const helperAliases = {
  'trace:list': ['@agent-pattern-labs/iso-trace', 'list'],
  'trace:stats': ['@agent-pattern-labs/iso-trace', 'stats'],
  'trace:show': ['@agent-pattern-labs/iso-trace', 'show'],
  'guard:audit': ['@agent-pattern-labs/iso-guard', 'audit'],
  'guard:explain': ['@agent-pattern-labs/iso-guard', 'explain'],
  'ledger:status': ['@agent-pattern-labs/iso-ledger', 'status'],
  'ledger:rebuild': ['@agent-pattern-labs/iso-ledger', 'rebuild'],
  'ledger:verify': ['@agent-pattern-labs/iso-ledger', 'verify'],
  'capabilities:list': ['@agent-pattern-labs/iso-capabilities', 'list'],
  'capabilities:explain': ['@agent-pattern-labs/iso-capabilities', 'explain'],
  'capabilities:check': ['@agent-pattern-labs/iso-capabilities', 'check'],
  'context:list': ['@agent-pattern-labs/iso-context', 'list'],
  'context:explain': ['@agent-pattern-labs/iso-context', 'explain'],
  'context:plan': ['@agent-pattern-labs/iso-context', 'plan'],
  'context:check': ['@agent-pattern-labs/iso-context', 'check'],
  'context:render': ['@agent-pattern-labs/iso-context', 'render'],
  'cache:key': ['@agent-pattern-labs/iso-cache', 'key'],
  'cache:has': ['@agent-pattern-labs/iso-cache', 'has'],
  'cache:get': ['@agent-pattern-labs/iso-cache', 'get'],
  'cache:put': ['@agent-pattern-labs/iso-cache', 'put'],
  'cache:status': ['@agent-pattern-labs/iso-cache', 'status'],
  'cache:list': ['@agent-pattern-labs/iso-cache', 'list'],
  'cache:verify': ['@agent-pattern-labs/iso-cache', 'verify'],
  'cache:prune': ['@agent-pattern-labs/iso-cache', 'prune'],
  'index:build': ['@agent-pattern-labs/iso-index', 'build'],
  'index:status': ['@agent-pattern-labs/iso-index', 'status'],
  'index:query': ['@agent-pattern-labs/iso-index', 'query'],
  'index:has': ['@agent-pattern-labs/iso-index', 'has'],
  'index:verify': ['@agent-pattern-labs/iso-index', 'verify'],
  'facts:build': ['@agent-pattern-labs/iso-facts', 'build'],
  'facts:status': ['@agent-pattern-labs/iso-facts', 'status'],
  'facts:query': ['@agent-pattern-labs/iso-facts', 'query'],
  'facts:has': ['@agent-pattern-labs/iso-facts', 'has'],
  'facts:verify': ['@agent-pattern-labs/iso-facts', 'verify'],
  'score:compute': ['@agent-pattern-labs/iso-score', 'compute'],
  'score:verify': ['@agent-pattern-labs/iso-score', 'verify'],
  'score:check': ['@agent-pattern-labs/iso-score', 'check'],
  'score:gate': ['@agent-pattern-labs/iso-score', 'gate'],
  'score:compare': ['@agent-pattern-labs/iso-score', 'compare'],
  'score:explain': ['@agent-pattern-labs/iso-score', 'explain'],
  'canon:normalize': ['@agent-pattern-labs/iso-canon', 'normalize'],
  'canon:key': ['@agent-pattern-labs/iso-canon', 'key'],
  'canon:compare': ['@agent-pattern-labs/iso-canon', 'compare'],
  'canon:explain': ['@agent-pattern-labs/iso-canon', 'explain'],
  'preflight:plan': ['@agent-pattern-labs/iso-preflight', 'plan'],
  'preflight:check': ['@agent-pattern-labs/iso-preflight', 'check'],
  'preflight:explain': ['@agent-pattern-labs/iso-preflight', 'explain'],
  'postflight:status': ['@agent-pattern-labs/iso-postflight', 'status'],
  'postflight:check': ['@agent-pattern-labs/iso-postflight', 'check'],
  'postflight:explain': ['@agent-pattern-labs/iso-postflight', 'explain'],
  'timeline:status': ['@agent-pattern-labs/iso-timeline', 'status'],
  'timeline:build': ['@agent-pattern-labs/iso-timeline', 'build'],
  'timeline:plan': ['@agent-pattern-labs/iso-timeline', 'plan'],
  'timeline:due': ['@agent-pattern-labs/iso-timeline', 'due'],
  'timeline:check': ['@agent-pattern-labs/iso-timeline', 'check'],
  'timeline:verify': ['@agent-pattern-labs/iso-timeline', 'verify'],
  'prioritize:status': ['@agent-pattern-labs/iso-prioritize', 'status'],
  'prioritize:items': ['@agent-pattern-labs/iso-prioritize', 'items'],
  'prioritize:build': ['@agent-pattern-labs/iso-prioritize', 'build'],
  'prioritize:rank': ['@agent-pattern-labs/iso-prioritize', 'rank'],
  'prioritize:select': ['@agent-pattern-labs/iso-prioritize', 'select'],
  'prioritize:check': ['@agent-pattern-labs/iso-prioritize', 'check'],
  'prioritize:verify': ['@agent-pattern-labs/iso-prioritize', 'verify'],
  'lineage:status': ['@agent-pattern-labs/iso-lineage', 'status'],
  'lineage:record': ['@agent-pattern-labs/iso-lineage', 'record'],
  'lineage:check': ['@agent-pattern-labs/iso-lineage', 'check'],
  'lineage:stale': ['@agent-pattern-labs/iso-lineage', 'stale'],
  'lineage:verify': ['@agent-pattern-labs/iso-lineage', 'verify'],
  'redact:scan': ['@agent-pattern-labs/iso-redact', 'scan'],
  'redact:verify': ['@agent-pattern-labs/iso-redact', 'verify'],
  'redact:apply': ['@agent-pattern-labs/iso-redact', 'apply'],
  'migrate:plan': ['@agent-pattern-labs/iso-migrate', 'plan'],
  'migrate:apply': ['@agent-pattern-labs/iso-migrate', 'apply'],
  'migrate:check': ['@agent-pattern-labs/iso-migrate', 'check'],
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
  if (pkgName === '@agent-pattern-labs/iso-trace') {
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
  enrich:platform  Measure public activity and select a refreshable primary platform
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
