#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const PROJECT_DIR = process.env.INIT_CWD || process.env.PUBLIC_LEADS_PROJECT || process.env.LEAD_HARNESS_PROJECT || process.cwd();

const pkgJsonPath = join(PROJECT_DIR, 'package.json');
if (existsSync(pkgJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    if (new Set(['@agent-pattern-labs/public-leads-harness', 'public-leads-harness', 'leads-agentic-harness']).has(pkg.name) && PROJECT_DIR === PKG_ROOT) {
      console.log('public-leads sync: skipping (running inside harness repo).');
      process.exit(0);
    }
  } catch {
    // Ignore malformed consumer package files; symlink sync can still run.
  }
}

if (PROJECT_DIR === PKG_ROOT) {
  console.log('public-leads sync: skipping (PROJECT_DIR == PKG_ROOT).');
  process.exit(0);
}

const links = [
  { src: '.cursor/mcp.json', dst: '.cursor/mcp.json' },
  { src: '.cursor/rules/main.mdc', dst: '.cursor/rules/main.mdc' },
  { src: '.cursor/rules/agent-general-free.mdc', dst: '.cursor/rules/agent-general-free.mdc' },
  { src: '.cursor/rules/agent-general-paid.mdc', dst: '.cursor/rules/agent-general-paid.mdc' },
  { src: '.cursor/rules/agent-glm-minimal.mdc', dst: '.cursor/rules/agent-glm-minimal.mdc' },
  { src: '.cursor/iso-route.md', dst: '.cursor/iso-route.md' },
  { src: '.mcp.json', dst: '.mcp.json' },
  { src: '.claude/agents', dst: '.claude/agents' },
  { src: '.claude/settings.json', dst: '.claude/settings.json' },
  { src: '.claude/iso-route.resolved.json', dst: '.claude/iso-route.resolved.json' },
  { src: '.codex/config.toml', dst: '.codex/config.toml' },
  { src: '.opencode/instructions.md', dst: '.opencode/instructions.md' },
  { src: '.opencode/skills/public-leads.md', dst: '.opencode/skills/public-leads.md' },
  { src: '.opencode/skills/lead-harness.md', dst: '.opencode/skills/lead-harness.md' },
  { src: '.opencode/agents', dst: '.opencode/agents' },
  { src: '.pi/skills', dst: '.pi/skills' },
  { src: '.pi/prompts', dst: '.pi/prompts' },
  { src: 'models.yaml', dst: 'models.yaml' },
  { src: 'modes', dst: 'modes' },
  { src: 'templates', dst: 'templates' },
  { src: 'batch/batch-prompt.md', dst: 'batch/batch-prompt.md' },
  { src: 'batch/batch-runner.sh', dst: 'batch/batch-runner.sh' },
  { src: 'batch/README.md', dst: 'batch/README.md' },
  { src: 'AGENTS.md', dst: 'AGENTS.harness.md' },
  { src: 'CLAUDE.md', dst: 'CLAUDE.harness.md' },
];

let created = 0;
let skipped = 0;
let warned = 0;

for (const { src, dst } of links) {
  const absSrc = join(PKG_ROOT, src);
  const absDst = join(PROJECT_DIR, dst);

  if (!existsSync(absSrc)) {
    console.warn(`  skip: ${src} not found in harness`);
    skipped++;
    continue;
  }

  const parent = dirname(absDst);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

  let stat = null;
  try {
    stat = lstatSync(absDst);
  } catch {
    // absent is expected
  }

  if (stat) {
    if (stat.isSymbolicLink()) {
      const current = readlinkSync(absDst);
      const expected = relative(dirname(absDst), absSrc);
      if (current === expected || resolve(dirname(absDst), current) === absSrc) {
        skipped++;
        continue;
      }
      console.warn(`  warn: ${dst} points elsewhere (${current}) -- leaving alone`);
      warned++;
      continue;
    }
    console.warn(`  warn: ${dst} already exists as a real file/dir -- leaving alone`);
    warned++;
    continue;
  }

  const relSrc = relative(dirname(absDst), absSrc);
  const type = lstatSync(absSrc).isDirectory() ? 'dir' : 'file';
  try {
    symlinkSync(relSrc, absDst, type);
    console.log(`  linked: ${dst} -> ${relSrc}`);
    created++;
  } catch (error) {
    console.error(`  error: failed to symlink ${dst}: ${error.message}`);
    warned++;
  }
}

try {
  if (ensureOpencodeInstructionRef()) created++;
} catch (error) {
  console.warn(`  warn: failed to patch opencode.json instructions: ${error.message}`);
  warned++;
}

console.log(`\npublic-leads sync: ${created} created, ${skipped} skipped, ${warned} warnings (project: ${PROJECT_DIR})`);

function ensureOpencodeInstructionRef() {
  const configPath = join(PROJECT_DIR, 'opencode.json');
  if (!existsSync(configPath)) return false;

  const raw = readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  const current = Array.isArray(config.instructions)
    ? config.instructions.slice()
    : config.instructions
      ? [config.instructions]
      : [];

  const required = '.opencode/instructions.md';
  if (current.includes(required)) return false;

  const next = current.slice();
  const anchor = next.indexOf('AGENTS.harness.md');
  if (anchor === -1) next.unshift(required);
  else next.splice(anchor + 1, 0, required);
  config.instructions = [...new Set(next)];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  updated: opencode.json instructions += ${required}`);
  return true;
}
