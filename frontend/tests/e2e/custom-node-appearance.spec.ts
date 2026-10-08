import { expect, test } from './fixtures';
import type { Graph } from '../../src/model/types';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`native input/output shapes have no built-in white underlay at ${width}px in ${theme}`, async ({
      page,
      request,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      expect((await request.put('/api/v1/settings/theme', { data: { value: theme } })).ok()).toBe(
        true,
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const diagram = await (
        await request.post('/api/v1/diagrams', {
          data: { name: 'Native shapes', type: 'process' },
        })
      ).json();
      const graph = (await (
        await request.post(`/api/v1/diagrams/${diagram.id}/bulk`, {
          data: {
            nodes: [
              {
                externalId: 'input',
                title: 'Customer request',
                nodeType: 'input',
                x: 0,
                y: 0,
                width: 220,
                height: 130,
              },
              {
                externalId: 'output',
                title: 'Verified delivery',
                nodeType: 'output',
                x: 0,
                y: 220,
                width: 220,
                height: 130,
              },
            ],
            edges: [{ sourceExternalId: 'input', targetExternalId: 'output' }],
          },
        })
      ).json()) as Graph;
      if (width < 900) {
        await page.getByRole('button', { name: 'Open projects', exact: true }).click();
      }
      await page.locator(`button[data-diagram-id="${diagram.id}"]`).click();
      await expect(page.locator('.canvas-shell [data-testid="graph-node"]')).toHaveCount(2);
      const measure = async (id: string) =>
        page.locator(`.canvas-shell .react-flow__node[data-id="${id}"]`).evaluate((outer) => {
          const node = outer.querySelector<HTMLElement>('[data-testid="graph-node"]')!;
          const style = getComputedStyle(outer);
          return {
            padding: style.padding,
            background: style.backgroundColor,
            border: style.borderWidth,
            shadow: style.boxShadow,
            outerWidth: (outer as HTMLElement).offsetWidth,
            cardWidth: node.offsetWidth,
          };
        });
      for (const node of graph.nodes) {
        expect(await measure(node.id)).toEqual({
          padding: '0px',
          background: 'rgba(0, 0, 0, 0)',
          border: '0px',
          shadow: 'none',
          outerWidth: 220,
          cardWidth: 220,
        });
      }
      await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
      await page.locator(`.canvas-shell [data-node-id="${graph.nodes[0].id}"]`).click();
      expect((await measure(graph.nodes[0].id)).shadow).toBe('none');
      await info.attach(`native-shapes-${width}-${theme}.png`, {
        body: await page.locator('.canvas-shell').screenshot(),
        contentType: 'image/png',
      });
      const saved = (await (await request.get(`/api/v1/diagrams/${diagram.id}`)).json()) as Graph;
      expect(saved.nodes.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(
        graph.nodes.map(({ x, y, width, height }) => ({ x, y, width, height })),
      );
    });
  }
}
