import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePayload } from '../lib/leadharness-leads.mjs';

test('normalizePayload merges duplicate email leads and preserves all sources', () => {
  const payload = normalizePayload({
    leads: [
      {
        domain: 'example.com',
        email: 'jane@example.com',
        sourceUrl: 'https://example.com/about',
        sourceLabel: 'About',
        evidence: 'Jane Example jane@example.com on the about page.',
        confidence: 72,
        emailType: 'person',
      },
      {
        domain: 'example.com',
        email: 'jane@example.com',
        sourceUrl: 'https://example.com/contact',
        sourceLabel: 'Contact',
        evidence: 'Contact page repeats jane@example.com with more context.',
        confidence: 84,
        emailType: 'person',
      },
    ],
  }, { now: '2026-05-20T12:00:00.000Z' });

  assert.equal(payload.leads.length, 1);
  assert.equal(payload.leads[0].email, 'jane@example.com');
  assert.equal(payload.leads[0].sources.length, 2);
  assert.equal(payload.leads[0].sourceUrl, 'https://example.com/contact');
  assert.deepEqual(
    payload.leads[0].sources.map((source) => source.url),
    ['https://example.com/contact', 'https://example.com/about'],
  );
});

test('normalizePayload also dedupes duplicate result leads', () => {
  const payload = normalizePayload({
    results: [
      {
        domain: 'example.com',
        websiteUrl: 'https://example.com/',
        leads: [
          {
            domain: 'example.com',
            email: 'team@example.com',
            sourceUrl: 'https://example.com/',
            sourceLabel: 'Home',
            evidence: 'Home page lists team@example.com.',
            confidence: 60,
            emailType: 'role',
          },
          {
            domain: 'example.com',
            email: 'team@example.com',
            sourceUrl: 'https://example.com/contact',
            sourceLabel: 'Contact',
            evidence: 'Contact page also lists team@example.com.',
            confidence: 68,
            emailType: 'role',
          },
        ],
        pages: [],
      },
    ],
    leads: [],
  }, { now: '2026-05-20T12:00:00.000Z' });

  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].leads.length, 1);
  assert.equal(payload.results[0].leads[0].sources.length, 2);
});
