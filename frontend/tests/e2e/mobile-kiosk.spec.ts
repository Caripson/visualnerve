import { expect, test, type APIRequestContext, type Page } from './fixtures';
import type { Graph } from '../../src/model/types';
import { resolveScenario } from '../../src/simulation/schema';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}

async function touchDrag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + (by.x * step) / 8, y: from.y + (by.y * step) / 8 }],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function readableCanvas(page: Page) {
  const viewport = page.locator('.react-flow__viewport');
  const zoom = await viewport.evaluate(async (element) => {
    let previous = 0,
      stable = 0;
    const deadline = performance.now() + 2000;
    while (stable < 5 && performance.now() < deadline) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = new DOMMatrixReadOnly(getComputedStyle(element).transform).a;
      stable = Math.abs(current - previous) < 0.00001 ? stable + 1 : 0;
      previous = current;
    }
    if (stable < 5) throw new Error('Canvas zoom did not settle after fitting.');
    return previous;
  });
  if (zoom >= 0.25) return;
  // A full landscape overview deliberately hides details below 0.2 zoom.
  // Use the same two-finger gesture as a user to inspect the actual cards.
  const canvas = (await page.locator('.react-flow').boundingBox())!;
  const center = { x: canvas.x + canvas.width / 2, y: canvas.y + 12 };
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 0, x: center.x - 24, y: center.y },
        { id: 1, x: center.x + 24, y: center.y },
      ],
    });
    for (const spread of [36, 48, 60, 72, 84, 96]) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { id: 0, x: center.x - spread, y: center.y },
          { id: 1, x: center.x + spread, y: center.y },
        ],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
  await expect
    .poll(() =>
      viewport.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a),
    )
    .toBeGreaterThan(0.25);
}

async function kiosk(page: Page, request: APIRequestContext) {
  await page.getByRole('button', { name: 'Open projects', exact: true }).tap();
  await page.getByRole('button', { name: /^New diagram/ }).tap();
  await page.getByRole('button', { name: /Kiosk \+ package pickup/ }).tap();
  await page.getByLabel('New diagram name').fill('Kiosk touch regression');
  await page.getByRole('button', { name: 'Create diagram', exact: true }).tap();
  await saved(page);
  const diagrams = await (await request.get('/api/v1/diagrams?type=process-simulator')).json();
  const item = diagrams.find((entry: { name: string }) => entry.name === 'Kiosk touch regression');
  const read = async () =>
    (await (await request.get(`/api/v1/diagrams/${item.id}`)).json()) as Graph;
  return { read, graph: await read() };
}

test('kiosk touch: a new node deletes through selection and Properties, with semantic persistence and undo', async ({
  page,
  request,
}) => {
  const { read, graph } = await kiosk(page, request);
  await page.getByRole('button', { name: 'Add node', exact: true }).tap();
  await saved(page);
  const added = (await read()).nodes.find(
    (node) => !graph.nodes.some((old) => old.id === node.id),
  )!;
  expect(added).toBeDefined();
  expect((await read()).simulation!.nodes.some((node) => node.id === added.id)).toBe(true);
  await expect(page.locator(`.react-flow__node[data-id="${added.id}"]`)).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Delete selection', exact: true }).tap();
  await saved(page);
  expect((await read()).nodes.some((node) => node.id === added.id)).toBe(false);
  expect((await read()).simulation!.nodes.some((node) => node.id === added.id)).toBe(false);
  await expect(page.locator(`.react-flow__node[data-id="${added.id}"]`)).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await saved(page);
  expect((await read()).simulation!.nodes.some((node) => node.id === added.id)).toBe(true);
  await page.locator(`.react-flow__node[data-id="${added.id}"]`).tap();
  await page.getByRole('button', { name: 'Open properties', exact: true }).tap();
  const properties = page.getByRole('dialog', { name: 'Properties', exact: true });
  await expect(properties.getByLabel('Node title', { exact: true })).toHaveValue(added.title);
  await properties.getByRole('button', { name: 'Delete node', exact: true }).tap();
  await saved(page);
  expect((await read()).nodes.some((node) => node.id === added.id)).toBe(false);
  expect((await read()).simulation!.nodes.some((node) => node.id === added.id)).toBe(false);
  await properties.getByRole('button', { name: 'Close properties', exact: true }).tap();
  const deleted = await read();
  await page.reload();
  await saved(page);
  expect((await read()).simulation).toEqual(deleted.simulation);
  expect(deleted.simulation!.nodes).toEqual(graph.simulation!.nodes);
  expect(deleted.simulation!.edges).toEqual(graph.simulation!.edges);
  for (const scenario of graph.simulation!.scenarios) {
    const { scenarios: _beforeScenarios, ...before } = resolveScenario(
      graph.simulation!,
      scenario.id,
    );
    const { scenarios: _afterScenarios, ...after } = resolveScenario(
      deleted.simulation!,
      scenario.id,
    );
    // Scenario patches may be normalized; their effective business assumptions must not change.
    expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(JSON.stringify(before)));
  }
});

test('kiosk touch: a required resource rejects deletion visibly and keeps the selected node', async ({
  page,
  request,
}) => {
  const { read, graph } = await kiosk(page, request);
  const staff = graph.simulation!.nodes.find((node) => node.type === 'resource')!;
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
  await page.locator(`.react-flow__node[data-id="${staff.id}"]`).tap();
  await page.getByRole('button', { name: 'Open properties', exact: true }).tap();
  const properties = page.getByRole('dialog', { name: 'Properties', exact: true });
  await properties.getByRole('button', { name: 'Delete node', exact: true }).tap();
  await expect(properties.getByRole('alert')).toContainText('Disconnect this shared resource');
  await expect(properties.getByRole('alert')).toBeInViewport();
  await expect(properties.getByLabel('Node title', { exact: true })).toHaveValue(staff.name);
  expect((await read()).simulation).toEqual(graph.simulation);
  await properties.getByRole('button', { name: 'Close properties', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Delete selection', exact: true })).toBeVisible();
  await expect(page.locator(`.react-flow__node[data-id="${staff.id}"]`)).toHaveClass(/selected/);
});

test('kiosk touch: deleting a connected capacity card removes its logical Work node and edges', async ({
  page,
  request,
}) => {
  const { read, graph } = await kiosk(page, request);
  const work = graph.simulation!.nodes.find((node) => node.type === 'work')!;
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
  await page.locator(`.react-flow__node[data-id="${work.id}"]`).tap();
  await page.getByRole('button', { name: 'Add next', exact: true }).tap();
  await page.getByRole('button', { name: 'Insert work step', exact: true }).tap();
  await saved(page);
  const inserted = (await read()).simulation!.nodes.find(
    (node) => !graph.simulation!.nodes.some((old) => old.id === node.id),
  )!;
  expect(inserted.type).toBe('work');
  let configured = structuredClone((await read()).simulation!);
  let response: Awaited<ReturnType<APIRequestContext['put']>> | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await read();
    configured = structuredClone(current.simulation!);
    const added = configured.nodes.find((node) => node.id === inserted.id)!;
    if (added.type !== 'work') throw new Error('Expected connected Work');
    added.work.capacity = 2;
    response = await request.put(`/api/v1/diagrams/${graph.diagram.id}/simulation`, {
      data: { baseVersion: current.diagram.version, model: configured },
    });
    if (response.status() !== 409) break;
    // The real camera may commit between GET and PUT. Exercise the documented
    // optimistic client retry; a false editor conflict must still fail saved().
    expect(await response.json()).toMatchObject({
      error: 'Another tab changed this project. Your local changes are preserved.',
    });
    await saved(page);
    await readableCanvas(page);
  }
  expect(response!.ok(), await response!.text()).toBeTruthy();
  await saved(page);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
  const copy = page.locator(`[data-node-id="simulation-capacity:${inserted.id}:2"]`);
  await expect(copy).toBeVisible();
  await copy.tap();
  await page.getByRole('button', { name: 'Delete selection', exact: true }).tap();
  await saved(page);
  const deleted = await read();
  expect(deleted.nodes.some((node) => node.id === inserted.id)).toBe(false);
  expect(deleted.simulation!.nodes.some((node) => node.id === inserted.id)).toBe(false);
  expect(
    deleted.simulation!.edges.some(
      (edge) => edge.sourceNodeId === inserted.id || edge.targetNodeId === inserted.id,
    ),
  ).toBe(false);
  await expect(page.locator(`[data-simulation-logical-node="${inserted.id}"]`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await saved(page);
  expect((await read()).simulation).toEqual(configured);
  await expect(copy).toBeVisible();
});

test('kiosk cards fit status, shared resources, capacity and queue at phone and landscape sizes', async ({
  page,
  request,
}) => {
  const { read, graph } = await kiosk(page, request);
  await page.getByRole('button', { name: 'Open simulation details', exact: true }).tap();
  const details = page.getByRole('dialog', { name: 'Simulation details', exact: true });
  await details.getByLabel('Simulation panel', { exact: true }).selectOption('run');
  await page.getByLabel('Simulation speed', { exact: true }).selectOption('max');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).tap();
  await expect(page.locator('.simulation-run-status')).toHaveText('completed');
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
    await readableCanvas(page);
    const measured = [];
    // Visible-node rendering deliberately culls objects outside a zoomed view.
    // Navigate through the real workspace search to inspect every logical card.
    for (const node of graph.nodes) {
      await page.keyboard.press('Control+f');
      await page.getByLabel('Global search', { exact: true }).fill(node.title);
      await page.locator('.search-results button').filter({ hasText: node.title }).tap();
      await expect(
        page.getByRole('dialog', { name: 'Search your workspace', exact: true }),
      ).toBeHidden();
      const summary = page.locator(`.simulation-node-summary[data-simulation-node="${node.id}"]`);
      await expect(summary).toBeVisible();
      measured.push(
        await summary.evaluate((element) => {
          const card = element.closest<HTMLElement>('.vn-node')!;
          const bounds = card.getBoundingClientRect();
          const details = element.querySelector<HTMLElement>('.simulation-node-details');
          const targets = [
            card.querySelector('.node-title'),
            element.querySelector('.simulation-node-state'),
            element.querySelector('.simulation-node-queue'),
            details,
          ].filter((target): target is Element => !!target);
          return {
            id: element.getAttribute('data-simulation-node'),
            height: card.offsetHeight,
            contained: targets.every((target) => {
              const rect = target.getBoundingClientRect();
              return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
            }),
            overflowing: !!details && details.scrollHeight > details.clientHeight + 1,
            resources: element.querySelector('.simulation-node-resources')?.textContent,
          };
        }),
      );
    }
    expect(
      measured.every((card) => card.contained),
      JSON.stringify(measured),
    ).toBe(true);
    for (const work of graph.simulation!.nodes.filter((node) => node.type === 'work')) {
      const card = measured.find((card) => card.id === work.id)!;
      expect(card.height).toBeGreaterThanOrEqual(240);
      expect(card.overflowing).toBe(false);
      expect(card.resources).toContain('Shared store staff');
      expect(card.resources).toContain('Shared service counter');
    }
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).tap();
    const quickAdd = page.locator('.node-quick-add').getByRole('button', {
      name: 'Add previous',
      exact: true,
    });
    // IntersectionObserver rounds fractional transforms; exact pixel margins
    // below still require the complete control to sit inside the canvas.
    await expect(quickAdd).toBeInViewport({ ratio: 0.99999 });
    await expect
      .poll(async () => {
        const trigger = await quickAdd.boundingBox();
        const canvas = await page.locator('.react-flow').boundingBox();
        return (
          !!trigger &&
          !!canvas &&
          trigger.x >= canvas.x + 3 &&
          trigger.x + trigger.width <= canvas.x + canvas.width - 3 &&
          trigger.y >= canvas.y + 3 &&
          trigger.y + trigger.height <= canvas.y + canvas.height - 3
        );
      })
      .toBe(true);
    await quickAdd.tap();
    const addMenu = page.getByRole('dialog', { name: 'Add previous menu', exact: true });
    await expect(addMenu).toBeInViewport({ ratio: 0.99999 });
    await expect(
      addMenu.getByRole('button', { name: 'Insert work step', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(addMenu).toBeHidden();
    await page.screenshot({ path: `/tmp/visualnerve-kiosk-mobile-${viewport.width}.png` });
  }
  // Responsive display geometry must never rewrite the saved diagram dimensions.
  expect((await read()).nodes.map(({ id, width, height }) => ({ id, width, height }))).toEqual(
    graph.nodes.map(({ id, width, height }) => ({ id, width, height })),
  );
});

test('kiosk touch: the primary Work card moves and resizes without rewriting processing assumptions', async ({
  page,
  request,
}) => {
  const { read, graph } = await kiosk(page, request);
  await page.getByRole('button', { name: 'Add node', exact: true }).tap();
  await saved(page);
  const before = await read();
  const added = before.nodes.find((node) => !graph.nodes.some((old) => old.id === node.id))!;
  const card = page.locator(`.react-flow__node[data-id="${added.id}"]`);
  await expect(card).toBeInViewport({ ratio: 1 });
  const title = (await card.locator('.node-title').boundingBox())!;
  await touchDrag(
    page,
    { x: title.x + title.width / 2, y: title.y + title.height / 2 },
    { x: 50, y: -45 },
  );
  await saved(page);
  const moved = await read();
  const movedNode = moved.nodes.find((node) => node.id === added.id)!;
  expect(movedNode.x).not.toBe(added.x);
  expect(movedNode.y).not.toBe(added.y);
  expect(moved.simulation).toEqual(before.simulation);
  const handle = card.locator('.react-flow__resize-control.handle.bottom.right');
  await expect(handle).toBeVisible();
  const corner = (await handle.boundingBox())!;
  const handleStyle = await handle.evaluate((element) => ({
    width: getComputedStyle(element).width,
    scale: getComputedStyle(element).scale,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    className: element.className,
    viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
    markup: element.outerHTML,
  }));
  expect(corner.width, JSON.stringify(handleStyle)).toBeGreaterThanOrEqual(24);
  expect(corner.height).toBeGreaterThanOrEqual(24);
  await touchDrag(
    page,
    { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 },
    { x: 28, y: 24 },
  );
  await saved(page);
  const resized = await read();
  const resizedNode = resized.nodes.find((node) => node.id === added.id)!;
  expect(resizedNode.width).toBeGreaterThan(movedNode.width);
  expect(resizedNode.height).toBeGreaterThanOrEqual(280);
  expect(resized.simulation).toEqual(before.simulation);
  await page.reload();
  await saved(page);
  expect((await read()).nodes.find((node) => node.id === added.id)).toEqual(resizedNode);
});
