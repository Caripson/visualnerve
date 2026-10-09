import { expect, test as base } from './fixtures';
import { graph, open, saved } from './mobile-fixtures';
import { APP_LOCALES } from '../../src/i18n/types';
import { APP_LOCALE_KEY } from '../../src/i18n/locale-controller';
import { LocaleCatalogLoader } from '../../src/i18n/catalog-loader';
import type { Graph } from '../../src/model/types';

const inspectorChunk = /\/Properties-[A-Za-z0-9_-]+\.js(?:\?[^#]*)?$/u;
type InspectorTrace = { requests: string[]; navigations: number };

// Observe before the shared request fixture navigates to the real app. Service
// worker precaching has separate coverage; here only document-owned module loads
// determine whether an unopened inspector crosses its lazy boundary.
const test = base.extend<{ inspectorTrace: InspectorTrace }>({
  inspectorTrace: [
    async ({ page }, use) => {
      const trace: InspectorTrace = { requests: [], navigations: 0 };
      page.on('request', (request) => {
        if (request.resourceType() === 'script' && inspectorChunk.test(request.url()))
          trace.requests.push(request.url());
      });
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) ++trace.navigations;
      });
      await use(trace);
    },
    { auto: true },
  ],
});
test.use({ serviceWorkers: 'block' });

test('empty desktop boot defers the inspector; a missing module preserves canvas editing and guarded human reload', async ({
  page,
  request,
  inspectorTrace,
}) => {
  const english = await new LocaleCatalogLoader().load('en');
  expect((await (await request.get('/api/v1/diagrams')).json()).length).toBe(0);
  await expect(page.locator('.properties .property-empty')).toHaveText(
    english['editor.properties.selectAnObjectToInspectIt'],
  );
  expect(inspectorTrace.requests).toHaveLength(0);
  const initialNavigations = inspectorTrace.navigations;

  await page.route(inspectorChunk, (route) => route.abort('failed'));
  const created = await graph(request, 'Inspector failure preserves authored work', 'mindmap');
  await page.locator('.diagram-item').filter({ hasText: created.diagram.name }).click();
  await expect(page.locator('.properties [role="alert"]')).toHaveText(
    english['shared.toolLoadFailedHint'],
  );
  expect(inspectorTrace.requests).toHaveLength(1);
  await expect(page.locator('.canvas-shell')).toBeVisible();
  const node = created.nodes.find((item) => item.externalId === 'first')!;
  const card = page.locator(`.canvas-shell [data-node-id="${node.id}"]`);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await card.dblclick();
  const inlineTitle = page.getByLabel(english['editor.mindmap.editTopic'], { exact: true });
  await inlineTitle.fill('Saved while inspector is unavailable');
  await inlineTitle.press('Enter');
  await saved(page);
  const afterEdit = (await (
    await request.get(`/api/v1/diagrams/${created.diagram.id}`)
  ).json()) as Graph;
  expect(afterEdit.nodes.find((item) => item.id === node.id)?.title).toBe(
    'Saved while inspector is unavailable',
  );
  expect(inspectorTrace.navigations).toBe(initialNavigations);

  // Restoring the network alone does not reload the page or discard the active
  // editor. Only the human recovery action may save, await quiescence and reload.
  await card.dblclick();
  await inlineTitle.fill('Pending title survives Save and reload');
  await page.unroute(inspectorChunk);
  expect(inspectorTrace.navigations).toBe(initialNavigations);
  expect(inspectorTrace.requests).toHaveLength(1);
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: english['shared.saveAndReload'], exact: true }).click(),
  ]);
  await expect(
    page.getByRole('heading', { name: created.diagram.name, exact: true, level: 1 }),
  ).toBeVisible();
  await saved(page);
  await expect(card.locator('.topic-title')).toHaveText('Pending title survives Save and reload');
  await card.click();
  await expect(
    page.getByLabel(english['editor.properties.nodeTitle'], { exact: true }),
  ).toHaveValue('Pending title survives Save and reload');
  expect(inspectorTrace.requests).toHaveLength(2);
  expect(inspectorTrace.navigations).toBe(initialNavigations + 1);
  const restored = (await (
    await request.get(`/api/v1/diagrams/${created.diagram.id}`)
  ).json()) as Graph;
  expect(restored.nodes.find((item) => item.id === node.id)?.title).toBe(
    'Pending title survives Save and reload',
  );
  expect(restored.edges).toEqual(created.edges);
});

test.describe('mobile inspector retention', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a closed inspector stays unloaded; its first real load retains metadata draft and focus across all eight languages', async ({
    page,
    context,
    request,
    inspectorTrace,
  }) => {
    const catalogs = new LocaleCatalogLoader();
    const english = await catalogs.load('en');
    const created = await graph(request, 'Authored title stays exactly as entered');
    await open(page, created.diagram.name);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
    const node = created.nodes.find((item) => item.externalId === 'first')!;
    await page.locator(`.canvas-shell [data-node-id="${node.id}"]`).tap();
    await saved(page);
    await expect(page.locator('.properties-shell')).toBeHidden();
    expect(inspectorTrace.requests).toHaveLength(0);

    await page
      .getByRole('button', { name: english['workspace.openProperties'], exact: true })
      .tap();
    const inspector = page.locator('.properties-shell');
    await expect(inspector).toBeVisible();
    await expect(
      inspector.getByLabel(english['editor.properties.nodeTitle'], { exact: true }),
    ).toHaveValue(node.title);
    expect(inspectorTrace.requests).toHaveLength(1);
    await inspector.locator('.metadata-editor > summary').tap();
    const metadata = inspector.locator('.metadata-editor textarea');
    const draft = '{ "unfinished": "Do not translate <private>"';
    await metadata.fill(draft);
    const authoritative = (await (
      await request.get(`/api/v1/diagrams/${created.diagram.id}`)
    ).json()) as Graph;

    // A reference page changes only the real origin-local language preference.
    // Native StorageEvents update this active editor without a Settings modal
    // taking focus, another private workspace or synthetic application hooks.
    const languagePeer = await context.newPage();
    try {
      await languagePeer.goto('/help/');
      await metadata.focus();
      for (const { id } of APP_LOCALES) {
        const catalog = await catalogs.load(id);
        await languagePeer.evaluate(({ key, locale }) => localStorage.setItem(key, locale), {
          key: APP_LOCALE_KEY,
          locale: id,
        });
        await expect(page.locator('html')).toHaveAttribute('lang', id);
        await expect(metadata).toHaveAttribute(
          'aria-label',
          catalog['editor.properties.customMetadata'],
        );
        await expect(metadata).toHaveValue(draft);
        await expect(metadata).toBeFocused();
        await expect(
          inspector.getByLabel(catalog['editor.properties.nodeTitle'], { exact: true }),
        ).toHaveValue(node.title);
        expect(inspectorTrace.requests).toHaveLength(1);
      }
    } finally {
      await languagePeer.close();
    }
    const finalCatalog = await catalogs.load(APP_LOCALES[APP_LOCALES.length - 1].id);
    await page.locator('[data-mobile-panel-dismiss="details"]').tap();
    await expect(inspector).toBeHidden();
    await page
      .getByRole('button', { name: finalCatalog['workspace.openProperties'], exact: true })
      .tap();
    await expect(metadata).toHaveValue(draft);
    expect(inspectorTrace.requests).toHaveLength(1);
    expect(await (await request.get(`/api/v1/diagrams/${created.diagram.id}`)).json()).toEqual(
      authoritative,
    );
  });
});
