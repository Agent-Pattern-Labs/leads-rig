import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { crawlDomains } from '../lib/leadharness-crawler.mjs';

test('crawlDomains bounds domain concurrency', async () => {
  const originalFetch = globalThis.fetch;
  let activePages = 0;
  let maxActivePages = 0;
  let pageHits = 0;

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/robots.txt')) return new Response('', { status: 404 });

    activePages++;
    pageHits++;
    maxActivePages = Math.max(maxActivePages, activePages);
    await sleep(30);
    activePages--;
    return htmlResponse('<title>Home</title><main>No public emails here.</main>');
  };

  try {
    await crawlDomains(['one.test', 'two.test', 'three.test', 'four.test'], {
      maxPages: 1,
      delayMs: 0,
      concurrency: 2,
      timeoutMs: 1_000,
      noCache: true,
    });

    assert.equal(pageHits, 4);
    assert.equal(maxActivePages, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('crawlDomains reuses persisted robots cache across runs', async () => {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), 'leads-rig-crawler-'));
  const cachePath = join(dir, 'crawler-cache.json');
  let robotsFetches = 0;
  let pageHits = 0;

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/robots.txt')) {
      robotsFetches++;
      return new Response('', { status: 404 });
    }

    pageHits++;
    return htmlResponse('<title>Home</title><main>No public emails here.</main>');
  };

  try {
    const options = { maxPages: 1, delayMs: 0, concurrency: 1, timeoutMs: 1_000, cachePath };
    await crawlDomains(['cache.test'], options);
    await crawlDomains(['cache.test'], options);

    assert.equal(robotsFetches, 1);
    assert.equal(pageHits, 2);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crawlDomains reuses persisted MX status for email verification', async () => {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), 'leads-rig-crawler-'));
  const cachePath = join(dir, 'crawler-cache.json');
  const now = new Date().toISOString();

  writeFileSync(cachePath, JSON.stringify({
    version: 1,
    generatedAt: now,
    robots: {
      'https://example.invalid': {
        fetchedAt: now,
        rules: { disallow: [] },
      },
    },
    dns: {
      'example.invalid': {
        checkedAt: now,
        status: 'mx_verified',
      },
    },
  }, null, 2), 'utf8');

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/robots.txt')) throw new Error('robots.txt should come from cache');
    return htmlResponse('<title>Team</title><main>Jane Doe Founder jane.doe@example.invalid</main>');
  };

  try {
    const payload = await crawlDomains(['example.invalid'], {
      maxPages: 1,
      delayMs: 0,
      concurrency: 1,
      timeoutMs: 1_000,
      cachePath,
    });

    assert.equal(payload.leads.length, 1);
    assert.equal(payload.leads[0].email, 'jane.doe@example.invalid');
    assert.equal(payload.leads[0].verificationStatus, 'mx_verified');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crawlDomains bounds per-domain page concurrency', async () => {
  const originalFetch = globalThis.fetch;
  let activePages = 0;
  let maxActivePages = 0;

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/robots.txt')) return new Response('', { status: 404 });

    activePages++;
    maxActivePages = Math.max(maxActivePages, activePages);
    await sleep(30);
    activePages--;
    return htmlResponse('<title>Page</title><main>No public emails here.</main>');
  };

  try {
    await crawlDomains(['https://pages.test/start'], {
      maxPages: 2,
      delayMs: 0,
      concurrency: 1,
      pageConcurrency: 2,
      timeoutMs: 1_000,
      noCache: true,
    });

    assert.equal(maxActivePages, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('crawlDomains stops after requested good lead count', async () => {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), 'leads-rig-crawler-'));
  const cachePath = join(dir, 'crawler-cache.json');
  const now = new Date().toISOString();
  const pageHits = [];

  writeFileSync(cachePath, JSON.stringify({
    version: 1,
    generatedAt: now,
    robots: {
      'https://stop.test': {
        fetchedAt: now,
        rules: { disallow: [] },
      },
    },
    dns: {
      'stop.test': {
        checkedAt: now,
        status: 'mx_verified',
      },
    },
  }, null, 2), 'utf8');

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/robots.txt')) throw new Error('robots.txt should come from cache');
    pageHits.push(new URL(value).pathname);
    return htmlResponse('<title>Team</title><main>Jane Doe Founder jane.doe@stop.test <a href="/about">About</a></main>');
  };

  try {
    const payload = await crawlDomains(['stop.test'], {
      maxPages: 3,
      delayMs: 0,
      concurrency: 1,
      pageConcurrency: 1,
      timeoutMs: 1_000,
      cachePath,
      stopAfterGoodLeads: 1,
    });

    assert.equal(payload.leads.length, 1);
    assert.deepEqual(pageHits, ['/']);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crawlDomains stops after contact path when requested', async () => {
  const originalFetch = globalThis.fetch;
  const pageHits = [];

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/robots.txt')) return new Response('', { status: 404 });
    pageHits.push(new URL(value).pathname);
    return htmlResponse('<title>Contact</title><main><form><input name="email"></form><a href="/about">About</a></main>');
  };

  try {
    const payload = await crawlDomains(['https://contact-stop.test/contact'], {
      maxPages: 3,
      delayMs: 0,
      concurrency: 1,
      pageConcurrency: 1,
      timeoutMs: 1_000,
      noCache: true,
      stopAfterContactPath: true,
    });

    assert.equal(payload.leads.length, 1);
    assert.equal(payload.leads[0].emailType, 'contact_path');
    assert.deepEqual(pageHits, ['/contact']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('crawlDomains reuses opt-in page cache across runs', async () => {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), 'leads-rig-crawler-'));
  const cachePath = join(dir, 'crawler-cache.json');
  let pageFetches = 0;

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/robots.txt')) return new Response('', { status: 404 });
    pageFetches++;
    return htmlResponse('<title>Home</title><main>No public emails here.</main>');
  };

  try {
    const options = {
      maxPages: 1,
      delayMs: 0,
      concurrency: 1,
      timeoutMs: 1_000,
      cachePath,
      pageCache: true,
    };
    await crawlDomains(['page-cache.test'], options);
    await crawlDomains(['page-cache.test'], options);

    assert.equal(pageFetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}
