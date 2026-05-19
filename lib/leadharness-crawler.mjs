import { createHash } from 'crypto';
import { lookup, resolveMx } from 'dns/promises';
import { setTimeout as sleep } from 'timers/promises';
import { cleanDomains, normalizeDomain } from './leadharness-leads.mjs';

const DEFAULT_MAX_PAGES = 10;
const HARD_MAX_PAGES = 25;
const DEFAULT_TIMEOUT_MS = 14_000;
const DEFAULT_DELAY_MS = 200;
const DEFAULT_USER_AGENT = 'PublicLeadsBot/0.1 (+https://example.com/public-leads)';
const MAX_BODY_CHARS = 2 * 1024 * 1024;
const EMAIL_RE = /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/gi;
const NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;

export async function crawlDomains(inputs, options = {}) {
  const targets = normalizeCrawlTargets(inputs);
  if (targets.length === 0) {
    throw new Error('at least one domain is required');
  }

  const maxPages = boundedInteger(options.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
  const minConfidence = boundedInteger(options.minConfidence, 30, 0, 100);
  const includeBlocked = Boolean(options.includeBlocked);
  const results = [];
  const errors = [];
  const leadsByKey = new Map();

  for (const target of targets) {
    try {
      const result = await crawlDomainTarget(target, {
        ...options,
        maxPages,
        minConfidence,
        includeBlocked,
      });
      results.push(result);
      for (const lead of result.leads) {
        const key = leadKey(lead);
        const current = leadsByKey.get(key);
        if (!current || lead.confidence > current.confidence) {
          leadsByKey.set(key, lead);
        }
      }
    } catch (error) {
      errors.push(`${target.domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const leads = [...leadsByKey.values()].sort(sortLead);
  const domains = cleanDomains([
    ...targets.map((target) => target.domain),
    ...results.map((result) => result.domain),
    ...leads.map((lead) => lead.domain),
  ]);

  return {
    jobId: options.jobId || `public-leads-${timestampForID()}-${hash(domains.join('|')).slice(0, 8)}`,
    domains,
    leads,
    results,
    errors,
  };
}

export async function crawlDomain(input, options = {}) {
  const [target] = normalizeCrawlTargets([input]);
  if (!target) throw new Error('domain is required');
  return crawlDomainTarget(target, options);
}

export function normalizeCrawlTargets(inputs) {
  const out = [];
  const seen = new Set();
  for (const input of inputs || []) {
    const target = normalizeCrawlTarget(input);
    if (!target || seen.has(target.key)) continue;
    seen.add(target.key);
    out.push(target);
  }
  return out;
}

function normalizeCrawlTarget(input) {
  const rawInput = String(input || '').trim();
  if (!rawInput) return null;
  const raw = rawInput.includes('://') ? rawInput : `https://${rawInput}`;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol)) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const domain = normalizeDomain(host);
  const starts = [];
  if (parsed.pathname !== '/' || parsed.search) {
    parsed.hash = '';
    starts.push(parsed.toString());
  }
  starts.push(`${parsed.protocol}//${parsed.host}/`);
  if (!parsed.port && host !== 'localhost') {
    starts.push(`https://${host}/`, `http://${host}/`);
  }

  return {
    key: parsed.port ? `${host}:${parsed.port}` : host,
    domain,
    host,
    starts: [...new Set(starts)],
  };
}

async function crawlDomainTarget(target, options) {
  const maxPages = boundedInteger(options.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
  const minConfidence = boundedInteger(options.minConfidence, 30, 0, 100);
  const queue = [...target.starts];
  const queued = new Set(queue);
  const seen = new Set();
  const leadsByKey = new Map();
  const warnings = [];
  const pages = [];
  const robotsCache = new Map();
  let websiteUrl = '';

  while (queue.length > 0 && pages.length < maxPages) {
    const pageUrl = queue.shift();
    if (!pageUrl || seen.has(pageUrl)) continue;
    seen.add(pageUrl);

    const allowed = await allowedByRobots(pageUrl, robotsCache, options, warnings);
    if (!allowed) {
      pages.push({ url: pageUrl, title: '', statusCode: 0, emailsFound: 0, error: 'blocked by robots.txt' });
      continue;
    }

    const page = await fetchPage(pageUrl, options).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    if (page.error) {
      pages.push({ url: pageUrl, title: '', statusCode: 0, emailsFound: 0, error: page.error });
      continue;
    }

    if (!websiteUrl) websiteUrl = originOf(page.url);
    pages.push({
      url: page.url,
      title: page.title,
      statusCode: page.statusCode,
      emailsFound: page.emails.length,
    });

    for (const email of page.emails) {
      const lead = await buildEmailLead(email, target.domain, websiteUrl, page.url, page.title, page.text);
      if (!isRelevantLead(lead, { minConfidence, includeBlocked: options.includeBlocked })) continue;
      const key = leadKey(lead);
      const current = leadsByKey.get(key);
      if (!current || lead.confidence > current.confidence) {
        leadsByKey.set(key, lead);
      }
    }

    if (page.hasForm && isContactLikeURL(page.url)) {
      const lead = buildContactPath(target.domain, websiteUrl, page.url, page.title, page.text);
      if (isRelevantLead(lead, { minConfidence, includeBlocked: options.includeBlocked })) {
        leadsByKey.set(lead.id, lead);
      }
    }

    for (const link of page.links) {
      if (queued.has(link) || seen.has(link)) continue;
      if (!sameDomain(target.domain, link) || !isHighSignalPage(link)) continue;
      queued.add(link);
      queue.push(link);
    }
    queue.sort((a, b) => pagePriority(b) - pagePriority(a));
    await sleep(boundedInteger(options.delayMs, DEFAULT_DELAY_MS, 0, 10_000));
  }

  const leads = [...leadsByKey.values()].sort(sortLead);
  const completedAt = new Date().toISOString();
  if (pages.length === 0) {
    warnings.push(`no pages could be crawled for ${target.domain}`);
  }
  return {
    domain: target.domain,
    websiteUrl: websiteUrl || `https://${target.domain}/`,
    leads,
    pages,
    warnings,
    completedAt,
  };
}

async function fetchPage(pageUrl, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000));
  try {
    const response = await fetch(pageUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('html')) {
      throw new Error(`skipped non-HTML content type ${contentType}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_CHARS) {
      throw new Error(`skipped large response (${contentLength} bytes)`);
    }

    const html = (await response.text()).slice(0, MAX_BODY_CHARS);
    const decoded = decodeEntities(html);
    const text = compactText(stripHtml(decoded));
    const finalUrl = response.url || pageUrl;
    return {
      url: finalUrl,
      statusCode: response.status,
      title: compactText(extractTitle(decoded)),
      text,
      links: extractLinks(finalUrl, decoded),
      emails: extractEmails(decoded),
      hasForm: /<form\b/i.test(decoded),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function allowedByRobots(pageUrl, cache, options, warnings) {
  const origin = originOf(pageUrl);
  if (!origin) return true;
  if (!cache.has(origin)) {
    cache.set(origin, await fetchRobots(origin, options).catch((error) => {
      warnings.push(`robots.txt check failed for ${origin}: ${error instanceof Error ? error.message : String(error)}`);
      return { disallow: [] };
    }));
  }
  const rules = cache.get(origin);
  let path = '/';
  try {
    const parsed = new URL(pageUrl);
    path = parsed.pathname || '/';
  } catch {
    return true;
  }
  return !rules.disallow.some((rule) => rule && path.startsWith(rule));
}

async function fetchRobots(origin, options) {
  const response = await fetch(`${origin.replace(/\/+$/, '')}/robots.txt`, {
    headers: { 'User-Agent': options.userAgent || DEFAULT_USER_AGENT },
    signal: AbortSignal.timeout?.(5_000),
  });
  if (response.status === 404) return { disallow: [] };
  if (response.status >= 400) throw new Error(`robots.txt returned HTTP ${response.status}`);
  return parseRobots(await response.text());
}

function parseRobots(body) {
  const disallow = [];
  let applies = false;
  let sawDirective = false;
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === 'user-agent') {
      if (sawDirective) {
        applies = false;
        sawDirective = false;
      }
      const agent = value.toLowerCase();
      applies = agent === '*' || agent.includes('publicleadsbot') || agent.includes('coldagentleadsbot');
    } else if (key === 'disallow') {
      sawDirective = true;
      if (applies && value) disallow.push(value);
    } else {
      sawDirective = true;
    }
  }
  disallow.sort((a, b) => b.length - a.length);
  return { disallow };
}

function extractTitle(html) {
  return decodeEntities(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
}

function extractLinks(baseUrl, html) {
  const links = [];
  const seen = new Set();
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const href = match[1] || match[2] || match[3] || '';
    const link = normalizeLink(baseUrl, href);
    if (!link || seen.has(link)) continue;
    seen.add(link);
    links.push(link);
  }
  links.sort((a, b) => pagePriority(b) - pagePriority(a));
  return links;
}

function normalizeLink(baseUrl, href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('javascript:') || lower.startsWith('#')) {
    return '';
  }
  let url;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  url.hash = '';
  url.search = '';
  if (skipByExtension(url.pathname)) return '';
  return url.toString();
}

function extractEmails(html) {
  const decoded = decodeEntities(String(html || ''));
  const values = [decoded];
  const mailtoRe = /href\s*=\s*(?:"mailto:([^"]+)"|'mailto:([^']+)'|mailto:([^\s>]+))/gi;
  let match;
  while ((match = mailtoRe.exec(decoded))) {
    values.push(decodeURIComponentSafe(match[1] || match[2] || match[3] || ''));
  }

  const emails = new Set();
  for (const value of values) {
    for (const found of String(value || '').matchAll(EMAIL_RE)) {
      const email = found[0].toLowerCase().replace(/^mailto:/, '').replace(/[.,;:!?()[\]{}<>"']+$/g, '');
      if (email && !isLikelyAssetEmail(email)) emails.add(email);
    }
  }
  return [...emails].sort();
}

async function buildEmailLead(email, companyDomain, websiteUrl, sourceUrl, pageTitle, text) {
  const emailDomain = domainFromEmail(email);
  const local = email.split('@')[0].toLowerCase();
  const emailType = classifyEmailLocal(local);
  const snippet = evidenceSnippet(text, email) || fallbackSnippet(pageTitle, sourceUrl);
  const warnings = [];
  let confidence = 50;

  if (emailDomain === companyDomain || emailDomain.endsWith(`.${companyDomain}`)) {
    confidence += 20;
  } else {
    confidence -= 15;
    warnings.push('email domain differs from company domain');
  }

  let contactName = '';
  let title = '';
  if (emailType === 'person') {
    contactName = inferName(snippet);
    title = inferTitle(snippet);
    confidence += 15;
  } else if (emailType === 'role') {
    title = 'Role inbox';
    confidence -= 10;
  } else if (emailType === 'blocked') {
    confidence = 0;
    warnings.push('blocked operational inbox; do not use for outreach');
  }
  if (contactName) confidence += 5;
  if (title && title !== 'Role inbox') confidence += 5;

  const verificationStatus = await emailVerificationStatus(emailDomain);
  if (verificationStatus !== 'mx_verified' && emailType !== 'blocked') {
    warnings.push('email domain MX could not be verified');
  }

  const lead = {
    company: displayCompany(companyDomain),
    domain: companyDomain,
    websiteUrl,
    contactName,
    title,
    email,
    emailType,
    sourceUrl,
    sourceLabel: sourceLabel(sourceUrl),
    evidence: snippet,
    extractionMethod: 'agentic_harness_public_page',
    verificationStatus: emailType === 'blocked' ? 'blocked' : verificationStatus,
    confidence: clamp(confidence, 0, 100),
    warnings,
    foundAt: new Date().toISOString(),
  };
  lead.id = stableID(leadKey(lead));
  return lead;
}

function buildContactPath(domain, websiteUrl, sourceUrl, pageTitle, text) {
  const lead = {
    company: displayCompany(domain),
    domain,
    websiteUrl,
    contactName: '',
    title: 'Contact form',
    email: '',
    emailType: 'contact_path',
    sourceUrl,
    sourceLabel: sourceLabel(sourceUrl),
    evidence: fallbackSnippet(pageTitle, text, 'The public page contains a contact form.'),
    extractionMethod: 'agentic_harness_contact_form',
    verificationStatus: 'not_applicable',
    confidence: 35,
    warnings: [],
    foundAt: new Date().toISOString(),
  };
  lead.id = stableID(`form|${sourceUrl}`);
  return lead;
}

async function emailVerificationStatus(domain) {
  if (!domain) return 'unknown';
  try {
    const mx = await resolveMx(domain);
    if (mx.length > 0) return 'mx_verified';
  } catch {
    // Fall back to a host lookup before marking unknown.
  }
  try {
    await lookup(domain);
    return 'unverified';
  } catch {
    return 'unknown';
  }
}

function classifyEmailLocal(local) {
  const blocked = new Set(['abuse', 'postmaster', 'hostmaster', 'security', 'privacy', 'legal', 'dmca', 'noreply', 'no-reply']);
  if (blocked.has(local)) return 'blocked';
  const generic = new Set([
    'info', 'hello', 'contact', 'sales', 'support', 'team', 'office', 'admin',
    'inquiries', 'enquiries', 'partners', 'partnerships', 'media', 'press',
  ]);
  if (generic.has(local)) return 'role';
  if (/[._-]/.test(local)) return 'person';
  if (local.length >= 4 && !/\d/.test(local)) return 'person';
  return 'role';
}

function isRelevantLead(lead, options) {
  if (!options.includeBlocked && lead.emailType === 'blocked') return false;
  return lead.confidence >= options.minConfidence;
}

function sameDomain(domain, link) {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function isHighSignalPage(link) {
  const lower = link.toLowerCase();
  if (pagePriority(link) > 0) return true;
  return lower.endsWith('/') && lower.split('/').length <= 4;
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

function isContactLikeURL(link) {
  const path = safePath(link);
  return /contact|about|team|people|leadership|staff/.test(path);
}

function safePath(link) {
  try {
    return new URL(link).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function evidenceSnippet(text, needle) {
  const compact = compactText(text);
  const lower = compact.toLowerCase();
  const index = lower.indexOf(String(needle || '').toLowerCase());
  if (index === -1) return '';
  const start = Math.max(0, index - 140);
  const end = Math.min(compact.length, index + String(needle).length + 140);
  return trimToWordBoundary(compact.slice(start, end));
}

function fallbackSnippet(...values) {
  for (const value of values) {
    const text = compactText(value);
    if (!text) continue;
    return text.length > 260 ? trimToWordBoundary(text.slice(0, 260)) : text;
  }
  return '';
}

function inferName(snippet) {
  for (const match of String(snippet || '').matchAll(NAME_RE)) {
    const value = match[0];
    if (!isBadNameCandidate(value)) return value;
  }
  return '';
}

function inferTitle(snippet) {
  const lower = String(snippet || '').toLowerCase();
  const titles = [
    ['chief executive officer', 'CEO'],
    ['co-founder', 'Co-founder'],
    ['cofounder', 'Co-founder'],
    ['founder', 'Founder'],
    ['owner', 'Owner'],
    ['president', 'President'],
    ['principal', 'Principal'],
    ['director', 'Director'],
    ['head of sales', 'Head of sales'],
    ['sales', 'Sales'],
    ['partnership', 'Partnerships'],
    ['operations', 'Operations'],
    ['marketing', 'Marketing'],
  ];
  return titles.find(([needle]) => lower.includes(needle))?.[1] || '';
}

function isBadNameCandidate(value) {
  const bad = new Set(['Contact Us', 'About Us', 'Privacy Policy', 'Terms Conditions', 'All Rights', 'Email Address', 'Phone Number', 'Home Contact']);
  if (bad.has(value)) return true;
  return value.split(/\s+/).some((word) => ['email', 'contact', 'privacy', 'copyright'].includes(word.toLowerCase()));
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function trimToWordBoundary(value) {
  return compactText(value);
}

function sourceLabel(sourceUrl) {
  const path = safePath(sourceUrl).replace(/^\/+|\/+$/g, '');
  if (!path) return 'Home';
  const last = path.split('/').filter(Boolean).pop() || path;
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayCompany(domain) {
  const root = String(domain || '').split('.')[0] || '';
  return root
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function domainFromEmail(email) {
  return String(email || '').split('@')[1]?.toLowerCase() || '';
}

function leadKey(lead) {
  return [
    lead.email || '',
    lead.sourceUrl || '',
    lead.domain || '',
    lead.contactName || '',
    lead.title || '',
  ].join('|').toLowerCase();
}

function sortLead(a, b) {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return leadKey(a).localeCompare(leadKey(b));
}

function stableID(value) {
  return createHash('sha1').update(String(value || '')).digest('hex');
}

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function timestampForID() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function skipByExtension(path) {
  return /\.(?:7z|avi|css|csv|doc|docx|gif|gz|ico|jpeg|jpg|js|json|mov|mp3|mp4|pdf|png|ppt|pptx|rar|rss|svg|tar|webm|webp|xls|xlsx|xml|zip)$/i.test(path);
}

function isLikelyAssetEmail(email) {
  return /\.(?:png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(email.split('@')[1] || '');
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
