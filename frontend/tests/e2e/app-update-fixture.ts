import { createServer, type Server } from 'node:https';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { buildAppSurface } from '../../../scripts/build-app-surface.mjs';
import { buildServiceWorker } from '../../../scripts/service-worker.mjs';

interface Release {
  number: number;
  version: string;
  index: Buffer;
  worker: Buffer;
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

/** Real app + generated workers; only release publication is controlled by the test. */
export class AppUpdateFixture {
  readonly first: Release;
  readonly second: Release;
  private published: Release;

  private constructor(
    readonly origin: string,
    private readonly server: Server,
    private readonly directory: string,
    first: Release,
    second: Release,
  ) {
    this.first = first;
    this.second = second;
    this.published = first;
  }

  static async start() {
    const directory = mkdtempSync(join(tmpdir(), 'visual-nerve-update-e2e-'));
    const key = join(directory, 'key.pem'),
      cert = join(directory, 'cert.pem'),
      output = join(directory, 'app');
    const certificate = spawnSync(
      '/usr/bin/openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=public-app.test',
        '-addext',
        'subjectAltName=DNS:public-app.test,IP:127.0.0.1',
      ],
      { encoding: 'utf8' },
    );
    if (certificate.status !== 0) {
      rmSync(directory, { recursive: true, force: true });
      throw new Error(`Cannot create the local update fixture certificate: ${certificate.stderr}`);
    }
    let fixture: AppUpdateFixture | undefined;
    let headers: Record<string, string> = {};
    const server = createServer(
      { key: readFileSync(key), cert: readFileSync(cert) },
      (request, response) => {
        void (async () => {
          try {
            if (!fixture || !['GET', 'HEAD'].includes(request.method ?? '')) {
              response.writeHead(405).end();
              return;
            }
            const path = decodeURIComponent(new URL(request.url!, fixture.origin).pathname);
            const file = resolve(output, `.${path}`, ...(path.endsWith('/') ? ['index.html'] : []));
            if (relative(output, file).startsWith('..')) {
              response.writeHead(404).end();
              return;
            }
            const body =
              path === '/'
                ? fixture.published.index
                : path === '/sw.js'
                  ? fixture.published.worker
                  : await readFile(file);
            response.writeHead(200, {
              ...headers,
              'Cache-Control': 'no-cache',
              'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
            });
            response.end(request.method === 'HEAD' ? undefined : body);
          } catch {
            response.writeHead(404).end();
          }
        })();
      },
    );
    try {
      await new Promise<void>((accept, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', accept);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Fixture address is unavailable.');
      const origin = `https://public-app.test:${address.port}`;
      const result = await buildAppSurface(resolve('..', 'public'), output, {
        appOrigin: origin,
        bridgePorts: [4329],
      });
      headers = JSON.parse(readFileSync(join(output, 'app-surface.json'), 'utf8')).responseHeaders;
      const index = readFileSync(join(output, 'index.html'), 'utf8');
      const assets = result.files
        .filter((path: string) => path !== 'sw.js')
        .map((path: string) => `/${path.replace(/index\.html$/, '')}`);
      const release = (number: number): Release => {
        const html = index.replace(
          '</head>',
          `<meta name="visual-nerve-update-fixture" content="${number}"></head>`,
        );
        writeFileSync(join(output, 'index.html'), html);
        const worker = buildServiceWorker(output, { surface: 'app', assets });
        return {
          number,
          version: worker.cacheName,
          index: Buffer.from(html),
          worker: readFileSync(join(output, 'sw.js')),
        };
      };
      fixture = new AppUpdateFixture(origin, server, directory, release(1), release(2));
      return fixture;
    } catch (error) {
      server.close();
      server.closeAllConnections();
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  publish(number: 1 | 2) {
    this.published = number === 1 ? this.first : this.second;
  }

  async stop() {
    await new Promise<void>((accept) => {
      this.server.close(() => accept());
      this.server.closeAllConnections();
    });
    rmSync(this.directory, { recursive: true, force: true });
  }
}
