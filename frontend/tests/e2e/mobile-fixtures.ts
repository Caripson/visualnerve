import type { Locator } from '@playwright/test';
import { expect, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { createBasicModel } from '../../src/simulation/examples';

export async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

export async function graph(
  request: APIRequestContext,
  name: string,
  type: 'flowchart' | 'mindmap' = 'flowchart',
) {
  const created = await request.post('/api/v1/diagrams', { data: { name, type } });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const populated = await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
    data: {
      nodes: [
        {
          externalId: 'first',
          title: 'Start here',
          description: 'The first mobile step.',
          x: 40,
          y: 60,
        },
        {
          externalId: 'next',
          title: 'Next step',
          description: 'The next mobile step.',
          x: 340,
          y: 60,
          ...(type === 'mindmap' ? { parentExternalId: 'first' } : {}),
        },
      ],
      edges: [
        {
          sourceExternalId: 'first',
          targetExternalId: 'next',
          ...(type === 'mindmap'
            ? { edgeType: 'hierarchy', direction: 'none' }
            : { direction: 'forward' }),
        },
      ],
    },
  });
  expect(populated.ok()).toBeTruthy();
  return (await populated.json()) as Graph;
}

export async function simulation(request: APIRequestContext, name: string) {
  const created = await request.post('/api/v1/diagrams', {
    data: { name, type: 'process-simulator' },
  });
  expect(created.status()).toBe(201);
  const diagram = await created.json();
  const model = createBasicModel({ particles: 100, processingSeconds: 30 });
  model.defaults.durationSeconds = 3600;
  const saved = await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
    data: { baseVersion: diagram.version, model },
  });
  expect(saved.ok()).toBeTruthy();
  return (await saved.json()) as Graph;
}

export async function open(page: Page, name: string) {
  await page.getByRole('button', { name: 'Open projects', exact: true }).tap();
  const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
  await expect(projects).toBeVisible();
  await projects.locator('.diagram-item').filter({ hasText: name }).tap();
  await expect(projects).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
  await saved(page);
}

export async function noHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(size.document).toBeLessThanOrEqual(size.width + 1);
  expect(size.body).toBeLessThanOrEqual(size.width + 1);
}

export async function touchControlIsReachable(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 0.999 });
  expect(
    await control.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const top = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      return !!top && element.contains(top);
    }),
  ).toBe(true);
}

export async function usableCanvas(page: Page) {
  await expect(page.locator('.canvas-shell')).toBeVisible();
  await noHorizontalOverflow(page);
  const box = (await page.locator('.canvas-shell').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
  expect(box.height).toBeGreaterThanOrEqual(viewport.height * 0.5);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

export async function canvasWorldCenter(page: Page) {
  return page.locator('.canvas-shell .react-flow').evaluate((element) => {
    const viewport = element.querySelector('.react-flow__viewport')!;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return {
      x: (element.clientWidth / 2 - matrix.e) / matrix.a,
      y: (element.clientHeight / 2 - matrix.f) / matrix.a,
    };
  });
}

export async function expectCanvasCenter(page: Page, expected: { x: number; y: number }) {
  await expect
    .poll(async () => {
      const center = await canvasWorldCenter(page);
      return Math.max(Math.abs(center.x - expected.x), Math.abs(center.y - expected.y));
    })
    .toBeLessThan(2);
}

export async function containedDialog(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  await noHorizontalOverflow(page);
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  return dialog;
}

export async function actions(page: Page) {
  await page.getByRole('button', { name: 'Diagram actions', exact: true }).tap();
  return containedDialog(page, 'Diagram actions menu');
}

export async function screenshot(page: Page, label: string) {
  await page.screenshot({ path: `/tmp/visualnerve-mobile-final-${label}.png` });
}
