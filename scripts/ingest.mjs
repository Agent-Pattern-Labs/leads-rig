#!/usr/bin/env node

import {
  loadProfileConfig,
  parseArgs,
  readLeadArtifact,
  relativeProjectPath,
  validatePayload,
  writeJson,
} from '../lib/leadharness-leads.mjs';

const USAGE = `public-leads ingest -- submit validated leads to an ingest API

Usage:
  public-leads ingest --input <file> [--api <base-url>] [--ingest-path </path>]
                      [--operator-email <email>] [--operator-email-header <header>]
                      [--auth-header <header>] [--auth-scheme <scheme>]
                      [--token <token>] [--token-env PUBLIC_LEADS_API_TOKEN]
                      [--job-id <id>] [--out data/ingest-response.json] [--dry-run]

Defaults are read from config/profile.yml when present:
  api.base_url, api.ingest_path, api.operator_email, api.operator_email_header,
  api.auth_header, api.auth_scheme, api.auth_token_env

Legacy aliases are still accepted:
  --admin-email, api.admin_email, api.admin_token_env, $ADMIN_API_TOKEN
`;

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.input) {
  console.log(USAGE);
  process.exit(opts.help ? 0 : 2);
}

try {
  const profile = loadProfileConfig();
  const apiBase = stripTrailingSlash(opts.api || process.env.PUBLIC_LEADS_API || process.env.LEAD_HARNESS_API || profile.baseUrl || 'http://localhost:8081');
  const ingestPath = normalizeEndpointPath(opts.ingestPath || process.env.PUBLIC_LEADS_INGEST_PATH || process.env.LEAD_HARNESS_INGEST_PATH || profile.ingestPath || '/api/lead-ingests');
  const legacyOperatorEmail = opts.adminEmail || process.env.PUBLIC_LEADS_ADMIN_EMAIL || process.env.LEAD_HARNESS_ADMIN_EMAIL || profile.adminEmail;
  const configuredOperatorEmail = opts.operatorEmail || process.env.PUBLIC_LEADS_OPERATOR_EMAIL || process.env.LEAD_HARNESS_OPERATOR_EMAIL || profile.operatorEmail;
  const operatorEmail = configuredOperatorEmail || legacyOperatorEmail || '';
  const operatorEmailHeader = opts.operatorEmailHeader
    || opts.adminEmailHeader
    || process.env.PUBLIC_LEADS_OPERATOR_EMAIL_HEADER
    || process.env.LEAD_HARNESS_OPERATOR_EMAIL_HEADER
    || profile.operatorEmailHeader
    || profile.adminEmailHeader
    || (legacyOperatorEmail ? 'X-Admin-Email' : '')
    || (operatorEmail ? 'X-Operator-Email' : '');
  const authHeader = opts.authHeader || process.env.PUBLIC_LEADS_AUTH_HEADER || process.env.LEAD_HARNESS_AUTH_HEADER || profile.authHeader || 'Authorization';
  const authScheme = opts.authScheme || process.env.PUBLIC_LEADS_AUTH_SCHEME || process.env.LEAD_HARNESS_AUTH_SCHEME || profile.authScheme || 'Bearer';
  const tokenEnv = opts.tokenEnv || profile.authTokenEnv || profile.adminTokenEnv || 'PUBLIC_LEADS_API_TOKEN';
  const token = opts.token || process.env[tokenEnv] || process.env.PUBLIC_LEADS_API_TOKEN || process.env.LEAD_HARNESS_API_TOKEN || process.env.ADMIN_API_TOKEN;
  const outputPath = opts.out || 'data/ingest-response.json';
  const endpoint = `${apiBase}${ingestPath}`;

  const payload = readLeadArtifact(opts.input);
  if (opts.jobId) payload.jobId = opts.jobId;

  const validation = validatePayload(payload);
  if (!validation.ok) {
    for (const item of validation.issues.filter((issue) => issue.severity === 'error')) {
      console.error(`error: ${item.path}: ${item.code}: ${item.message}`);
    }
    process.exit(1);
  }

  const ingestPayload = {
    ...(payload.jobId ? { jobId: payload.jobId } : {}),
    domains: payload.domains,
    leads: payload.leads,
    results: payload.results,
    errors: payload.errors,
  };

  if (opts.dryRun) {
    writeJson(outputPath, {
      status: 'DRY RUN',
      endpoint,
      input: opts.input,
      payload: ingestPayload,
      validation,
    });
    console.log(`dry run: wrote ${relativeProjectPath(outputPath)} (${ingestPayload.leads.length} leads)`);
    process.exit(0);
  }

  if (operatorEmailHeader && !operatorEmail) {
    throw new Error('operator email is required when an operator email header is configured');
  }
  if (!token) throw new Error(`API token is required (--token or $${tokenEnv})`);

  const headers = {
    [authHeader]: formatAuthHeaderValue(token, authScheme),
    'Content-Type': 'application/json',
  };
  if (operatorEmail && operatorEmailHeader) headers[operatorEmailHeader] = operatorEmail;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(ingestPayload),
  });

  let body;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  const output = {
    status: response.ok ? 'INGESTED' : 'INGEST FAILED',
    httpStatus: response.status,
    endpoint,
    input: opts.input,
    leadCount: ingestPayload.leads.length,
    response: body,
  };
  writeJson(outputPath, output);

  if (!response.ok) {
    console.error(`ingest failed HTTP ${response.status}; wrote ${relativeProjectPath(outputPath)}`);
    process.exit(1);
  }

  const jobId = body?.job?.id || ingestPayload.jobId || '';
  console.log(`ingested ${ingestPayload.leads.length} leads${jobId ? ` as job ${jobId}` : ''}; wrote ${relativeProjectPath(outputPath)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeEndpointPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/api/lead-ingests';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function formatAuthHeaderValue(token, scheme) {
  const cleanToken = String(token || '').trim();
  const cleanScheme = String(scheme || '').trim();
  return cleanScheme ? `${cleanScheme} ${cleanToken}` : cleanToken;
}
