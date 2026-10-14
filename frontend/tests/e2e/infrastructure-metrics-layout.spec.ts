import { expect, test } from './fixtures';
import type { Diagram } from '../../src/model/types';
import { createBasicModel } from '../../src/simulation/examples';

test('infrastructure metrics keep long quantities and units inside their cards on desktop and mobile', async ({
  page,
  request,
}) => {
  const create = await request.post('/api/v1/diagrams', {
    data: { name: 'Long infrastructure quantities', type: 'process-simulator' },
  });
  expect(create.status()).toBe(201);
  const diagram = (await create.json()) as Diagram;
  const model = createBasicModel({ particles: 1, processingSeconds: 108_600 });
  model.schemaVersion = 2;
  model.infrastructure = { schemaVersion: 1 };
  model.resources = [
    {
      id: 'cpu',
      name: 'Compute pool',
      capacity: 2,
      unit: 'cores',
      infrastructure: { kind: 'cpu', unit: 'cores' },
    },
    {
      id: 'ram',
      name: 'In-flight request RAM',
      capacity: 1024,
      unit: 'MiB',
      infrastructure: { kind: 'memory', unit: 'MiB' },
    },
  ];
  model.nodes.find((node) => node.type === 'work')!.work!.infrastructure = {
    cpu: { resourceId: 'cpu', coreSeconds: 29.8, cores: 1 },
    memory: [{ resourceId: 'ram', amountMiB: 1024, scope: 'case' }],
  };
  model.defaults.durationSeconds = 108_700;
  const update = await request.put(`/api/v1/diagrams/${diagram.id}/simulation`, {
    data: { baseVersion: diagram.version, model },
  });
  expect(update.status()).toBe(200);
  await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByLabel('Simulation speed').selectOption('max');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');

  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width <= 900) {
      await page.getByRole('button', { name: 'Open simulation details', exact: true }).click();
      await page.getByLabel('Simulation panel', { exact: true }).selectOption('metrics');
    }
    const region = page.getByRole('region', { name: 'Infrastructure capacity metrics' });
    await expect(region).toBeVisible();
    const allocated = region.locator('[data-infrastructure-metric="ram:Allocated memory-time"]');
    await expect(allocated).toHaveText('111,236,915.2 MiB-seconds');
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await region.scrollIntoViewIfNeeded();
      const overflow = await region.evaluate((root) => {
        const failures: string[] = [];
        for (const card of root.querySelectorAll<HTMLElement>('.infrastructure-pool-metrics')) {
          const bounds = card.getBoundingClientRect();
          if (card.scrollWidth > card.clientWidth + 1) failures.push('card scrolls horizontally');
          for (const field of card.querySelectorAll('dt, dd, .infrastructure-pressure > span')) {
            const range = document.createRange();
            range.selectNodeContents(field);
            for (const rect of range.getClientRects()) {
              if (rect.left < bounds.left || rect.right > bounds.right)
                failures.push(field.textContent ?? 'overflowing field');
            }
          }
        }
        return failures;
      });
      expect(overflow, `${width}px ${colorScheme} metric layout`).toEqual([]);
      await region.screenshot({
        path: `../tmp/verification/infrastructure-metrics-${width}-${colorScheme}.png`,
        animations: 'disabled',
      });
    }
    if (width <= 900)
      await page.getByRole('button', { name: 'Back to diagram', exact: true }).click();
  }
});
