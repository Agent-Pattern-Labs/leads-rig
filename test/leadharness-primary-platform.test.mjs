import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePayload } from '../lib/leadharness-leads.mjs';
import {
  discoverLeadProfiles,
  enrichPrimaryPlatforms,
  normalizeProfileUrl,
  selectPrimaryPlatform,
} from '../lib/leadharness-primary-platform.mjs';

const NOW = '2026-07-12T12:00:00.000Z';

test('normalizes supported person profile URLs and rejects non-person LinkedIn URLs', () => {
  assert.deepEqual(normalizeProfileUrl('github.com/Jane-Example'), {
    platform: 'github',
    url: 'https://github.com/Jane-Example',
    username: 'Jane-Example',
  });
  assert.equal(normalizeProfileUrl('https://linkedin.com/company/example'), null);
  assert.equal(normalizeProfileUrl('https://x.com/intent/tweet'), null);
});

test('only promotes page-level social URLs that match the named contact', () => {
  const profiles = discoverLeadProfiles(personLead({
    socialUrls: [
      'https://github.com/jane-example',
      'https://x.com/example_company',
      'https://www.linkedin.com/company/example',
    ],
  }), NOW);

  assert.deepEqual(profiles.map((profile) => profile.platform), ['linkedin', 'github']);
});

test('selects the strongest observable public activity and schedules weekly refresh', async () => {
  const payload = normalizePayload({
    leads: [personLead({
      socialUrls: [
        'https://github.com/jane-example',
        'https://bsky.app/profile/jane.example',
      ],
    })],
  }, { now: NOW });
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('api.github.com')) {
      return Response.json([
        { id: '1', created_at: '2026-07-11T12:00:00Z' },
        { id: '2', created_at: '2026-07-10T12:00:00Z' },
        { id: '3', created_at: '2026-07-09T12:00:00Z' },
      ]);
    }
    if (value.includes('public.api.bsky.app')) {
      return Response.json({ feed: [{ post: { record: { createdAt: '2026-05-01T12:00:00Z' } } }] });
    }
    throw new Error(`unexpected URL ${value}`);
  };

  const result = await enrichPrimaryPlatforms(payload, { now: NOW, fetchImpl, refreshDays: 7 });
  const lead = result.payload.leads[0];
  assert.equal(lead.primaryPlatform, 'github');
  assert.equal(lead.primaryPlatformSelectionMethod, 'observed_public_activity');
  assert.equal(lead.primaryPlatformNextRefreshAt, '2026-07-19T12:00:00.000Z');
  assert.equal(lead.socialProfiles.find((profile) => profile.platform === 'github').publicActivityCount, 3);
  assert.equal(result.report.publicActivityRequests, 2);
  assert.equal(result.report.directThirdPartyApiCostUsd, 0);

  const cached = await enrichPrimaryPlatforms(result.payload, {
    now: '2026-07-13T12:00:00.000Z',
    cache: result.cache,
    fetchImpl: async () => {
      throw new Error('fresh weekly cache should prevent requests');
    },
  });
  assert.equal(cached.report.publicActivityRequests, 0);
  assert.ok(cached.report.cacheHits >= 3);
});

test('uses presence fallback without requesting unsupported social platforms', async () => {
  let requests = 0;
  const payload = normalizePayload({ leads: [personLead()] }, { now: NOW });
  const result = await enrichPrimaryPlatforms(payload, {
    now: NOW,
    fetchImpl: async () => {
      requests += 1;
      throw new Error('unsupported platforms must not be requested');
    },
  });

  assert.equal(requests, 0);
  assert.equal(result.report.publicActivityRequests, 0);
  assert.equal(result.payload.leads[0].primaryPlatform, 'linkedin');
  assert.equal(result.payload.leads[0].primaryPlatformSelectionMethod, 'fallback_presence_priority');
  assert.equal(result.payload.leads[0].primaryPlatformConfidence, 40);
});

test('normalization and duplicate merging retain primary platform enrichment', () => {
  const enriched = {
    socialProfiles: [{
      platform: 'github',
      url: 'https://github.com/jane-example',
      activityStatus: 'observed',
      publicActivityCount: 7,
      checkedAt: NOW,
      nextRefreshAt: '2026-07-19T12:00:00Z',
    }],
    primaryPlatform: 'github',
    primaryPlatformUrl: 'https://github.com/jane-example',
    primaryPlatformConfidence: 75,
    primaryPlatformSelectionMethod: 'observed_public_activity',
    primaryPlatformEvidence: 'Seven public events were observed.',
    primaryPlatformCheckedAt: NOW,
    primaryPlatformNextRefreshAt: '2026-07-19T12:00:00Z',
  };
  const payload = normalizePayload({
    leads: [
      personLead({ confidence: 95 }),
      personLead({ confidence: 80, ...enriched }),
    ],
  }, { now: NOW });

  assert.equal(payload.leads.length, 1);
  assert.equal(payload.leads[0].primaryPlatform, 'github');
  assert.equal(payload.leads[0].socialProfiles[0].publicActivityCount, 7);
});

test('primary selection does not claim observed usage from profile presence', () => {
  const primary = selectPrimaryPlatform([
    { platform: 'github', url: 'https://github.com/jane', activityStatus: 'observed_inactive', publicActivityCount: 0 },
    { platform: 'linkedin', url: 'https://linkedin.com/in/jane', activityStatus: 'presence_only', publicActivityCount: 0 },
  ], { now: NOW });
  assert.equal(primary.platform, 'linkedin');
  assert.equal(primary.selectionMethod, 'fallback_presence_priority');
});

function personLead(overrides = {}) {
  return {
    company: 'Example',
    domain: 'example.com',
    websiteUrl: 'https://example.com/',
    contactName: 'Jane Example',
    title: 'Founder',
    email: 'jane@example.com',
    emailType: 'person',
    sourceUrl: 'https://example.com/about',
    sourceLabel: 'About',
    evidence: 'Jane Example is the founder and publishes jane@example.com for business contact.',
    extractionMethod: 'public_page',
    verificationStatus: 'mx_verified',
    confidence: 90,
    warnings: [],
    linkedinUrl: 'https://www.linkedin.com/in/jane-example',
    foundAt: NOW,
    ...overrides,
  };
}
