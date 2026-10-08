import axe from 'axe-core';
import type { TestInfo } from '@playwright/test';
import { expect, test, type Page } from './fixtures';

/** Check rendered controls and text, including actual contrast in both appearances. */
async function accessible(page: Page, label: string, info: TestInfo) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const engine = (window as unknown as { axe: typeof axe }).axe;
    const result = await engine.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return result.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    }));
  });
  await info.attach(label, {
    body: JSON.stringify(violations, null, 2),
    contentType: 'application/json',
  });
  expect(violations, `${label}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`public pages and documentation meet accessibility checks in ${theme} appearance`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    await page.emulateMedia({ colorScheme: theme });
    for (const route of [
      '/',
      '/features/',
      '/use-cases/',
      '/process-simulator/',
      '/mcp/',
      '/developers/',
      '/privacy/',
      '/security/',
      '/help/',
      '/api/docs/',
    ]) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (route === '/api/docs/') await expect(page.locator('#servers')).toBeVisible();
      await accessible(page, `${theme} ${route}`, info);
    }
  });

  test(`SQL, code, export and app handoff dialogs are accessible in ${theme}`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(120000);
    await page.emulateMedia({ colorScheme: theme });
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Import SQL script', exact: true })
      .click();
    await accessible(page, 'SQL import', info);
    await page
      .getByRole('dialog', { name: 'Import SQL', exact: true })
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Visualize code', exact: true })
      .click();
    await accessible(page, 'Code import', info);
    await page
      .getByRole('dialog', { name: 'Visualize code', exact: true })
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await page.getByRole('button', { name: /^New diagram/ }).click();
    await page.getByLabel('New diagram name').fill('Accessible handoff');
    await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await accessible(page, 'Export', info);
    await page
      .getByRole('dialog', { name: 'Export diagram', exact: true })
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await page.getByRole('button', { name: 'Build with Lovable', exact: true }).click();
    await accessible(page, 'Lovable handoff', info);
    expect((await (await request.get('/api/v1/diagrams')).json()).length).toBe(1);
  });

  for (const viewport of [
    { width: 1440, height: 980 },
    { width: 390, height: 844 },
  ]) {
    test(`workspace, kiosk, selection, Properties and Settings accessibility ${viewport.width}px ${theme}`, async ({
      page,
      request,
    }, info) => {
      test.setTimeout(120000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await accessible(page, 'Empty workspace', info);
      if (viewport.width < 900)
        await page.getByRole('button', { name: 'Open projects', exact: true }).click();
      await page.getByRole('button', { name: /^New diagram/ }).click();
      await accessible(page, 'Template selector', info);
      await page.getByRole('button', { name: /Kiosk \+ package pickup/ }).click();
      await page.getByLabel('New diagram name').fill(`Accessible kiosk ${viewport.width} ${theme}`);
      await page.getByRole('button', { name: 'Create diagram', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
      await accessible(page, 'Kiosk canvas', info);
      await page.locator('.react-flow__node-process').first().click();
      await accessible(page, 'Selection actions', info);
      if (viewport.width < 900)
        await page.getByRole('button', { name: 'Open properties', exact: true }).click();
      await accessible(page, 'Selected Properties', info);
      if (viewport.width < 900)
        await page.getByRole('button', { name: 'Close properties', exact: true }).click();
      if (viewport.width < 900) {
        await page.getByRole('button', { name: 'Diagram actions', exact: true }).click();
        await page
          .getByRole('dialog', { name: 'Diagram actions menu', exact: true })
          .getByRole('button', { name: 'Settings', exact: true })
          .click();
      } else await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await accessible(page, 'Settings', info);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      expect(
        (await (await request.get('/api/v1/diagrams?type=process-simulator')).json()).length,
      ).toBe(1);
    });
  }
}
