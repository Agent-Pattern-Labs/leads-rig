import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path';

export const PROJECT_DIR = process.env.PUBLIC_LEADS_PROJECT || process.env.LEAD_HARNESS_PROJECT || process.cwd();
export const HARNESS_ROOT = process.env.PUBLIC_LEADS_ROOT || process.env.LEAD_HARNESS_ROOT || resolve(dirname(new URL(import.meta.url).pathname), '..');

export const DEFAULT_ARTIFACT_GLOBS = [
  'data/lead-results.json',
  'data/lead-results.jsonl',
  'batch/lead-results.json',
  'batch/lead-results.jsonl',
];

export const ALLOWED_EMAIL_TYPES = new Set(['person', 'role', 'blocked', 'contact_path', 'unknown']);
export const ALLOWED_VERIFICATION_STATUSES = new Set([
  'verified',
  'mx_verified',
  'unverified',
  'not_applicable',
  'blocked',
  'unknown',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function resolveProjectPath(input, root = PROJECT_DIR) {
  return isAbsolute(input) ? input : resolve(root, input);
}

export function relativeProjectPath(input, root = PROJECT_DIR) {
  return relative(root, input) || '.';
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function parseArgs(args) {
  const opts = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      const [flag, inline] = arg.split('=', 2);
      const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) {
        opts[key] = inline;
      } else if (args[i + 1] && !args[i + 1].startsWith('--')) {
        opts[key] = args[++i];
      } else {
        opts[key] = true;
      }
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

export function readLeadArtifact(path, { now = new Date().toISOString() } = {}) {
  const abs = resolveProjectPath(path);
  if (!existsSync(abs)) throw new Error(`input not found: ${path}`);
  const raw = readFileSync(abs, 'utf8');
  const value = extname(abs).toLowerCase() === '.jsonl'
    ? parseJsonl(raw, abs)
    : JSON.parse(raw);
  return normalizePayload(value, { now });
}

export function normalizePayload(value, { now = new Date().toISOString(), sourcePath = '' } = {}) {
  let payload;
  if (Array.isArray(value)) {
    payload = { leads: value };
  } else if (value && typeof value === 'object' && Array.isArray(value.leads)) {
    payload = { ...value };
  } else if (value && typeof value === 'object' && value.lead && typeof value.lead === 'object') {
    payload = { leads: [value.lead] };
  } else {
    throw new Error('lead artifact must be a JSON array, JSONL records, or an object with a leads array');
  }

  const leads = payload.leads.map((lead) => normalizeLead(lead, { now }));
  const results = Array.isArray(payload.results)
    ? payload.results.map((result) => normalizeResult(result, { now }))
    : [];
  const domains = cleanDomains([
    ...(Array.isArray(payload.domains) ? payload.domains : []),
    ...results.map((result) => result.domain),
    ...leads.map((lead) => lead.domain),
  ]);
  const errors = Array.isArray(payload.errors)
    ? payload.errors.map((error) => String(error)).filter(Boolean)
    : [];

  return {
    ...(payload.jobId ? { jobId: String(payload.jobId).trim() } : {}),
    domains,
    leads,
    results,
    errors,
    ...(sourcePath ? { sourcePath } : {}),
  };
}

export function normalizeLead(input, { now = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('lead must be an object');
  }

  const domain = normalizeDomain(input.domain || domainFromUrl(input.websiteUrl || input.sourceUrl || '') || '');
  const email = stringValue(input.email).toLowerCase();
  const sourceUrl = stringValue(input.sourceUrl);
  const contactName = stringValue(input.contactName);
  const title = stringValue(input.title);
  const emailType = normalizeEmailType(input.emailType, email);
  const verificationStatus = normalizeVerificationStatus(input.verificationStatus, emailType);
  const confidence = clampInteger(input.confidence, 0, 100, 0);
  const foundAt = normalizeDateTime(input.foundAt, now);

  const lead = {
    id: stringValue(input.id),
    company: stringValue(input.company) || displayCompany(domain),
    domain,
    websiteUrl: stringValue(input.websiteUrl) || (domain ? `https://${domain}/` : ''),
    contactName,
    title,
    email,
    emailType,
    sourceUrl,
    sourceLabel: stringValue(input.sourceLabel) || sourceUrl,
    evidence: compactWhitespace(stringValue(input.evidence)),
    extractionMethod: stringValue(input.extractionMethod) || 'agentic_harness',
    verificationStatus,
    confidence,
    warnings: normalizeWarnings(input.warnings),
    foundAt,
  };

  if (!lead.id) lead.id = stableLeadID(lead);
  return lead;
}

export function normalizeResult(input, { now = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('result must be an object');
  }
  const domain = normalizeDomain(input.domain || domainFromUrl(input.websiteUrl || ''));
  return {
    domain,
    websiteUrl: stringValue(input.websiteUrl) || (domain ? `https://${domain}/` : ''),
    leads: Array.isArray(input.leads) ? input.leads.map((lead) => normalizeLead(lead, { now })) : [],
    pages: Array.isArray(input.pages) ? input.pages.map(normalizePageVisit) : [],
    warnings: normalizeWarnings(input.warnings),
    completedAt: normalizeDateTime(input.completedAt, now),
  };
}

export function normalizePageVisit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { url: '', title: '', statusCode: 0, emailsFound: 0 };
  }
  const page = {
    url: stringValue(input.url),
    title: stringValue(input.title),
    statusCode: clampInteger(input.statusCode, 0, 999, 0),
    emailsFound: clampInteger(input.emailsFound, 0, 100000, 0),
  };
  if (input.error) page.error = stringValue(input.error);
  return page;
}

export function validatePayload(payload, { allowEmpty = false } = {}) {
  const issues = [];
  const leads = Array.isArray(payload?.leads) ? payload.leads : [];
  const results = Array.isArray(payload?.results) ? payload.results : [];

  if (!allowEmpty && leads.length === 0) {
    issues.push(issue('error', 'leads', 'missing_leads', 'at least one lead is required'));
  }

  if (!Array.isArray(payload?.domains)) {
    issues.push(issue('error', 'domains', 'invalid_domains', 'domains must be an array'));
  }

  const ids = new Set();
  const leadKeys = new Set();
  leads.forEach((lead, index) => {
    validateLead(lead, `leads[${index}]`, issues);
    if (lead.id) {
      if (ids.has(lead.id)) {
        issues.push(issue('warning', `leads[${index}].id`, 'duplicate_id', `duplicate lead id ${lead.id}`));
      }
      ids.add(lead.id);
    }
    const key = `${lead.email || ''}|${lead.sourceUrl || ''}|${lead.domain || ''}|${lead.contactName || ''}|${lead.title || ''}`.toLowerCase();
    if (leadKeys.has(key)) {
      issues.push(issue('warning', `leads[${index}]`, 'duplicate_lead_key', 'duplicate lead identity fields'));
    }
    leadKeys.add(key);
  });

  results.forEach((result, index) => {
    validateResult(result, `results[${index}]`, issues);
  });

  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.filter((item) => item.severity === 'warning').length;
  return {
    ok: errors === 0,
    errors,
    warnings,
    issues,
    summary: summarizePayload(payload),
  };
}

export function validateLead(lead, path, issues) {
  requiredString(lead.domain, `${path}.domain`, 'domain is required', issues);
  requiredString(lead.emailType, `${path}.emailType`, 'emailType is required', issues);
  requiredString(lead.sourceUrl, `${path}.sourceUrl`, 'sourceUrl is required', issues);
  requiredString(lead.evidence, `${path}.evidence`, 'evidence is required', issues);
  requiredString(lead.extractionMethod, `${path}.extractionMethod`, 'extractionMethod is required', issues);
  requiredString(lead.verificationStatus, `${path}.verificationStatus`, 'verificationStatus is required', issues);

  if (lead.domain && normalizeDomain(lead.domain) !== lead.domain) {
    issues.push(issue('warning', `${path}.domain`, 'domain_not_normalized', 'domain should be lowercase without protocol or www'));
  }
  if (lead.email && !EMAIL_RE.test(lead.email)) {
    issues.push(issue('error', `${path}.email`, 'invalid_email', 'email must be a valid email address when present'));
  }
  if (lead.emailType && !ALLOWED_EMAIL_TYPES.has(lead.emailType)) {
    issues.push(issue('error', `${path}.emailType`, 'invalid_email_type', `emailType must be one of ${[...ALLOWED_EMAIL_TYPES].join(', ')}`));
  }
  if (lead.verificationStatus && !ALLOWED_VERIFICATION_STATUSES.has(lead.verificationStatus)) {
    issues.push(issue('error', `${path}.verificationStatus`, 'invalid_verification_status', `verificationStatus must be one of ${[...ALLOWED_VERIFICATION_STATUSES].join(', ')}`));
  }
  if (!Number.isInteger(lead.confidence) || lead.confidence < 0 || lead.confidence > 100) {
    issues.push(issue('error', `${path}.confidence`, 'invalid_confidence', 'confidence must be an integer from 0 to 100'));
  }
  if (lead.sourceUrl && !isHttpUrl(lead.sourceUrl)) {
    issues.push(issue('error', `${path}.sourceUrl`, 'invalid_source_url', 'sourceUrl must be an http(s) URL'));
  }
  if (lead.websiteUrl && !isHttpUrl(lead.websiteUrl)) {
    issues.push(issue('warning', `${path}.websiteUrl`, 'invalid_website_url', 'websiteUrl should be an http(s) URL'));
  }
  if (lead.emailType === 'contact_path' && lead.email) {
    issues.push(issue('warning', `${path}.email`, 'contact_path_with_email', 'contact_path leads should normally leave email empty'));
  }
  if ((lead.emailType === 'person' || lead.emailType === 'role') && !lead.email) {
    issues.push(issue('error', `${path}.email`, 'email_required', `${lead.emailType} leads require email`));
  }
  if (lead.emailType === 'blocked' && lead.confidence > 0) {
    issues.push(issue('warning', `${path}.confidence`, 'blocked_confidence', 'blocked operational inboxes should use confidence 0'));
  }
  if (lead.evidence && lead.evidence.length < 8) {
    issues.push(issue('warning', `${path}.evidence`, 'thin_evidence', 'evidence is very short'));
  }
  if (!Array.isArray(lead.warnings)) {
    issues.push(issue('error', `${path}.warnings`, 'invalid_warnings', 'warnings must be an array'));
  }
  if (lead.foundAt && Number.isNaN(Date.parse(lead.foundAt))) {
    issues.push(issue('error', `${path}.foundAt`, 'invalid_found_at', 'foundAt must be ISO datetime'));
  }
}

export function validateResult(result, path, issues) {
  requiredString(result.domain, `${path}.domain`, 'result domain is required', issues);
  if (result.websiteUrl && !isHttpUrl(result.websiteUrl)) {
    issues.push(issue('warning', `${path}.websiteUrl`, 'invalid_website_url', 'websiteUrl should be an http(s) URL'));
  }
  if (!Array.isArray(result.pages)) {
    issues.push(issue('error', `${path}.pages`, 'invalid_pages', 'pages must be an array'));
  }
  if (!Array.isArray(result.leads)) {
    issues.push(issue('error', `${path}.leads`, 'invalid_result_leads', 'result leads must be an array'));
  }
}

export function summarizePayload(payload) {
  const leads = Array.isArray(payload?.leads) ? payload.leads : [];
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const domains = cleanDomains(payload?.domains || leads.map((lead) => lead.domain));
  const byType = {};
  let confidenceTotal = 0;
  let withEmail = 0;
  for (const lead of leads) {
    byType[lead.emailType || 'unknown'] = (byType[lead.emailType || 'unknown'] || 0) + 1;
    confidenceTotal += Number.isFinite(lead.confidence) ? lead.confidence : 0;
    if (lead.email) withEmail++;
  }
  return {
    domains,
    domainCount: domains.length,
    leadCount: leads.length,
    resultCount: results.length,
    withEmail,
    byType,
    averageConfidence: leads.length ? Math.round(confidenceTotal / leads.length) : 0,
  };
}

export function createManifestRecord({ inputPath, payload, validation, generatedAt = new Date().toISOString() }) {
  const input = resolveProjectPath(inputPath);
  const hash = fileHash(input);
  return {
    id: payload.jobId || `lead-batch-${hash.slice(0, 12)}`,
    input: relativeProjectPath(input),
    inputSha256: hash,
    generatedAt,
    domains: payload.domains,
    leadCount: payload.leads.length,
    resultCount: payload.results.length,
    errorCount: payload.errors.length,
    validation: {
      ok: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    readyForIngest: validation.ok && payload.leads.length > 0,
  };
}

export function discoverLeadArtifacts(root = PROJECT_DIR) {
  const files = new Set();
  for (const rel of DEFAULT_ARTIFACT_GLOBS) {
    const abs = resolve(root, rel);
    if (existsSync(abs) && statSync(abs).isFile()) files.add(abs);
  }
  for (const dirRel of ['data', 'batch']) {
    const dir = resolve(root, dirRel);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!/^lead-results.*\.jsonl?$/.test(file) && !/^ingest-payload.*\.jsonl?$/.test(file)) continue;
      files.add(join(dir, file));
    }
  }
  return [...files].sort();
}

export function loadProfileConfig(root = PROJECT_DIR) {
  const path = resolve(root, 'config/profile.yml');
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  return {
    baseUrl: yamlScalar(text, 'base_url'),
    ingestPath: yamlScalar(text, 'ingest_path'),
    operatorEmail: yamlScalar(text, 'operator_email'),
    operatorEmailHeader: yamlScalar(text, 'operator_email_header'),
    authHeader: yamlScalar(text, 'auth_header'),
    authScheme: yamlScalar(text, 'auth_scheme'),
    authTokenEnv: yamlScalar(text, 'auth_token_env'),
    adminEmail: yamlScalar(text, 'admin_email'),
    adminEmailHeader: yamlScalar(text, 'admin_email_header'),
    adminTokenEnv: yamlScalar(text, 'admin_token_env'),
  };
}

export function cleanDomains(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const domain = normalizeDomain(value);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

export function normalizeDomain(value) {
  let raw = stringValue(value).toLowerCase();
  if (!raw) return '';
  if (!raw.includes('://')) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    raw = url.hostname;
  } catch {
    raw = raw.replace(/^https?:\/\//, '').split('/')[0];
  }
  return raw.replace(/^www\./, '').replace(/\.$/, '').trim();
}

export function domainFromUrl(value) {
  const raw = stringValue(value);
  if (!raw) return '';
  try {
    return normalizeDomain(new URL(raw).hostname);
  } catch {
    return '';
  }
}

export function stableLeadID(lead) {
  const key = [
    lead.email || '',
    lead.sourceUrl || '',
    lead.domain || '',
    lead.contactName || '',
    lead.title || '',
  ].join('|').toLowerCase();
  if (!key.replace(/\|/g, '').trim()) return `agentic-${Date.now()}`;
  return createHash('sha1').update(key).digest('hex');
}

export function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function issue(severity, path, code, message) {
  return { severity, path, code, message };
}

function parseJsonl(raw, path) {
  const records = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`${basename(path)}:${index + 1}: invalid JSONL: ${error.message}`);
    }
  }
  return records;
}

function normalizeEmailType(value, email) {
  const raw = stringValue(value).toLowerCase();
  if (ALLOWED_EMAIL_TYPES.has(raw)) return raw;
  return email ? 'unknown' : 'contact_path';
}

function normalizeVerificationStatus(value, emailType) {
  const raw = stringValue(value).toLowerCase();
  if (ALLOWED_VERIFICATION_STATUSES.has(raw)) return raw;
  if (emailType === 'contact_path') return 'not_applicable';
  if (emailType === 'blocked') return 'blocked';
  return 'unverified';
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function normalizeDateTime(value, fallback) {
  const raw = stringValue(value);
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function requiredString(value, path, message, issues) {
  if (!stringValue(value)) issues.push(issue('error', path, 'required', message));
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function stringValue(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function compactWhitespace(value) {
  return stringValue(value).replace(/\s+/g, ' ');
}

function displayCompany(domain) {
  const clean = normalizeDomain(domain);
  if (!clean) return '';
  const root = clean.split('.')[0] || clean;
  return root
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function yamlScalar(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)["']?`, 'm'));
  return match ? match[1].trim() : '';
}
