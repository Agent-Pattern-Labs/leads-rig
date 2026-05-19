import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  loadProfileConfig,
  readLeadArtifact,
  validatePayload,
  writeJson,
} from './leadharness-leads.mjs';

export function resolveIngestConfig(opts = {}, profile = loadProfileConfig()) {
  const targetEnv = loadTargetProjectEnv(opts.targetProject || profile.targetProject);
  const env = { ...process.env, ...targetEnv };
  const legacyOperatorEmail = opts.adminEmail || env.PUBLIC_LEADS_ADMIN_EMAIL || env.LEAD_HARNESS_ADMIN_EMAIL || profile.adminEmail;
  const configuredOperatorEmail = opts.operatorEmail || env.PUBLIC_LEADS_OPERATOR_EMAIL || env.LEAD_HARNESS_OPERATOR_EMAIL || profile.operatorEmail;
  const adminEmails = splitList(env.ADMIN_EMAILS);
  const operatorEmail = configuredOperatorEmail || legacyOperatorEmail || adminEmails[0] || '';
  const tokenEnv = opts.tokenEnv || profile.authTokenEnv || profile.adminTokenEnv || 'ADMIN_API_TOKEN';

  return {
    endpoint: `${stripTrailingSlash(opts.api || env.PUBLIC_LEADS_API || env.LEAD_HARNESS_API || profile.baseUrl || 'http://localhost:8080')}${normalizeEndpointPath(opts.ingestPath || env.PUBLIC_LEADS_INGEST_PATH || env.LEAD_HARNESS_INGEST_PATH || profile.ingestPath || '/api/lead-ingests')}`,
    operatorEmail,
    operatorEmailHeader: opts.operatorEmailHeader
      || opts.adminEmailHeader
      || env.PUBLIC_LEADS_OPERATOR_EMAIL_HEADER
      || env.LEAD_HARNESS_OPERATOR_EMAIL_HEADER
      || profile.operatorEmailHeader
      || profile.adminEmailHeader
      || (legacyOperatorEmail || adminEmails.length > 0 ? 'X-Admin-Email' : '')
      || (operatorEmail ? 'X-Operator-Email' : ''),
    authHeader: opts.authHeader || env.PUBLIC_LEADS_AUTH_HEADER || env.LEAD_HARNESS_AUTH_HEADER || profile.authHeader || 'Authorization',
    authScheme: opts.authScheme || env.PUBLIC_LEADS_AUTH_SCHEME || env.LEAD_HARNESS_AUTH_SCHEME || profile.authScheme || 'Bearer',
    tokenEnv,
    token: opts.token || env[tokenEnv] || env.PUBLIC_LEADS_API_TOKEN || env.LEAD_HARNESS_API_TOKEN || env.ADMIN_API_TOKEN,
  };
}

export async function ingestArtifact(inputPath, opts = {}) {
  const payload = readLeadArtifact(inputPath);
  if (opts.jobId) payload.jobId = opts.jobId;
  return ingestPayload(payload, { ...opts, input: inputPath });
}

export async function ingestPayload(payload, opts = {}) {
  const validation = validatePayload(payload);
  if (!validation.ok) {
    const errors = validation.issues.filter((issue) => issue.severity === 'error');
    throw new Error(errors.map((item) => `${item.path}: ${item.code}: ${item.message}`).join('\n'));
  }

  const config = resolveIngestConfig(opts);
  const ingestPayload = {
    ...(payload.jobId ? { jobId: payload.jobId } : {}),
    domains: payload.domains,
    leads: payload.leads,
    results: payload.results,
    errors: payload.errors,
  };

  if (opts.dryRun) {
    const output = {
      status: 'DRY RUN',
      endpoint: config.endpoint,
      input: opts.input || '',
      payload: ingestPayload,
      validation,
    };
    if (opts.out) writeJson(opts.out, output);
    return output;
  }

  if (config.operatorEmailHeader && !config.operatorEmail) {
    throw new Error('operator email is required when an operator email header is configured');
  }
  if (!config.token) {
    throw new Error(`API token is required (--token or $${config.tokenEnv})`);
  }

  const headers = {
    [config.authHeader]: formatAuthHeaderValue(config.token, config.authScheme),
    'Content-Type': 'application/json',
  };
  if (config.operatorEmail && config.operatorEmailHeader) {
    headers[config.operatorEmailHeader] = config.operatorEmail;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(ingestPayload),
  });
  const text = await response.text();
  const body = parseResponseBody(text);
  const output = {
    status: response.ok ? 'INGESTED' : 'INGEST FAILED',
    httpStatus: response.status,
    endpoint: config.endpoint,
    input: opts.input || '',
    leadCount: ingestPayload.leads.length,
    response: body,
  };
  if (opts.out) writeJson(opts.out, output);
  if (!response.ok) {
    throw new Error(`ingest failed HTTP ${response.status}`);
  }
  return output;
}

function loadTargetProjectEnv(targetProject) {
  const dir = String(targetProject || '').trim();
  if (!dir) return {};
  const envPath = resolve(dir, '.env');
  if (!existsSync(envPath)) return {};
  return parseEnv(readFileSync(envPath, 'utf8'));
}

function parseEnv(text) {
  const env = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (key) env[key] = value;
  }
  return env;
}

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
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

function parseResponseBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}
