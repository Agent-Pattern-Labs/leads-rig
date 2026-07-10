import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestArtifact } from '../lib/leadharness-ingest.mjs';
import { normalizePayload } from '../lib/leadharness-leads.mjs';

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
    foundAt: '2026-05-20T12:00:00.000Z',
    ...overrides,
  };
}

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

test('normalizePayload preserves supported enrichment fields', () => {
  const payload = normalizePayload({
    leads: [personLead({
      linkedinUrl: ' uk.linkedin.com/in/jane-example/?trk=public_profile#about ',
      phone: '+14155550123',
      address: '123 Main St\nSan Francisco, CA 94105',
      streetAddress: '123 Main St',
      location: 'San Francisco, CA, United States',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94105',
      country: 'United States',
    })],
  }, { now: '2026-05-20T12:00:00.000Z' });

  assert.deepEqual(
    {
      linkedinUrl: payload.leads[0].linkedinUrl,
      phone: payload.leads[0].phone,
      address: payload.leads[0].address,
      streetAddress: payload.leads[0].streetAddress,
      location: payload.leads[0].location,
      city: payload.leads[0].city,
      region: payload.leads[0].region,
      postalCode: payload.leads[0].postalCode,
      country: payload.leads[0].country,
    },
    {
      linkedinUrl: 'https://www.linkedin.com/in/jane-example',
      phone: '+14155550123',
      address: '123 Main St San Francisco, CA 94105',
      streetAddress: '123 Main St',
      location: 'San Francisco, CA, United States',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94105',
      country: 'United States',
    },
  );
});

test('normalizePayload retains enrichment from a lower-scored duplicate', () => {
  const payload = normalizePayload({
    leads: [
      personLead({ confidence: 95, address: 'San Francisco' }),
      personLead({
        confidence: 70,
        linkedinUrl: 'linkedin.com/in/jane-example',
        phone: '+14155550123',
        address: '123 Main St, San Francisco, CA 94105',
        streetAddress: '123 Main St',
        location: 'San Francisco, CA, United States',
        city: 'San Francisco',
        region: 'CA',
        postalCode: '94105',
        country: 'United States',
      }),
    ],
  }, { now: '2026-05-20T12:00:00.000Z' });

  assert.equal(payload.leads.length, 1);
  assert.equal(payload.leads[0].confidence, 95);
  assert.equal(payload.leads[0].linkedinUrl, 'https://www.linkedin.com/in/jane-example');
  assert.equal(payload.leads[0].phone, '+14155550123');
  assert.equal(payload.leads[0].address, '123 Main St, San Francisco, CA 94105');
  assert.equal(payload.leads[0].streetAddress, '123 Main St');
  assert.equal(payload.leads[0].location, 'San Francisco, CA, United States');
  assert.equal(payload.leads[0].city, 'San Francisco');
  assert.equal(payload.leads[0].region, 'CA');
  assert.equal(payload.leads[0].postalCode, '94105');
  assert.equal(payload.leads[0].country, 'United States');
});

test('ingestArtifact dry-run serializes enrichment fields', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'leads-rig-ingest-'));
  const input = join(dir, 'leads.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(input, JSON.stringify({
    jobId: 'enrichment-regression',
    leads: [personLead({
      linkedinUrl: 'linkedin.com/in/jane-example',
      location: 'San Francisco, CA, United States',
      city: 'San Francisco',
      region: 'CA',
      country: 'United States',
    })],
  }));

  const outcome = await ingestArtifact(input, {
    api: 'https://leads.example.com',
    dryRun: true,
  });

  assert.equal(outcome.payload.leads[0].linkedinUrl, 'https://www.linkedin.com/in/jane-example');
  assert.equal(outcome.payload.leads[0].location, 'San Francisco, CA, United States');
  assert.equal(outcome.payload.leads[0].city, 'San Francisco');
  assert.equal(outcome.payload.leads[0].region, 'CA');
  assert.equal(outcome.payload.leads[0].country, 'United States');
});
