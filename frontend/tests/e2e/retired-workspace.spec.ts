import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServiceWorker } from '../../../scripts/service-worker.mjs';

const app = 'https://app.visualnerve.com/';

test('a real previously controlling legacy worker is replaced before retired /app navigation, preserving origin-bound IndexedDB', async ({
  page,
  context,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'visualnerve-retirement-browser-'));
  let server: Server | undefined;
  try {
    mkdirSync(join(directory, 'editor'));
    writeFileSync(join(directory, 'index.html'), '<!doctype html><h1>Public product website</h1>');
    buildServiceWorker(directory, { surface: 'site', assets: ['/'], retireAppPaths: true });
    const current = readFileSync(join(directory, 'sw.js'), 'utf8');
    const legacy = `
      self.addEventListener('install', event => event.waitUntil((async () => {
        await (await caches.open('visual-nerve-shell-legacy-fixture')).put('/app/', new Response('<!doctype html><h1>Old cached editor</h1>', {headers:{'Content-Type':'text/html'}}));
        await self.skipWaiting();
      })()));
      self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
      self.addEventListener('fetch', event => {
        if (new URL(event.request.url).pathname === '/app/') event.respondWith(caches.open('visual-nerve-shell-legacy-fixture').then(cache => cache.match('/app/')));
      });
    `;
    let upgraded = false;
    server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      if (request.url === '/sw.js') {
        response.setHeader('Content-Type', 'application/javascript');
        response.end(upgraded ? current : legacy);
      } else if (/^\/app(?:\/|[?]|$)/.test(request.url ?? '')) {
        response.writeHead(308, { Location: app });
        response.end();
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end(readFileSync(join(directory, 'index.html')));
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('The retirement fixture did not bind.');
    const origin = `http://127.0.0.1:${address.port}`;
    await context.route('https://app.visualnerve.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><h1>Isolated encrypted workspace</h1>',
      }),
    );
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('retirement-browser-sentinel', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('records', 'readwrite');
        transaction
          .objectStore('records')
          .put({ title: 'Never move or delete this work', amount: 123 }, 'work');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    });
    // Demonstrate the actual regression: the previous cache masks the server's 308.
    await page.goto(origin + '/app/');
    await expect(page.getByRole('heading', { name: 'Old cached editor' })).toBeVisible();
    upgraded = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('Missing legacy registration');
      const takeover = new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
      await registration.update();
      await takeover;
    });
    await page.goto(origin + '/app/?private=must-not-travel');
    await expect(page).toHaveURL(app);
    await expect(page.getByRole('heading', { name: 'Isolated encrypted workspace' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Old cached editor' })).toHaveCount(0);
    const recovery = await context.newPage();
    await recovery.goto(origin);
    expect(
      await recovery.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('retirement-browser-sentinel');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const value = await new Promise<unknown>((resolve, reject) => {
          const request = database.transaction('records').objectStore('records').get('work');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();
        return {
          value,
          legacyCacheRetained: (await caches.keys()).includes('visual-nerve-shell-legacy-fixture'),
        };
      }),
    ).toEqual({
      value: { title: 'Never move or delete this work', amount: 123 },
      legacyCacheRetained: true,
    });
    await recovery.close();
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    rmSync(directory, { recursive: true, force: true });
  }
});
