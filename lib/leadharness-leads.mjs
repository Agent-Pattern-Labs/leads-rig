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
export const REJECTED_EMAIL_LOCAL_PREFIXES = [
  'admin',
  'booking',
  'bookings',
  'business',
  'contact',
  'customerservice',
  'customer-service',
  'customersuccess',
  'customer-success',
  'events',
  'hello',
  'help',
  'hi',
  'info',
  'inquiries',
  'enquiries',
  'media',
  'office',
  'outreach',
  'partners',
  'partnerships',
  'press',
  'sales',
  'service',
  'services',
  'speaking',
  'success',
  'support',
  'team',
];

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

  const leads = dedupeLeadRecords(payload.leads.map((lead) => normalizeLead(lead, { now })));
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
  const phone = stringValue(input.phone);
  const socialUrls = normalizeUrlList(input.socialUrls);
  const contactUrls = normalizeUrlList(input.contactUrls);

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
    sources: normalizeLeadSources(input.sources, {
      sourceUrl,
      sourceLabel: stringValue(input.sourceLabel) || sourceUrl,
      evidence: compactWhitespace(stringValue(input.evidence)),
    }),
    evidence: compactWhitespace(stringValue(input.evidence)),
    extractionMethod: stringValue(input.extractionMethod) || 'agentic_harness',
    verificationStatus,
    confidence,
    warnings: normalizeWarnings(input.warnings),
    phone,
    socialUrls,
    contactUrls,
    foundAt,
  };

  if (!lead.id) lead.id = stableLeadID(lead);
  return normalizeLeadRecord(lead);
}

export function normalizeResult(input, { now = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('result must be an object');
  }
  const domain = normalizeDomain(input.domain || domainFromUrl(input.websiteUrl || ''));
  return {
    domain,
    websiteUrl: stringValue(input.websiteUrl) || (domain ? `https://${domain}/` : ''),
    leads: Array.isArray(input.leads)
      ? dedupeLeadRecords(input.leads.map((lead) => normalizeLead(lead, { now })))
      : [],
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
    phonesFound: clampInteger(input.phonesFound, 0, 100000, 0),
    socialUrlsFound: clampInteger(input.socialUrlsFound, 0, 100000, 0),
    contactUrlsFound: clampInteger(input.contactUrlsFound, 0, 100000, 0),
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
    const key = stableLeadKey(lead);
    if (leadKeys.has(key)) {
      issues.push(issue('warning', `leads[${index}]`, 'duplicate_lead_key', 'duplicate lead identity fields'));
    }
    leadKeys.add(key);
  });

  results.forEach((result, index) => {
    validateResult(result, `results[${index}]`, issues);
    result.leads.forEach((lead, leadIndex) => {
      validateLead(lead, `results[${index}].leads[${leadIndex}]`, issues);
    });
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
  if (lead.email && isRejectedLeadEmail(lead.email)) {
    issues.push(issue('error', `${path}.email`, 'generic_inbox_rejected', 'generic company inboxes such as info@, hello@, or support@ are not accepted; submit named people instead'));
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
  if (lead.phone && !/^\+\d{10,15}$/.test(lead.phone)) {
    issues.push(issue('warning', `${path}.phone`, 'phone_not_normalized', 'phone should be normalized E.164-style when present'));
  }
  if (!Array.isArray(lead.socialUrls)) {
    issues.push(issue('error', `${path}.socialUrls`, 'invalid_social_urls', 'socialUrls must be an array'));
  } else {
    lead.socialUrls.forEach((url, index) => {
      if (!isHttpUrl(url)) issues.push(issue('warning', `${path}.socialUrls[${index}]`, 'invalid_social_url', 'socialUrls entries should be http(s) URLs'));
    });
  }
  if (!Array.isArray(lead.contactUrls)) {
    issues.push(issue('error', `${path}.contactUrls`, 'invalid_contact_urls', 'contactUrls must be an array'));
  } else {
    lead.contactUrls.forEach((url, index) => {
      if (!isHttpUrl(url)) issues.push(issue('warning', `${path}.contactUrls[${index}]`, 'invalid_contact_url', 'contactUrls entries should be http(s) URLs'));
    });
  }
  if (!Array.isArray(lead.warnings)) {
    issues.push(issue('error', `${path}.warnings`, 'invalid_warnings', 'warnings must be an array'));
  }
  if (!Array.isArray(lead.sources)) {
    issues.push(issue('error', `${path}.sources`, 'invalid_sources', 'sources must be an array'));
  } else {
    lead.sources.forEach((source, index) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        issues.push(issue('error', `${path}.sources[${index}]`, 'invalid_source', 'sources entries must be objects'));
        return;
      }
      if (!isHttpUrl(source.url)) {
        issues.push(issue('error', `${path}.sources[${index}].url`, 'invalid_source_url', 'sources entries require an http(s) URL'));
      }
    });
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
  const uniqueEmails = new Set();
  const mxVerifiedEmails = new Set();
  for (const lead of leads) {
    byType[lead.emailType || 'unknown'] = (byType[lead.emailType || 'unknown'] || 0) + 1;
    confidenceTotal += Number.isFinite(lead.confidence) ? lead.confidence : 0;
    if (lead.email) {
      withEmail++;
      uniqueEmails.add(String(lead.email).toLowerCase());
      if (lead.verificationStatus === 'mx_verified' || lead.verificationStatus === 'verified') {
        mxVerifiedEmails.add(String(lead.email).toLowerCase());
      }
    }
  }
  return {
    domains,
    domainCount: domains.length,
    leadCount: leads.length,
    resultCount: results.length,
    withEmail,
    uniqueEmailCount: uniqueEmails.size,
    mxVerifiedEmailCount: mxVerifiedEmails.size,
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
    targetProject: yamlScalar(text, 'target_project'),
    operatorEmail: yamlScalar(text, 'operator_email'),
    operatorEmailHeader: yamlScalar(text, 'operator_email_header'),
    authHeader: yamlScalar(text, 'auth_header'),
    authScheme: yamlScalar(text, 'auth_scheme'),
    authTokenEnv: yamlScalar(text, 'auth_token_env'),
    adminEmail: yamlScalar(text, 'admin_email'),
    adminEmailHeader: yamlScalar(text, 'admin_email_header'),
    adminTokenEnv: yamlScalar(text, 'admin_token_env'),
    maxPages: yamlScalar(text, 'max_pages'),
    maxDomainsPerBatch: yamlScalar(text, 'max_domains_per_batch'),
    concurrency: yamlScalar(text, 'concurrency'),
    userAgent: yamlScalar(text, 'user_agent'),
    minConfidence: yamlScalar(text, 'min_confidence'),
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

export function dedupeLeadRecords(leads) {
  const byKey = new Map();
  for (const rawLead of leads || []) {
    const lead = normalizeLeadRecord(rawLead);
    const key = stableLeadKey(lead);
    const current = byKey.get(key);
    byKey.set(key, current ? mergeLeadRecords(current, lead) : lead);
  }
  return [...byKey.values()];
}

function normalizeLeadRecord(lead) {
  const sources = normalizeLeadSources(lead?.sources, {
    sourceUrl: lead?.sourceUrl,
    sourceLabel: lead?.sourceLabel,
    evidence: lead?.evidence,
  });
  const normalized = {
    ...lead,
    sourceUrl: sources[0]?.url || stringValue(lead?.sourceUrl),
    sourceLabel: sources[0]?.label || stringValue(lead?.sourceLabel),
    sources,
    evidence: sources[0]?.evidence || compactWhitespace(lead?.evidence),
    warnings: normalizeWarnings(lead?.warnings),
    socialUrls: normalizeUrlList(lead?.socialUrls),
    contactUrls: normalizeUrlList(lead?.contactUrls),
  };
  normalized.id = stableLeadID(normalized);
  return normalized;
}

export function mergeLeadRecords(current, candidate) {
  const left = normalizeLeadRecord(current);
  const right = normalizeLeadRecord(candidate);
  const primary = leadQualityScore(right) > leadQualityScore(left) ? right : left;
  const secondary = primary === right ? left : right;

  const merged = {
    ...primary,
    company: primary.company || secondary.company,
    domain: primary.domain || secondary.domain,
    websiteUrl: primary.websiteUrl || secondary.websiteUrl,
    contactName: primary.contactName || secondary.contactName,
    title: primary.title || secondary.title,
    email: primary.email || secondary.email,
    emailType: primary.emailType || secondary.emailType,
    extractionMethod: primary.extractionMethod || secondary.extractionMethod,
    verificationStatus: verificationRank(secondary.verificationStatus) > verificationRank(primary.verificationStatus)
      ? secondary.verificationStatus
      : primary.verificationStatus,
    confidence: Math.max(primary.confidence || 0, secondary.confidence || 0),
    phone: primary.phone || secondary.phone,
    socialUrls: normalizeUrlList([...(primary.socialUrls || []), ...(secondary.socialUrls || [])]),
    contactUrls: normalizeUrlList([...(primary.contactUrls || []), ...(secondary.contactUrls || [])]),
    warnings: normalizeWarnings([...(primary.warnings || []), ...(secondary.warnings || [])]),
  };

  merged.foundAt = earliestDateTime(primary.foundAt, secondary.foundAt);
  if ((secondary.evidence || '').length > (merged.evidence || '').length) {
    merged.evidence = secondary.evidence;
  }

  merged.sources = mergeLeadSources(merged.sourceUrl, left.sources, right.sources);
  merged.sourceUrl = merged.sources[0]?.url || merged.sourceUrl;
  merged.sourceLabel = merged.sources[0]?.label || merged.sourceLabel;
  if (!merged.evidence) {
    merged.evidence = merged.sources[0]?.evidence || '';
  }
  merged.id = stableLeadID(merged);
  return normalizeLeadRecord(merged);
}

function normalizeLeadSources(value, fallback = {}) {
  const byUrl = new Map();
  const ordered = [];
  const addSource = (source) => {
    const url = stringValue(source?.url);
    if (!url) return;

    const entry = {
      url,
      label: stringValue(source?.label) || defaultSourceLabel(url),
      evidence: compactWhitespace(source?.evidence),
    };
    const current = byUrl.get(url);
    if (!current) {
      byUrl.set(url, entry);
      ordered.push(url);
      return;
    }
    byUrl.set(url, {
      url,
      label: current.label || entry.label,
      evidence: entry.evidence.length > current.evidence.length ? entry.evidence : current.evidence,
    });
  };

  if (Array.isArray(value)) {
    value.forEach(addSource);
  }
  addSource({
    url: fallback.sourceUrl,
    label: fallback.sourceLabel,
    evidence: fallback.evidence,
  });

  const preferredUrl = stringValue(fallback.sourceUrl);
  return ordered
    .map((url) => byUrl.get(url))
    .sort((left, right) => sourceSortValue(right, preferredUrl) - sourceSortValue(left, preferredUrl) || left.label.localeCompare(right.label) || left.url.localeCompare(right.url));
}

function mergeLeadSources(preferredUrl, ...lists) {
  return normalizeLeadSources(lists.flat(), { sourceUrl: preferredUrl });
}

function sourceSortValue(source, preferredUrl) {
  if (preferredUrl && source.url === preferredUrl) return 10_000;
  return pagePriority(source.url || '') * 100 + Math.min((source.evidence || '').length, 99);
}

export function stableLeadID(lead) {
  const key = stableLeadKey(lead);
  if (!key.replace(/\|/g, '').trim()) return `agentic-${Date.now()}`;
  return createHash('sha1').update(key).digest('hex');
}

function stableLeadKey(lead) {
  if (lead?.email) {
    return ['email', lead.domain || '', lead.email || ''].join('|').toLowerCase();
  }
  if (lead?.emailType === 'contact_path') {
    return ['contact_path', lead.domain || ''].join('|').toLowerCase();
  }
  return [
    lead?.email || '',
    lead?.sourceUrl || '',
    lead?.domain || '',
    lead?.contactName || '',
    lead?.title || '',
  ].join('|').toLowerCase();
}

function leadQualityScore(lead) {
  return (lead?.confidence || 0) * 1000
    + verificationRank(lead?.verificationStatus) * 100
    + pagePriority(lead?.sourceUrl || '') * 10
    + (Array.isArray(lead?.sources) ? lead.sources.length : 0) * 5
    + (lead?.phone ? 25 : 0)
    + (Array.isArray(lead?.socialUrls) ? lead.socialUrls.length : 0) * 5
    + (Array.isArray(lead?.contactUrls) ? lead.contactUrls.length : 0) * 5
    + (lead?.contactName ? 20 : 0)
    + (lead?.title ? 10 : 0);
}

function verificationRank(value) {
  const status = stringValue(value).toLowerCase();
  if (status === 'verified' || status === 'mx_verified') return 4;
  if (status === 'unverified') return 3;
  if (status === 'not_applicable') return 2;
  if (status === 'unknown') return 1;
  return 0;
}

function earliestDateTime(...values) {
  const dates = values
    .map((value) => stringValue(value))
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  return dates[0]?.toISOString() || new Date().toISOString();
}

function defaultSourceLabel(sourceUrl) {
  const path = safePath(sourceUrl).replace(/^\/+|\/+$/g, '');
  if (!path) return 'Home';
  const last = path.split('/').filter(Boolean).pop() || path;
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function safePath(value) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function pagePriority(link) {
  const path = safePath(link);
  const weighted = [
    ['contact', 100],
    ['about', 90],
    ['team', 85],
    ['people', 85],
    ['leadership', 85],
    ['staff', 80],
    ['founder', 80],
    ['press', 65],
    ['media', 65],
    ['blog', 55],
    ['author', 55],
    ['career', 45],
    ['privacy', 25],
    ['legal', 20],
    ['impressum', 20],
  ];
  for (const [needle, score] of weighted) {
    if (path.includes(needle)) return score;
  }
  return path === '/' ? 50 : 0;
}

export function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function isRejectedLeadEmail(email) {
  const local = String(email || '').trim().toLowerCase().split('@')[0] || '';
  return isRejectedLeadLocalPart(local);
}

export function isRejectedLeadLocalPart(local) {
  const value = normalizeRejectedLeadLocalPart(local);
  if (!value) return false;
  return REJECTED_EMAIL_LOCAL_PREFIXES.some((prefix) => {
    if (value === prefix) return true;
    if (!value.startsWith(prefix) || value.length === prefix.length) return false;
    const next = value[prefix.length];
    return next === '.' || next === '_' || next === '-' || next === '+' || /\d/.test(next);
  });
}

function normalizeRejectedLeadLocalPart(local) {
  let value = String(local || '').trim().toLowerCase();
  for (const noise of ['mailto', 'u003e', 'email']) {
    if (value.startsWith(noise)) value = value.slice(noise.length);
  }
  return value.replace(/^[>._+-]+/, '');
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
  return [...new Set(value.map((item) => stringValue(item)).filter(Boolean))];
}

function normalizeUrlList(value) {
  if (!Array.isArray(value)) return [];
  const urls = [];
  const seen = new Set();
  for (const item of value) {
    const url = stringValue(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
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
