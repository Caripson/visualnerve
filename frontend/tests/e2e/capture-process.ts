import { execFileSync } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, Locator } from '@playwright/test';

/** Explicit opt-in keeps CI from rewriting documentation assets. */
export async function captureProcessGuide(
  target: Page | Locator,
  name: 'process-setup' | 'simulation-traffic' | 'node-quick-add',
) {
  if (process.env.VN_CAPTURE_PROCESS !== '1') return;
  const output = resolve('../hugo/static/help/images');
  await mkdir(output, { recursive: true });
  const png = resolve(output, `${name}.png`);
  await writeFile(png, await target.screenshot({ animations: 'disabled' }));
  execFileSync('cwebp', [
    '-lossless',
    '-m',
    '6',
    '-quiet',
    png,
    '-o',
    resolve(output, `${name}.webp`),
  ]);
  await unlink(png);
}
