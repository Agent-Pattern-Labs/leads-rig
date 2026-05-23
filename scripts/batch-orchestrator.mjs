#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runWorkflow } from '@agent-pattern-labs/iso-orchestrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const PROJECT_DIR = process.env.PUBLIC_LEADS_PROJECT || process.env.LEAD_HARNESS_PROJECT || process.cwd();

const BATCH_DIR = join(PROJECT_DIR, 'batch');
const INPUT_FILE = join(BATCH_DIR, 'batch-input.tsv');
const STATE_FILE = join(BATCH_DIR, 'batch-state.tsv');
const PROMPT_FILE = join(BATCH_DIR, 'batch-prompt.md');
const LOGS_DIR = join(BATCH_DIR, 'logs');
const WORKFLOW_DIR = join(PROJECT_DIR, process.env.PUBLIC_LEADS_WORKFLOW_DIR || process.env.LEAD_HARNESS_WORKFLOW_DIR || '.public-leads-runs');
const LOCK_FILE = join(BATCH_DIR, 'batch-runner.pid');
const STATE_HEADER = 'id\tdomain\tstatus\tstarted_at\tcompleted_at\tartifact\tlead_count\terror\tretries';
const MAX_PARALLEL_WORKERS = 2;

function usage() {
  console.log(`public-leads batch runner - process company domains with AI CLI workers

Usage:
  batch/batch-runner.sh [OPTIONS]

Options:
  --runner NAME        Worker CLI: opencode or codex (default: opencode)
  --parallel N         Number of parallel workers (default: 1, max: 2)
  --allow-unsafe-workers
                       Enable worker CLI permission-bypass flags (explicit opt-in)
  --dry-run            Show pending domains without executing workers
  --retry-failed       Only retry rows marked failed
  --start-from N       Start from numeric id N
  --max-retries N      Max failed retries per domain (default: 2)
  --workflow-id ID     Durable workflow id (default: public-leads-batch)
  -h, --help           Show help

Input:
  batch/batch-input.tsv with columns: id, domain, company, notes
`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }
  await main(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function main(opts) {
  await checkPrerequisites(opts);
  const releaseLock = await acquirePidLock(opts);
  try {
    await initState();
    const domains = await readInputDomains();
    const rows = await readState();
    const pending = selectPending(domains, rows, opts);

    if (opts.dryRun) {
      console.log(`dry run: ${pending.length} pending domain(s)`);
      for (const item of pending) {
        console.log(`${item.id}\t${item.domain}\t${item.company || '-'}\t${item.notes || '-'}`);
      }
      return;
    }

    const result = await runWorkflow(
      {
        workflowId: opts.workflowId,
        dir: WORKFLOW_DIR,
        initialState: { startedAt: nowIso(), completed: 0, failed: 0 },
      },
      async (workflow) => {
        const summary = await workflow.forEach(
          pending,
          (item) => workflow.step(
            `crawl:${item.id}:${hash(item.domain)}`,
            () => processDomain(workflow, item, opts),
            { idempotencyKey: `${item.id}:${item.domain}:${retriesFor(rows, item.id)}` },
          ),
          {
            maxParallel: opts.parallel,
            mutexKey: (item) => `domain:${item.domain}`,
            stopOnError: false,
          },
        );
        await workflow.updateState((state) => ({
          ...state,
          completedAt: nowIso(),
          completed: summary.results.filter((item) => item.status === 'fulfilled' && item.value?.status === 'completed').length,
          failed: summary.results.filter((item) => item.status === 'rejected' || item.value?.status === 'failed').length,
        }));
        return summary;
      },
    );

    const fulfilled = result.value.results.filter((item) => item.status === 'fulfilled').length;
    const rejected = result.value.results.filter((item) => item.status === 'rejected').length;
    console.log(`batch complete: fulfilled=${fulfilled} rejected=${rejected}`);
  } finally {
    await releaseLock();
  }
}

function parseArgs(argv) {
  const opts = {
    runner: process.env.PUBLIC_LEADS_BATCH_RUNNER || process.env.LEAD_HARNESS_BATCH_RUNNER || 'opencode',
    parallel: 1,
    allowUnsafeWorkers: envFlag('PUBLIC_LEADS_ALLOW_UNSAFE_WORKERS') || envFlag('LEAD_HARNESS_ALLOW_UNSAFE_WORKERS'),
    dryRun: false,
    retryFailed: false,
    startFrom: 0,
    maxRetries: 2,
    workflowId: 'public-leads-batch',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[i];
    };
    if (arg === '--runner') opts.runner = next();
    else if (arg === '--parallel') opts.parallel = boundedParallel(next(), '--parallel');
    else if (arg === '--allow-unsafe-workers') opts.allowUnsafeWorkers = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--retry-failed') opts.retryFailed = true;
    else if (arg === '--start-from') opts.startFrom = nonNegativeInt(next(), '--start-from');
    else if (arg === '--max-retries') opts.maxRetries = positiveInt(next(), '--max-retries');
    else if (arg === '--workflow-id') opts.workflowId = sanitizeWorkflowId(next());
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }

  opts.runner = parseRunner(opts.runner);
  return opts;
}

async function checkPrerequisites(opts) {
  if (!existsSync(INPUT_FILE)) throw new Error(`${INPUT_FILE} not found. Create batch/batch-input.tsv first.`);
  if (!existsSync(PROMPT_FILE)) throw new Error(`${PROMPT_FILE} not found.`);
  await ensureDir(LOGS_DIR);
  await ensureDir(WORKFLOW_DIR);

  if (!opts.dryRun) {
    const result = spawnSync(workerCommandName(opts.runner), ['--help'], { stdio: 'ignore' });
    if (result.error?.code === 'ENOENT') {
      throw new Error(`'${workerCommandName(opts.runner)}' CLI not found in PATH`);
    }
  }
}

async function acquirePidLock(opts) {
  if (opts.dryRun) return async () => {};
  if (existsSync(LOCK_FILE)) {
    const oldPid = (await readTextIfExists(LOCK_FILE)).trim();
    if (oldPid) {
      try {
        process.kill(Number(oldPid), 0);
        throw new Error(`another batch runner is already running (PID ${oldPid})`);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    await rm(LOCK_FILE, { force: true });
  }
  await ensureDir(dirname(LOCK_FILE));
  await writeFile(LOCK_FILE, String(process.pid), 'utf8');
  return async () => {
    await rm(LOCK_FILE, { force: true });
  };
}

async function initState() {
  if (existsSync(STATE_FILE)) return;
  await ensureDir(dirname(STATE_FILE));
  await writeFile(STATE_FILE, `${STATE_HEADER}\n`, 'utf8');
}

async function readInputDomains() {
  const content = await readFile(INPUT_FILE, 'utf8');
  const rows = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts[0] === 'id') continue;
    const id = cell(parts[0], '');
    const domain = normalizeDomain(parts[1]);
    if (!id || !domain) continue;
    rows.push({
      id,
      domain,
      company: cell(parts[2]),
      notes: cell(parts.slice(3).join(' ')),
    });
  }
  return rows;
}

async function readState() {
  await initState();
  const content = await readFile(STATE_FILE, 'utf8');
  const rows = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts[0] === 'id') continue;
    rows.set(parts[0], normalizeStateRow({
      id: parts[0],
      domain: parts[1],
      status: parts[2],
      started_at: parts[3],
      completed_at: parts[4],
      artifact: parts[5],
      lead_count: parts[6],
      error: parts[7],
      retries: parts[8],
    }));
  }
  return rows;
}

async function writeState(rows) {
  const lines = [STATE_HEADER];
  for (const row of [...rows.values()].sort((a, b) => Number(a.id) - Number(b.id))) {
    lines.push([
      row.id,
      row.domain,
      row.status,
      row.started_at,
      row.completed_at,
      row.artifact,
      row.lead_count,
      row.error,
      row.retries,
    ].map(cell).join('\t'));
  }
  await writeFile(STATE_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function updateStateRow(workflow, row) {
  return workflow.withMutex('batch-state', async () => {
    const rows = await readState();
    const current = rows.get(row.id) || {};
    const next = normalizeStateRow({ ...current, ...row });
    rows.set(next.id, next);
    await writeState(rows);
    return next;
  });
}

function selectPending(domains, rows, opts) {
  const pending = [];
  for (const item of domains) {
    const numericId = Number.parseInt(item.id, 10);
    if (!Number.isNaN(numericId) && numericId < opts.startFrom) continue;
    const status = rows.get(item.id)?.status || 'none';
    const retries = retriesFor(rows, item.id);
    if (opts.retryFailed) {
      if (status !== 'failed') continue;
      if (retries >= opts.maxRetries) continue;
    } else if (status === 'completed') {
      continue;
    } else if (status === 'failed' && retries >= opts.maxRetries) {
      continue;
    }
    pending.push(item);
  }
  return pending;
}

async function processDomain(workflow, item, opts) {
  const startedAt = nowIso();
  const logFile = join(LOGS_DIR, `domain-${item.id}.log`);
  const artifact = `batch/lead-results-${item.id}.json`;
  const rows = await readState();
  const retries = retriesFor(rows, item.id);

  await updateStateRow(workflow, {
    id: item.id,
    domain: item.domain,
    status: 'processing',
    started_at: startedAt,
    completed_at: '-',
    artifact,
    lead_count: '-',
    error: '-',
    retries,
  });

  const prompt = buildWorkerPrompt(item, artifact);
  const run = await withWorkerLiveness(workflow, item, logFile, () => runWorker(opts, prompt, logFile));
  const statuses = parseStatusLines(run.output);
  const status = statuses.get(item.id);

  if (run.exitCode !== 0 || !status || status.status !== 'completed') {
    const message = status?.error || `worker failed with exit ${run.exitCode}`;
    await updateStateRow(workflow, {
      id: item.id,
      status: 'failed',
      completed_at: nowIso(),
      error: message,
      retries: retries + 1,
    });
    return { id: item.id, status: 'failed', error: message };
  }

  const manifest = spawnSync(process.execPath, [
    join(PKG_ROOT, 'scripts/manifest.mjs'),
    '--input',
    status.artifact || artifact,
  ], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      PUBLIC_LEADS_PROJECT: PROJECT_DIR,
      PUBLIC_LEADS_ROOT: PKG_ROOT,
      LEAD_HARNESS_PROJECT: PROJECT_DIR,
      LEAD_HARNESS_ROOT: PKG_ROOT,
    },
    encoding: 'utf8',
  });

  if (manifest.status !== 0) {
    const message = (manifest.stderr || manifest.stdout || 'manifest update failed').trim();
    await updateStateRow(workflow, {
      id: item.id,
      status: 'failed',
      completed_at: nowIso(),
      error: message,
      retries: retries + 1,
    });
    return { id: item.id, status: 'failed', error: message };
  }

  await updateStateRow(workflow, {
    id: item.id,
    status: 'completed',
    completed_at: nowIso(),
    artifact: status.artifact || artifact,
    lead_count: String(status.leadCount ?? 0),
    error: '-',
    retries,
  });
  return { id: item.id, status: 'completed', artifact: status.artifact || artifact, leadCount: status.leadCount ?? 0 };
}

function buildWorkerPrompt(item, artifact) {
  return `Process this assigned public-leads domain.

Assignment:
${JSON.stringify({ ...item, artifact }, null, 2)}

Write the artifact exactly to ${artifact}. Validate it with:
npx public-leads validate --input ${artifact}

Finish with one JSON status line:
{"id":"${item.id}","status":"completed|failed","domain":"${item.domain}","leadCount":0,"artifact":"${artifact}","error":null}`;
}

async function runWorker(opts, prompt, logFile) {
  if (opts.runner === 'codex') return runCodex(prompt, logFile, opts);
  return runOpencode(prompt, logFile, opts);
}

async function runOpencode(prompt, logFile, opts) {
  await ensureDir(dirname(logFile));
  return new Promise((resolveRun) => {
    const args = ['run'];
    if (opts.allowUnsafeWorkers) args.push('--dangerously-skip-permissions');
    args.push('--file', PROMPT_FILE, prompt);
    const child = spawn('opencode', args, {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        PUBLIC_LEADS_PROJECT: PROJECT_DIR,
        LEAD_HARNESS_PROJECT: PROJECT_DIR,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    collectChild(child, logFile, resolveRun);
  });
}

async function runCodex(prompt, logFile, opts) {
  await ensureDir(dirname(logFile));
  const basePrompt = await readTextIfExists(PROMPT_FILE);
  return new Promise((resolveRun) => {
    const args = ['exec'];
    if (opts.allowUnsafeWorkers) args.push('--dangerously-bypass-approvals-and-sandbox');
    args.push('-C', PROJECT_DIR, `${basePrompt.trim()}\n\n${prompt}`);
    const child = spawn('codex', args, {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        PUBLIC_LEADS_PROJECT: PROJECT_DIR,
        LEAD_HARNESS_PROJECT: PROJECT_DIR,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    collectChild(child, logFile, resolveRun);
  });
}

function collectChild(child, logFile, resolveRun) {
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  child.on('error', (error) => chunks.push(Buffer.from(`\n${error.stack || error.message}\n`)));
  child.on('close', async (code) => {
    const output = Buffer.concat(chunks).toString('utf8');
    await writeFile(logFile, output, 'utf8');
    resolveRun({ exitCode: code ?? 1, output });
  });
}

async function withWorkerLiveness(workflow, item, logFile, run) {
  const key = `worker:${item.id}`;
  const holder = `${process.pid}:${item.id}`;
  await workflow.touchLease(key, { holder, ttlMs: 120_000, detail: { domain: item.domain, log: rel(logFile), phase: 'starting' } });
  await workflow.heartbeat(key, { domain: item.domain, log: rel(logFile), phase: 'starting' });
  const timer = setInterval(() => {
    workflow.touchLease(key, { holder, ttlMs: 120_000, detail: { domain: item.domain, log: rel(logFile), phase: 'running' } }).catch(() => {});
    workflow.heartbeat(key, { domain: item.domain, log: rel(logFile), phase: 'running' }).catch(() => {});
  }, 30_000);
  timer.unref?.();
  try {
    return await run();
  } finally {
    clearInterval(timer);
    await workflow.heartbeat(key, { domain: item.domain, log: rel(logFile), phase: 'finished' }).catch(() => {});
    await workflow.releaseLease(key, holder).catch(() => {});
  }
}

function parseStatusLines(output) {
  const statuses = new Map();
  for (const line of output.split('\n')) {
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(line.slice(start, end + 1));
      if (parsed?.id && parsed?.status) statuses.set(String(parsed.id), parsed);
    } catch {
      // Worker logs can contain non-JSON diagnostics.
    }
  }
  return statuses;
}

function parseRunner(value) {
  const runner = String(value || '').trim().toLowerCase();
  if (runner === 'opencode' || runner === 'codex') return runner;
  throw new Error('--runner must be opencode or codex');
}

function workerCommandName(runner) {
  return runner === 'codex' ? 'codex' : 'opencode';
}

function normalizeStateRow(row) {
  return {
    id: cell(row.id, ''),
    domain: normalizeDomain(row.domain),
    status: cell(row.status, 'none'),
    started_at: cell(row.started_at),
    completed_at: cell(row.completed_at),
    artifact: cell(row.artifact),
    lead_count: cell(row.lead_count),
    error: cell(row.error),
    retries: String(nonNegativeInt(row.retries || 0, 'retries')),
  };
}

function retriesFor(rows, id) {
  const n = Number.parseInt(rows.get(id)?.retries || '0', 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function positiveInt(value, label) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`);
  return n;
}

function boundedParallel(value, label) {
  const n = positiveInt(value, label);
  if (n > MAX_PARALLEL_WORKERS) {
    throw new Error(`${label} must be ${MAX_PARALLEL_WORKERS} or less; split larger queues into multiple rounds`);
  }
  return n;
}

function nonNegativeInt(value, label) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer`);
  return n;
}

function envFlag(name) {
  return /^(1|true|yes)$/i.test(String(process.env[name] || '').trim());
}

function sanitizeWorkflowId(value) {
  const clean = String(value || '').trim().replace(/[^a-zA-Z0-9._:-]+/g, '-');
  if (!clean) throw new Error('--workflow-id cannot be empty');
  return clean;
}

function normalizeDomain(value) {
  let raw = cell(value, '').toLowerCase();
  if (!raw) return '';
  if (!raw.includes('://')) raw = `https://${raw}`;
  try {
    raw = new URL(raw).hostname;
  } catch {
    raw = raw.replace(/^https?:\/\//, '').split('/')[0];
  }
  return raw.replace(/^www\./, '').replace(/\.$/, '').trim();
}

function cell(value, fallback = '-') {
  const text = value === undefined || value === null || value === '' ? fallback : String(value);
  return text.replace(/[\t\r\n]+/g, ' ').trim() || fallback;
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function nowIso() {
  return new Date().toISOString();
}

function rel(path) {
  return path.startsWith(PROJECT_DIR) ? path.slice(PROJECT_DIR.length + 1) : path;
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function readTextIfExists(path) {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf8');
}
