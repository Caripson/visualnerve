import { expect, test, type Page } from './fixtures';
import { randomUUID } from 'node:crypto';
import type { Graph } from '../../src/model/types';
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function open(page: Page, name: string) {
  await page.goto('/app/');
  await page.locator('.diagram-item').filter({ hasText: name }).click();
  await saved(page);
}
async function deselect(page: Page) {
  await page.locator('.react-flow__pane').click({ position: { x: 18, y: 40 } });
}

test('undoing a middle mindmap branch deletion preserves order and colors through redo and reload', async ({
  page,
  request,
}) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name: 'Ordered branch history',
        type: 'mindmap',
        settings: { viewport: { x: 20, y: 20, zoom: 0.8 } },
      },
    })
  ).json();
  const original = (await (
    await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
      data: {
        nodes: [
          { title: 'Root', externalId: 'root', x: 100, y: 260 },
          { title: 'First', externalId: 'first', parentExternalId: 'root', x: 450, y: 100 },
          { title: 'Middle', externalId: 'middle', parentExternalId: 'root', x: 450, y: 260 },
          { title: 'Last', externalId: 'last', parentExternalId: 'root', x: 450, y: 420 },
        ],
        edges: ['first', 'middle', 'last'].map((targetExternalId) => ({
          sourceExternalId: 'root',
          targetExternalId,
          edgeType: 'hierarchy',
          direction: 'none',
        })),
      },
    })
  ).json()) as Graph;
  await open(page, 'Ordered branch history');
  await expect(page.locator('.canvas-shell .mindmap-topic')).toHaveCount(4);
  const middle = original.nodes.find((node) => node.externalId === 'middle')!;
  const branchColors = () =>
    page
      .locator('.canvas-shell .mindmap-topic')
      .evaluateAll((elements) =>
        Object.fromEntries(
          elements.map((element) => [
            element.getAttribute('data-node-id'),
            (element as HTMLElement).style.getPropertyValue('--branch-color'),
          ]),
        ),
      );
  const colors = await branchColors();
  const current = async () =>
    (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  const restored = async () => {
    const graph = await current();
    expect(graph.nodes.map((node) => node.id)).toEqual(original.nodes.map((node) => node.id));
    expect(graph.edges.map((edge) => edge.id)).toEqual(original.edges.map((edge) => edge.id));
    await expect.poll(branchColors).toEqual(colors);
  };
  await page.locator(`[data-node-id="${middle.id}"]`).click();
  await page.keyboard.press('Delete');
  await expect(page.locator(`[data-node-id="${middle.id}"]`)).toHaveCount(0);
  await saved(page);
  const deleted = await current();
  expect(deleted.nodes.map((node) => node.id)).toEqual(
    original.nodes.filter((node) => node.id !== middle.id).map((node) => node.id),
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  await restored();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  expect((await current()).nodes.map((node) => node.id)).toEqual(
    deleted.nodes.map((node) => node.id),
  );
  expect((await current()).edges.map((edge) => edge.id)).toEqual(
    deleted.edges.map((edge) => edge.id),
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  await restored();
  await open(page, 'Ordered branch history');
  await restored();
});

test('mind map keyboard editing, semantic metadata, copy/paste, collapse and history', async ({
  page,
  request,
}) => {
  const d = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Keyboard map', type: 'mindmap' } })
  ).json();
  const n = await (
    await request.post(`/api/v1/diagrams/${d.id}/nodes`, {
      data: { title: 'Root', x: 50, y: 50, metadata: { preserved: { score: 42 } } },
    })
  ).json();
  await open(page, 'Keyboard map');
  await page.locator(`[data-node-id="${n.id}"]`).click();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Node title')).toHaveValue('New child');
  await page.keyboard.press('Enter'); // Commit the newly focused topic editor.
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Node title')).toHaveValue('New sibling');
  await saved(page);
  let g = (await (await request.get(`/api/v1/diagrams/${d.id}`)).json()) as Graph;
  expect(g.nodes).toHaveLength(3);
  expect(g.edges).toHaveLength(2);
  expect(g.nodes[2].parentId).toBe(n.id);
  await page.locator(`[data-node-id="${n.id}"]`).click();
  await page.keyboard.press('Control+d');
  await saved(page);
  g = await (await request.get(`/api/v1/diagrams/${d.id}`)).json();
  expect(g.nodes).toHaveLength(4);
  expect(g.nodes[3].metadata).toEqual({ preserved: { score: 42 } });
  expect(g.nodes[3].id).not.toBe(n.id);
  await page.keyboard.press('Control+z');
  await saved(page);
  expect((await (await request.get(`/api/v1/diagrams/${d.id}`)).json()).nodes).toHaveLength(3);
  await page.keyboard.press('Control+Shift+z');
  await saved(page);
  expect((await (await request.get(`/api/v1/diagrams/${d.id}`)).json()).nodes).toHaveLength(4);
  await page.locator(`[data-node-id="${n.id}"]`).click({ position: { x: 10, y: 10 } });
  await page
    .locator(`[data-node-id="${n.id}"]`)
    .getByRole('button', { name: 'Collapse branch' })
    .click();
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(2);
  await page
    .locator(`[data-node-id="${n.id}"]`)
    .getByRole('button', { name: 'Expand branch' })
    .click();
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(4);
  await page.keyboard.press('ArrowRight');
  await saved(page);
  const moved = await (await request.get(`/api/v1/diagrams/${d.id}`)).json();
  expect(moved.nodes.find((x: { id: string }) => x.id === n.id).x).toBe(60);
});

test('group containment moves as a unit, resizes, ungroups and supports connection drag', async ({
  page,
  request,
}) => {
  const d = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Group editing', type: 'flowchart' } })
  ).json();
  const g = (await (
    await request.post(`/api/v1/diagrams/${d.id}/bulk`, {
      data: {
        nodes: [
          { title: 'One', x: 100, y: 100, externalId: 'one' },
          { title: 'Two', x: 450, y: 100, externalId: 'two' },
        ],
      },
    })
  ).json()) as Graph;
  await open(page, 'Group editing');
  const one = page.locator(`[data-node-id="${g.nodes[0].id}"]`),
    two = page.locator(`[data-node-id="${g.nodes[1].id}"]`);
  await one.click();
  await two.click({ modifiers: ['Shift'] });
  await expect(
    page.getByRole('button', { name: 'Group selection', exact: true }).first(),
  ).toBeEnabled();
  await page.keyboard.press('Control+g');
  await saved(page);
  let grouped = (await (await request.get(`/api/v1/diagrams/${d.id}`)).json()) as Graph;
  const group = grouped.nodes.find((n) => n.nodeType === 'group')!;
  expect(grouped.nodes.filter((n) => n.parentId === group.id)).toHaveLength(2);
  const before = new Map(grouped.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const box = await page.locator(`[data-node-id="${group.id}"] .node-title`).boundingBox();
  await page.mouse.move(box!.x + 30, box!.y + 5);
  await page.mouse.down();
  await page.mouse.move(box!.x + 110, box!.y + 60, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  grouped = await (await request.get(`/api/v1/diagrams/${d.id}`)).json();
  const movedGroup = grouped.nodes.find((n) => n.id === group.id)!;
  const dx = movedGroup.x - before.get(group.id)!.x,
    dy = movedGroup.y - before.get(group.id)!.y;
  expect(dx).toBeGreaterThan(20);
  for (const n of grouped.nodes.filter((n) => n.parentId === group.id)) {
    expect(n.x - before.get(n.id)!.x).toBeCloseTo(dx, 2);
    expect(n.y - before.get(n.id)!.y).toBeCloseTo(dy, 2);
  }
  const resize = page.locator(
    `.react-flow__node[data-id="${group.id}"] .react-flow__resize-control.bottom.right`,
  );
  const handle = await resize.boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 45, handle!.y + 40, { steps: 10 });
  await page.mouse.up();
  await saved(page);
  expect(
    (await (await request.get(`/api/v1/diagrams/${d.id}`)).json()).nodes.find(
      (n: { id: string }) => n.id === group.id,
    ).width,
  ).toBeGreaterThan(group.width);
  await page.keyboard.press('Control+Shift+g');
  await saved(page);
  expect((await (await request.get(`/api/v1/diagrams/${d.id}`)).json()).nodes).toHaveLength(2);
  const source = await one.locator('.react-flow__handle-right').boundingBox(),
    target = await two.locator('.react-flow__handle-left').boundingBox();
  await page.mouse.move(source!.x + 3, source!.y + 3);
  await page.mouse.down();
  await page.mouse.move(target!.x + 3, target!.y + 3, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  expect((await (await request.get(`/api/v1/diagrams/${d.id}`)).json()).edges).toHaveLength(1);
});

test('box selection copies internal relationships and edges reconnect with history', async ({
  page,
  request,
}) => {
  const diagram = await (
    await request.post('/api/v1/diagrams', {
      data: {
        name: 'Selection and connections',
        settings: { viewport: { x: 20, y: 60, zoom: 1 } },
      },
    })
  ).json();
  const graph = (await (
    await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
      data: {
        nodes: [
          {
            title: 'Source',
            externalId: 'source',
            x: 100,
            y: 100,
            metadata: { nested: { priority: 3 } },
          },
          { title: 'First target', externalId: 'first', x: 450, y: 100 },
          { title: 'Second target', externalId: 'second', x: 450, y: 350 },
        ],
        edges: [
          {
            sourceExternalId: 'source',
            targetExternalId: 'first',
            metadata: { relationship: 'required' },
          },
        ],
      },
    })
  ).json()) as Graph;
  await open(page, 'Selection and connections');
  const first = page.locator(`[data-node-id="${graph.nodes[0].id}"]`);
  const second = page.locator(`[data-node-id="${graph.nodes[1].id}"]`);
  const a = (await first.boundingBox())!,
    b = (await second.boundingBox())!;
  await page.mouse.move(a.x - 20, a.y - 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 20, b.y + b.height + 20, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await saved(page);
  const pasted = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(pasted.nodes).toHaveLength(5);
  expect(pasted.edges).toHaveLength(2);
  const originalIDs = new Set(graph.nodes.map((node) => node.id));
  const copies = pasted.nodes.filter((node) => !originalIDs.has(node.id));
  expect(copies.find((node) => node.title === 'Source')?.metadata).toEqual({
    nested: { priority: 3 },
  });
  const copiedIDs = new Set(copies.map((node) => node.id));
  const copiedEdge = pasted.edges.find(
    (edge) => copiedIDs.has(edge.sourceNodeId) && copiedIDs.has(edge.targetNodeId),
  )!;
  expect(copiedEdge.id).not.toBe(graph.edges[0].id);
  expect(copiedEdge.metadata).toEqual({ relationship: 'required' });
  await deselect(page);
  const edge = page.locator(`.react-flow__edge[data-id="${graph.edges[0].id}"]`);
  // A horizontal SVG path has zero box height, so click its actual canvas point.
  const edgeBox = (await edge.locator('.react-flow__edge-interaction').boundingBox())!;
  await page.mouse.click(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2);
  await page.getByLabel('Connection label').fill('Approved');
  await page.getByLabel('Connection style').selectOption('dashed');
  await page.getByLabel('Connection target').selectOption(graph.nodes[2].id);
  await saved(page);
  let updated = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(updated.edges.find((item) => item.id === graph.edges[0].id)).toMatchObject({
    label: 'Approved',
    style: 'dashed',
    targetNodeId: graph.nodes[2].id,
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  const undone = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(undone.edges.find((item) => item.id === graph.edges[0].id)?.targetNodeId).toBe(
    graph.nodes[1].id,
  );
  const restoredEdgeBox = (await edge.locator('.react-flow__edge-interaction').boundingBox())!;
  await page.mouse.click(
    restoredEdgeBox.x + restoredEdgeBox.width / 2,
    restoredEdgeBox.y + restoredEdgeBox.height / 2,
  );
  await expect(page.getByLabel('Connection target')).toHaveValue(graph.nodes[1].id);
  const anchor = (await edge.locator('.react-flow__edgeupdater-target').boundingBox())!;
  const target = (await page
    .locator(`[data-node-id="${graph.nodes[2].id}"] .react-flow__handle-left`)
    .boundingBox())!;
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  updated = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
  expect(updated.edges.find((item) => item.id === graph.edges[0].id)?.targetNodeId).toBe(
    graph.nodes[2].id,
  );
  await first.click({ position: { x: 10, y: 10 } });
  await page.getByRole('button', { name: 'Snap to grid' }).click();
  const nodeBox = (await first.boundingBox())!;
  await page.mouse.move(nodeBox.x + 10, nodeBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 83, nodeBox.y + 47, { steps: 10 });
  await page.mouse.up();
  await saved(page);
  const moved = await (await request.get(`/api/v1/nodes/${graph.nodes[0].id}`)).json();
  expect(moved.x % 20).toBe(0);
  expect(moved.y % 20).toBe(0);
});

test('offline edits commit to IndexedDB and survive reload without a server', async ({
  page,
  context,
  request,
}) => {
  const d = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Offline recovery' } })
  ).json();
  const n = await (
    await request.post(`/api/v1/diagrams/${d.id}/nodes`, { data: { title: 'Online' } })
  ).json();
  await open(page, 'Offline recovery');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.locator(`[data-node-id="${n.id}"]`).click();
  await page.getByLabel('Node title').fill('Edited offline');
  await saved(page);
  await page.reload();
  await expect(page.locator(`[data-node-id="${n.id}"]`)).toContainText('Edited offline');
  await saved(page);
  expect(
    await page.evaluate(
      (id) =>
        new Promise((resolve) => {
          const open = indexedDB.open('visual-nerve-cache');
          open.onsuccess = () => {
            const database = open.result;
            const read = database.transaction('nodes').objectStore('nodes').get(id);
            read.onsuccess = () => {
              resolve(read.result.title);
              database.close();
            };
          };
        }),
      n.id,
    ),
  ).toBe('Edited offline');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await saved(page);
  expect((await (await request.get(`/api/v1/nodes/${n.id}`)).json()).title).toBe('Edited offline');
});

test('competing IndexedDB transactions preserve both tab versions in a local copy', async ({
  page,
  context,
  request,
}) => {
  const d = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Conflict recovery' } })
  ).json();
  const n = await (
    await request.post(`/api/v1/diagrams/${d.id}/nodes`, { data: { title: 'Original' } })
  ).json();
  await open(page, 'Conflict recovery');
  const other = await context.newPage();
  await other.goto('/app/');
  await other.evaluate(
    async ({ nodeId, diagramId }) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const open = indexedDB.open('visual-nerve-cache');
        open.onsuccess = () => resolve(open.result);
      });
      const globals = window as unknown as {
        releaseConflict: boolean;
        conflictDone: Promise<void>;
      };
      globals.releaseConflict = false;
      const tx = database.transaction(['diagrams', 'nodes'], 'readwrite');
      globals.conflictDone = new Promise<void>((resolve) => {
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
      });
      const nodes = tx.objectStore('nodes'),
        diagrams = tx.objectStore('diagrams');
      const node = nodes.get(nodeId);
      node.onsuccess = () =>
        nodes.put({
          ...node.result,
          title: 'External edit',
          version: node.result.version + 1,
          updatedAt: new Date().toISOString(),
        });
      const diagram = diagrams.get(diagramId);
      diagram.onsuccess = () =>
        diagrams.put({
          ...diagram.result,
          version: diagram.result.version + 1,
          updatedAt: new Date().toISOString(),
        });
      const hold = () => {
        const request = diagrams.get(diagramId);
        request.onsuccess = () => {
          if (!globals.releaseConflict) hold();
        };
      };
      hold();
    },
    { nodeId: n.id, diagramId: d.id },
  );
  await page.locator(`[data-node-id="${n.id}"]`).click();
  await page.getByLabel('Node title').fill('Local edit');
  await other.evaluate(async () => {
    const globals = window as unknown as { releaseConflict: boolean; conflictDone: Promise<void> };
    globals.releaseConflict = true;
    await globals.conflictDone;
  });
  await other.close();
  await expect(page.getByRole('status').filter({ hasText: /^Conflict$/ })).toBeVisible();
  await expect(page.getByLabel('Node title')).toHaveValue('Local edit');
  await page.getByRole('button', { name: 'Save local copy' }).click();
  await saved(page);
  await expect(page.locator('.document-title h1')).toHaveText('Conflict recovery (local copy)');
  const diagrams = await (await request.get('/api/v1/diagrams')).json();
  const copy = diagrams.find((x: { name: string }) => x.name === 'Conflict recovery (local copy)');
  expect((await (await request.get(`/api/v1/diagrams/${copy.id}`)).json()).nodes[0].title).toBe(
    'Local edit',
  );
  expect((await (await request.get(`/api/v1/nodes/${n.id}`)).json()).title).toBe('External edit');
});

test('timeline dates, filters, dark preference and local Swagger assets', async ({
  page,
  request,
}) => {
  const d = await (
    await request.post('/api/v1/diagrams', { data: { name: 'Scheduled work', type: 'timeline' } })
  ).json();
  const graph = (await (
    await request.post(`/api/v1/diagrams/${d.id}/bulk`, {
      data: {
        nodes: [
          {
            title: 'Discovery',
            startDate: '2026-10-01',
            endDate: '2026-10-04',
            nodeType: 'timeline',
            status: 'done',
            tags: ['release'],
          },
          {
            title: 'Build',
            startDate: '2026-10-10',
            endDate: '2026-10-20',
            nodeType: 'timeline',
            status: 'planned',
          },
        ],
      },
    })
  ).json()) as Graph;
  const remoteRequests: string[] = [];
  page.on('request', (req) => {
    if (
      !req.url().startsWith('http://127.0.0.1:4327') &&
      !req.url().startsWith('data:') &&
      !req.url().startsWith('blob:')
    )
      remoteRequests.push(req.url());
  });
  await open(page, 'Scheduled work');
  for (const scale of ['day', 'week', 'month', 'quarter', 'year']) {
    await page.getByLabel('Timeline zoom').selectOption(scale);
    await expect(page.locator('.timeline-ruler')).toBeVisible();
  }
  await page.getByLabel('Timeline zoom').selectOption('week');
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Filter status').selectOption('done');
  await page.getByLabel('Filter visibility').selectOption('hide');
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme').selectOption('dark');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.timeline-ruler')).toBeVisible();
  await page.locator(`[data-node-id="${graph.nodes[0].id}"]`).click();
  await page.getByLabel('Start date', { exact: true }).fill('2026-10-02');
  await saved(page);
  expect((await (await request.get(`/api/v1/nodes/${graph.nodes[0].id}`)).json()).startDate).toBe(
    '2026-10-02',
  );
  await page.goto('/api/docs');
  await expect(
    page.getByRole('heading', { name: /Visual Nerve local API/, level: 1 }),
  ).toContainText('Visual Nerve');
  await expect(
    page.locator('.opblock-summary-path').filter({ hasText: '/diagrams' }).first(),
  ).toBeVisible();
  expect(remoteRequests).toEqual([]);
});

test('1,000 nodes / 2,000 edges and 5,000-node target remain editable', async ({
  page,
  request,
}, testInfo) => {
  for (const count of [1000, 5000]) {
    const d = await (
      await request.post('/api/v1/diagrams', {
        data: { name: `Scale ${count}`, settings: { viewport: { x: 0, y: 0, zoom: 1 } } },
      })
    ).json();
    const ids = Array.from({ length: count }, () => randomUUID());
    const started = Date.now();
    const response = await request.post(`/api/v1/diagrams/${d.id}/bulk`, {
      data: {
        nodes: ids.map((id, i) => ({
          id,
          title: `Node ${i}`,
          x: (i % 50) * 240,
          y: Math.floor(i / 50) * 110,
        })),
        edges: Array.from({ length: count === 1000 ? 2000 : 6000 }, (_, i) => ({
          sourceNodeId: ids[i % count],
          targetNodeId: ids[(i + 1) % count],
        })),
      },
    });
    expect(response.status()).toBe(200);
    const populated = Date.now();
    await open(page, `Scale ${count}`);
    await expect(page.locator('.canvas-statusbar')).toContainText(`${count} nodes`);
    const rendered = Date.now();
    const target = page.locator(`[data-node-id="${ids[0]}"]`);
    await target.click();
    await page.getByLabel('Node title').fill(`Edited in ${count}`);
    await saved(page);
    const edited = Date.now();
    expect((await (await request.get(`/api/v1/nodes/${ids[0]}`)).json()).title).toBe(
      `Edited in ${count}`,
    );
    expect(rendered - populated).toBeLessThan(15000);
    expect(edited - rendered).toBeLessThan(12000);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add node', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await expect(page.getByLabel('Node title')).toHaveValue('Untitled node', { timeout: 5000 });
    await saved(page);
    await testInfo.attach(`scale-${count}.json`, {
      body: Buffer.from(
        JSON.stringify({
          nodes: count,
          edges: count === 1000 ? 2000 : 6000,
          bulkMs: populated - started,
          openMs: rendered - populated,
          editAndSaveMs: edited - rendered,
        }),
      ),
      contentType: 'application/json',
    });
  }
});
