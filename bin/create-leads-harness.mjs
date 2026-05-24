#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const HELP = args.includes('--help') || args.includes('-h');
const positional = args.filter((arg) => !arg.startsWith('--'));

if (HELP || positional.length === 0) {
  console.log(`create-public-leads-harness — scaffold a new lead discovery project

Usage:
  npx -p @agent-pattern-labs/leads-rig create-public-leads-harness <dir> [--force]

After scaffolding:
  cd <dir>
  npm install
  edit config/profile.yml and data/domains.tsv
  opencode
`);
  process.exit(HELP ? 0 : 1);
}

const targetDir = resolve(positional[0]);
const name = basename(targetDir);

console.log(`\nScaffolding lead harness project in ${targetDir}\n`);
if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

write('package.json', JSON.stringify({
  name,
  version: '0.1.0',
  private: true,
  scripts: {
    sync: 'public-leads sync',
    verify: 'public-leads verify',
    crawl: 'public-leads crawl',
    pipeline: 'public-leads pipeline',
    validate: 'public-leads validate',
    manifest: 'public-leads manifest',
    ingest: 'public-leads ingest',
    'trace:list': 'public-leads trace:list',
    'trace:stats': 'public-leads trace:stats',
    'trace:show': 'public-leads trace:show',
    'update-harness': 'npm install @agent-pattern-labs/leads-rig@latest && public-leads sync',
  },
  dependencies: {
    '@agent-pattern-labs/leads-rig': '^0.1.6',
  },
  engines: {
    node: '>=20.6.0',
  },
}, null, 2) + '\n');

write('opencode.json', JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  model: 'opencode-go/deepseek-v4-flash',
  small_model: 'opencode-go/deepseek-v4-flash',
  instructions: [
    'AGENTS.harness.md',
    '.opencode/instructions.md',
    'templates/lead-schema.json',
    'templates/states.yml',
    'modes/_shared.md',
  ],
  mcp: {
    geometra: {
      type: 'local',
      command: ['npx', '-y', '@geometra/mcp@1.61.3'],
      enabled: true,
    },
  },
  permission: {
    task: {
      'general-free': 'allow',
      'general-paid': 'allow',
      'glm-minimal': 'allow',
    },
  },
  tools: {
    'geometra_*': false,
  },
}, null, 2) + '\n');

write('AGENTS.md', `# AGENTS — ${name}

This is a consumer project for the @agent-pattern-labs/leads-rig package. Keep private configuration, target domains, and local artifacts here; the shared harness files are symlinked from \`node_modules/@agent-pattern-labs/leads-rig\` after \`npm install\`.

## Local Files

| What | Where |
|---|---|
| Harness rules | \`AGENTS.harness.md\` |
| Domain input | \`data/domains.tsv\` or \`data/pipeline.md\` |
| Lead artifacts | \`data/lead-results.json\`, \`batch/lead-results*.json\` |
| Manifest | \`data/lead-manifest.json\` |
| Ingest response | \`data/ingest-response.json\` |
| Config | \`config/profile.yml\` |
`);

copy('config/profile.example.yml', 'config/profile.yml');
write('data/domains.tsv', `domain\tcompany\tnotes
example.com\tExample\tSeed target
`);
write('data/pipeline.md', `# Lead Pipeline

- [ ] example.com | Example | Seed target
`);
write('reports/.gitkeep', '');
write('output/.gitkeep', '');
write('batch/logs/.gitkeep', '');
write('.gitignore', `node_modules/
.env
.env.*
config/profile.yml
data/*.json
data/*.jsonl
data/runs/
batch/*.json
batch/*.jsonl
batch/logs/*
!batch/logs/.gitkeep
reports/*
!reports/.gitkeep
output/*
!output/.gitkeep
`);
write('README.md', `# ${name}

Lead discovery project powered by \`@agent-pattern-labs/leads-rig\`.

## Start

\`\`\`bash
npm install
npm run verify
opencode
\`\`\`

Set \`PUBLIC_LEADS_API\`, \`PUBLIC_LEADS_API_TOKEN\`, and \`PUBLIC_LEADS_OPERATOR_EMAIL\` for upstream ingest. Add domains to \`data/domains.tsv\` or \`data/pipeline.md\`.
`);

console.log('\nNext: npm install, then edit config/profile.yml and data/domains.tsv.\n');

function write(rel, content, { overwrite = FORCE } = {}) {
  const abs = join(targetDir, rel);
  if (existsSync(abs) && !overwrite) {
    console.log(`  skip: ${rel} (exists)`);
    return;
  }
  const parent = dirname(abs);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(abs, content, 'utf8');
  console.log(`  create: ${rel}`);
}

function copy(srcRel, dstRel, { overwrite = FORCE } = {}) {
  const src = join(PKG_ROOT, srcRel);
  const abs = join(targetDir, dstRel);
  if (!existsSync(src)) {
    console.log(`  skip: ${dstRel} (template ${srcRel} missing)`);
    return;
  }
  if (existsSync(abs) && !overwrite) {
    console.log(`  skip: ${dstRel} (exists)`);
    return;
  }
  const parent = dirname(abs);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  copyFileSync(src, abs);
  console.log(`  create: ${dstRel}`);
}
