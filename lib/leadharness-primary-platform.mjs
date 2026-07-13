const DEFAULT_PLATFORM_ORDER = ['linkedin', 'github', 'x', 'bluesky', 'youtube', 'instagram', 'facebook'];
const ACTIVITY_PLATFORMS = new Set(['github', 'bluesky', 'youtube']);
const BLOCKED_GITHUB_PATHS = new Set([
  'about', 'apps', 'collections', 'customer-stories', 'enterprise', 'events',
  'features', 'issues', 'marketplace', 'new', 'notifications', 'orgs', 'pricing',
  'pulls', 'search', 'security', 'settings', 'sponsors', 'topics', 'trending',
]);

export async function enrichPrimaryPlatforms(payload, options = {}) {
  const opts = normalizeOptions(options);
  const leads = Array.isArray(payload?.leads) ? payload.leads : [];
  const selected = opts.limit > 0 ? leads.slice(opts.offset, opts.offset + opts.limit) : leads.slice(opts.offset);
  const selectedKeys = new Set(selected.map(leadKey));
  const profilesByLead = new Map();
  const uniqueProfiles = new Map();

  for (const lead of selected) {
    const profiles = discoverLeadProfiles(lead, opts.now);
    profilesByLead.set(leadKey(lead), profiles);
    for (const profile of profiles) uniqueProfiles.set(profileKey(profile), profile);
  }

  const measurements = new Map();
  const pending = [...uniqueProfiles.values()].slice(0, opts.maxProfiles);
  await mapLimit(pending, opts.concurrency, async (profile) => {
    const key = profileKey(profile);
    const cached = normalizeActivityProfile(opts.cache?.profiles?.[key]);
    if (!opts.refresh && isFresh(cached, opts.now)) {
	  opts.cacheHits += 1;
      measurements.set(key, cached);
      return;
    }

    const measured = await measureProfile(profile, opts);
    if (measured.activityStatus === 'error' && hasUsableMeasurement(cached)) {
      measurements.set(key, {
        ...cached,
        stale: true,
        lastError: measured.lastError,
      });
      return;
    }
    measurements.set(key, measured);
  });

  const enrichedByKey = new Map();
  for (const lead of selected) {
    const profiles = (profilesByLead.get(leadKey(lead)) || []).map((profile) => {
      const measured = measurements.get(profileKey(profile));
      return measured || presenceOnlyProfile(profile, opts);
    });
    enrichedByKey.set(leadKey(lead), applyPrimaryPlatform(lead, profiles, opts));
  }

  const enrichLead = (lead) => selectedKeys.has(leadKey(lead))
    ? enrichedByKey.get(leadKey(lead)) || lead
    : lead;
  const output = {
    ...payload,
    leads: leads.map(enrichLead),
    results: Array.isArray(payload?.results)
      ? payload.results.map((result) => ({
        ...result,
        leads: Array.isArray(result?.leads) ? result.leads.map(enrichLead) : [],
      }))
      : [],
  };

  const enriched = [...enrichedByKey.values()];
  const report = {
    generatedAt: opts.now,
    inputLeads: leads.length,
    selectedLeads: selected.length,
    leadsWithProfiles: enriched.filter((lead) => lead.socialProfiles.length > 0).length,
    leadsWithPrimaryPlatform: enriched.filter((lead) => lead.primaryPlatform).length,
    observedActivitySelections: enriched.filter((lead) => lead.primaryPlatformSelectionMethod === 'observed_public_activity').length,
    fallbackSelections: enriched.filter((lead) => lead.primaryPlatformSelectionMethod === 'fallback_presence_priority').length,
    uniqueProfiles: uniqueProfiles.size,
    measuredProfiles: [...measurements.values()].filter((profile) => ['observed', 'observed_inactive'].includes(profile.activityStatus)).length,
	publicActivityRequests: opts.publicActivityRequests,
	cacheHits: opts.cacheHits,
    byPrimaryPlatform: countBy(enriched, (lead) => lead.primaryPlatform || 'none'),
    bySelectionMethod: countBy(enriched, (lead) => lead.primaryPlatformSelectionMethod || 'none'),
    directThirdPartyApiCostUsd: 0,
    paidApiRequests: 0,
    refreshDays: opts.refreshDays,
    activityWindowDays: opts.activityWindowDays,
  };
  const cache = {
    version: 1,
    updatedAt: opts.now,
    profiles: Object.fromEntries([...measurements.entries()]),
  };
  return { payload: output, report, cache };
}

export function discoverLeadProfiles(lead, now = new Date().toISOString()) {
  const candidates = [];
  const add = (value, trusted = false) => {
    const profile = normalizeProfileUrl(value);
    if (!profile) return;
    if (!trusted && !profileMatchesContact(profile, lead?.contactName)) return;
    candidates.push({
      ...profile,
      activityStatus: 'presence_only',
      checkedAt: '',
      nextRefreshAt: '',
      discoveredAt: validDateTime(lead?.foundAt) || now,
    });
  };

  add(lead?.linkedinUrl, true);
  add(lead?.githubUrl, true);
  add(lead?.twitterUrl, true);
  add(lead?.youtubeUrl, true);
  add(lead?.blueskyUrl, true);
  for (const profile of Array.isArray(lead?.socialProfiles) ? lead.socialProfiles : []) {
    const normalized = normalizeActivityProfile(profile);
    if (normalized) candidates.push(normalized);
  }
  for (const value of Array.isArray(lead?.socialUrls) ? lead.socialUrls : []) add(value, false);

  const byKey = new Map();
  for (const profile of candidates) {
    const key = profileKey(profile);
    const current = byKey.get(key);
    if (!current || profileRichness(profile) > profileRichness(current)) byKey.set(key, profile);
  }
  return [...byKey.values()].sort((left, right) => platformRank(left.platform) - platformRank(right.platform));
}

export function normalizeSocialProfiles(value) {
  if (!Array.isArray(value)) return [];
  const byKey = new Map();
  for (const item of value) {
    const normalized = normalizeActivityProfile(item);
    if (!normalized) continue;
    const key = profileKey(normalized);
    const current = byKey.get(key);
    if (!current || profileRichness(normalized) > profileRichness(current)) byKey.set(key, normalized);
  }
  return [...byKey.values()].sort((left, right) => platformRank(left.platform) - platformRank(right.platform));
}

export function normalizeProfileUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim().match(/^https?:\/\//i) ? String(value).trim() : `https://${String(value || '').trim()}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponentSafe);
  url.search = '';
  url.hash = '';

  if ((host === 'linkedin.com' || host.endsWith('.linkedin.com')) && parts[0]?.toLowerCase() === 'in' && parts[1]) {
    return profile('linkedin', `https://www.linkedin.com/in/${encodeURIComponent(parts[1])}`, parts[1]);
  }
  if (host === 'github.com' && parts.length === 1 && !BLOCKED_GITHUB_PATHS.has(parts[0].toLowerCase())) {
    return profile('github', `https://github.com/${encodeURIComponent(parts[0])}`, parts[0]);
  }
  if ((host === 'x.com' || host === 'twitter.com') && parts.length === 1 && !['home', 'search', 'share', 'intent', 'hashtag'].includes(parts[0].toLowerCase())) {
    return profile('x', `https://x.com/${encodeURIComponent(parts[0])}`, parts[0]);
  }
  if (host === 'bsky.app' && parts[0]?.toLowerCase() === 'profile' && parts[1]) {
    return profile('bluesky', `https://bsky.app/profile/${encodeURIComponent(parts[1])}`, parts[1]);
  }
  if ((host === 'youtube.com' || host === 'm.youtube.com') && parts[0]) {
    if (parts[0].toLowerCase() === 'channel' && parts[1]) {
      return { ...profile('youtube', `https://www.youtube.com/channel/${encodeURIComponent(parts[1])}`, parts[1]), channelId: parts[1] };
    }
    if (parts[0].startsWith('@')) return profile('youtube', `https://www.youtube.com/${encodeURIComponent(parts[0])}`, parts[0].slice(1));
  }
  if (host === 'instagram.com' && parts.length === 1) {
    return profile('instagram', `https://www.instagram.com/${encodeURIComponent(parts[0])}`, parts[0]);
  }
  if (host === 'facebook.com' && parts.length === 1 && !['share', 'sharer', 'groups', 'pages'].includes(parts[0].toLowerCase())) {
    return profile('facebook', `https://www.facebook.com/${encodeURIComponent(parts[0])}`, parts[0]);
  }
  return null;
}

export function selectPrimaryPlatform(profiles, options = {}) {
  const order = normalizePlatformOrder(options.platformOrder);
  const active = profiles
    .filter((profile) => profile.activityStatus === 'observed' && profile.publicActivityCount > 0)
    .sort((left, right) => activityScore(right, options.now) - activityScore(left, options.now));
  if (active.length > 0) {
    const winner = active[0];
    const measuredCount = profiles.filter((profile) => ['observed', 'observed_inactive'].includes(profile.activityStatus)).length;
    const gap = active.length > 1 ? activityScore(active[0], options.now) - activityScore(active[1], options.now) : 0;
    const confidence = clamp(60 + (measuredCount > 1 ? 15 : 0) + (gap >= 25 ? 10 : 0), 0, 90);
    return {
      platform: winner.platform,
      url: winner.url,
      confidence,
      selectionMethod: 'observed_public_activity',
      evidence: winner.evidence,
    };
  }

  const fallback = [...profiles].sort((left, right) => order.indexOf(left.platform) - order.indexOf(right.platform))[0];
  if (!fallback) return { platform: '', url: '', confidence: 0, selectionMethod: '', evidence: '' };
  return {
    platform: fallback.platform,
    url: fallback.url,
    confidence: profiles.length === 1 ? 40 : 30,
    selectionMethod: 'fallback_presence_priority',
    evidence: `No comparable dated public activity was available; selected ${displayPlatform(fallback.platform)} using the configured presence fallback order.`,
  };
}

async function measureProfile(profile, opts) {
  if (!ACTIVITY_PLATFORMS.has(profile.platform)) return presenceOnlyProfile(profile, opts);
  try {
    if (profile.platform === 'github') return await measureGitHub(profile, opts);
    if (profile.platform === 'bluesky') return await measureBluesky(profile, opts);
    if (profile.platform === 'youtube') return await measureYouTube(profile, opts);
  } catch (error) {
    return {
      ...presenceOnlyProfile(profile, opts),
      activityStatus: 'error',
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
  return presenceOnlyProfile(profile, opts);
}

async function measureGitHub(profile, opts) {
  const endpoint = `https://api.github.com/users/${encodeURIComponent(profile.username)}/events/public?per_page=100`;
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': opts.userAgent,
    'x-github-api-version': '2022-11-28',
  };
  if (opts.githubToken) headers.authorization = `Bearer ${opts.githubToken}`;
	opts.publicActivityRequests += 1;
  const events = await fetchJSON(endpoint, { ...opts, headers });
  if (!Array.isArray(events)) throw new Error('GitHub returned an invalid public-events payload');
  return observedProfile(profile, events.map((event) => event?.created_at), endpoint, opts, 'GitHub public events');
}

async function measureBluesky(profile, opts) {
  const endpoint = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed');
  endpoint.searchParams.set('actor', profile.username);
  endpoint.searchParams.set('filter', 'posts_no_replies');
  endpoint.searchParams.set('limit', '100');
	opts.publicActivityRequests += 1;
  const body = await fetchJSON(endpoint, {
    ...opts,
    headers: { accept: 'application/json', 'user-agent': opts.userAgent },
  });
  if (!Array.isArray(body?.feed)) throw new Error('Bluesky returned an invalid author-feed payload');
  const dates = body.feed.map((item) => item?.post?.record?.createdAt || item?.post?.indexedAt);
  return observedProfile(profile, dates, endpoint.toString(), opts, 'Bluesky public author posts');
}

async function measureYouTube(profile, opts) {
  if (!profile.channelId) return presenceOnlyProfile(profile, opts);
  const endpoint = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(profile.channelId)}`;
	opts.publicActivityRequests += 1;
  const xml = await fetchText(endpoint, {
    ...opts,
    headers: { accept: 'application/atom+xml,application/xml,text/xml', 'user-agent': opts.userAgent },
  });
  const dates = [...xml.matchAll(/<published>([^<]+)<\/published>/gi)].map((match) => match[1]);
  return observedProfile(profile, dates, endpoint, opts, 'YouTube public channel uploads');
}

function observedProfile(profile, rawDates, sourceUrl, opts, label) {
  const cutoff = new Date(new Date(opts.now).getTime() - opts.activityWindowDays * 86_400_000);
  const dates = rawDates.map(validDate).filter((date) => date && date >= cutoff).sort((left, right) => right - left);
  const count = dates.length;
  const status = count > 0 ? 'observed' : 'observed_inactive';
  const last = dates[0]?.toISOString() || '';
  return {
    ...profile,
    activityStatus: status,
    activityWindowDays: opts.activityWindowDays,
    publicActivityCount: count,
    lastPublicActivityAt: last,
    checkedAt: opts.now,
    nextRefreshAt: addDays(opts.now, opts.refreshDays),
    activitySourceUrl: sourceUrl,
    evidence: count > 0
      ? `${label} show ${count} dated public activities in the last ${opts.activityWindowDays} days; the most recent was ${last}.`
      : `${label} showed no dated public activity in the last ${opts.activityWindowDays} days.`,
    stale: false,
    lastError: '',
  };
}

function presenceOnlyProfile(profile, opts) {
  return {
    ...profile,
    activityStatus: 'presence_only',
    activityWindowDays: opts.activityWindowDays,
    publicActivityCount: 0,
    lastPublicActivityAt: '',
    checkedAt: opts.now,
    nextRefreshAt: addDays(opts.now, opts.refreshDays),
    activitySourceUrl: '',
    evidence: `${displayPlatform(profile.platform)} profile presence is public, but no permitted comparable activity measurement was available.`,
    stale: false,
    lastError: '',
  };
}

function applyPrimaryPlatform(lead, profiles, opts) {
  const primary = selectPrimaryPlatform(profiles, opts);
  return {
    ...lead,
    socialProfiles: profiles,
    primaryPlatform: primary.platform,
    primaryPlatformUrl: primary.url,
    primaryPlatformConfidence: primary.confidence,
    primaryPlatformSelectionMethod: primary.selectionMethod,
    primaryPlatformEvidence: primary.evidence,
    primaryPlatformCheckedAt: primary.platform ? opts.now : '',
    primaryPlatformNextRefreshAt: primary.platform ? addDays(opts.now, opts.refreshDays) : '',
  };
}

function normalizeActivityProfile(value) {
  const base = normalizeProfileUrl(value?.url);
  if (!base) return null;
  return {
    ...base,
    ...(value?.channelId ? { channelId: String(value.channelId) } : {}),
    activityStatus: String(value?.activityStatus || 'presence_only'),
    activityWindowDays: clampInteger(value?.activityWindowDays, 0, 3650, 0),
    publicActivityCount: clampInteger(value?.publicActivityCount, 0, 1_000_000, 0),
    lastPublicActivityAt: validDateTime(value?.lastPublicActivityAt),
    checkedAt: validDateTime(value?.checkedAt),
    nextRefreshAt: validDateTime(value?.nextRefreshAt),
    activitySourceUrl: httpUrl(value?.activitySourceUrl),
    evidence: compact(value?.evidence),
    discoveredAt: validDateTime(value?.discoveredAt),
    stale: Boolean(value?.stale),
    lastError: compact(value?.lastError),
  };
}

async function fetchJSON(url, opts) {
  const response = await fetchResponse(url, opts);
  return response.json();
}

async function fetchText(url, opts) {
  const response = await fetchResponse(url, opts);
  return response.text();
}

async function fetchResponse(url, opts) {
  const response = await opts.fetchImpl(url, {
    headers: opts.headers,
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  return response;
}

function normalizeOptions(options) {
  const now = validDateTime(options.now) || new Date().toISOString();
  return {
    now,
    activityWindowDays: clampInteger(options.activityWindowDays, 7, 365, 90),
    refreshDays: clampInteger(options.refreshDays, 1, 30, 7),
    concurrency: clampInteger(options.concurrency, 1, 16, 4),
    timeoutMs: clampInteger(options.timeoutMs, 1_000, 60_000, 8_000),
    limit: clampInteger(options.limit, 0, 1_000_000, 0),
    offset: clampInteger(options.offset, 0, 1_000_000, 0),
    maxProfiles: clampInteger(options.maxProfiles, 1, 1_000_000, 100_000),
    platformOrder: normalizePlatformOrder(options.platformOrder),
    githubToken: String(options.githubToken || process.env.GITHUB_TOKEN || '').trim(),
    userAgent: String(options.userAgent || 'PublicLeadsPrimaryPlatform/0.1 (+https://github.com/Agent-Pattern-Labs/leads-rig)'),
    fetchImpl: options.fetchImpl || globalThis.fetch,
    cache: options.cache && typeof options.cache === 'object' ? options.cache : {},
    refresh: Boolean(options.refresh),
	publicActivityRequests: 0,
	cacheHits: 0,
  };
}

function profile(platform, url, username) {
  return { platform, url, username: String(username || '').replace(/^@/, '') };
}

function profileMatchesContact(profile, contactName) {
  const words = comparable(contactName).split(' ').filter((word) => word.length >= 2);
  if (words.length < 2) return false;
  const first = words[0];
  const last = words.at(-1);
  const username = comparable(profile.username).replaceAll(' ', '');
  return username.includes(`${first}${last}`)
    || username.includes(`${last}${first}`)
    || username.includes(`${first[0]}${last}`)
    || username.includes(`${first}${last[0]}`);
}

function activityScore(profile, now) {
  const countScore = Math.min(50, Math.log2(1 + profile.publicActivityCount) * 10);
  const ageDays = profile.lastPublicActivityAt
    ? Math.max(0, (new Date(now).getTime() - new Date(profile.lastPublicActivityAt).getTime()) / 86_400_000)
    : 365;
  return countScore + Math.max(0, 60 - ageDays);
}

function normalizePlatformOrder(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const clean = values.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  return [...new Set([...clean, ...DEFAULT_PLATFORM_ORDER])];
}

function platformRank(value) {
  const index = DEFAULT_PLATFORM_ORDER.indexOf(value);
  return index === -1 ? DEFAULT_PLATFORM_ORDER.length : index;
}

function profileKey(profile) {
  return `${profile.platform}|${profile.url}`;
}

function leadKey(lead) {
  return String(lead?.id || `${lead?.domain || ''}|${lead?.email || ''}|${lead?.contactName || ''}`).toLowerCase();
}

function profileRichness(profile) {
  return Number(Boolean(profile.lastPublicActivityAt)) * 10 + Number(profile.publicActivityCount || 0) + Number(Boolean(profile.evidence));
}

function hasUsableMeasurement(profile) {
  return profile && ['observed', 'observed_inactive'].includes(profile.activityStatus);
}

function isFresh(profile, now) {
  if (!profile?.nextRefreshAt) return false;
  return new Date(profile.nextRefreshAt) > new Date(now);
}

function validDate(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function validDateTime(value) {
  return validDate(value)?.toISOString() || '';
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function comparable(value) {
  return compact(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function displayPlatform(value) {
  return value === 'x' ? 'X' : String(value || '').replace(/^./, (char) => char.toUpperCase());
}

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(clamp(number, min, max)) : fallback;
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function mapLimit(items, limit, worker) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}
