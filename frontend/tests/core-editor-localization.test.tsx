import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_LOCALES, I18nProvider, type AppLocale } from '../src/i18n';
import { AppLocaleController } from '../src/i18n/locale-controller';
import { LocaleCatalogLoader } from '../src/i18n/catalog-loader';
import { MessageFormatter } from '../src/i18n/message-formatter';
import { Properties } from '../src/components/Properties';
import { SqlQueryDetails } from '../src/components/SqlQuerySummary';
import { IconPicker } from '../src/ui/icons';
import { NodeStatus } from '../src/ui/NodeStatus';
import { canvasAriaLabels } from '../src/canvas/aria-labels';
import {
  diagramModeLabel,
  nodeKindLabel,
  statusLabel,
  templateLabel,
} from '../src/ui/editor-labels';
import { blankGraph, newNode } from '../src/model/types';
import { nodeRegistry } from '../src/nodes/registry';
import { useEditor } from '../src/state/editor';

const controllers: AppLocaleController[] = [];
async function language(locale: AppLocale) {
  const controller = new AppLocaleController(new LocaleCatalogLoader(), {
    getItem: () => locale,
    setItem: vi.fn(),
  });
  controllers.push(controller);
  await controller.start();
  return { controller, formatter: new MessageFormatter(locale, controller.getSnapshot().catalog!) };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  useEditor.getState().setGraph(null);
  document.documentElement.lang = 'en';
});

describe('localized editor display with canonical documents', () => {
  it.each(APP_LOCALES.map(({ id }) => id))(
    'uses curated display names in %s without changing registry or unknown user statuses',
    async (locale) => {
      const { formatter } = await language(locale);
      expect(nodeKindLabel(formatter.t, 'decision')).toBe(
        formatter.t('editor.nodes.typeLabel.decision'),
      );
      expect(diagramModeLabel(formatter.t, 'process-simulator')).toBe(
        formatter.t('editor.properties.diagram.mode.processSimulator'),
      );
      expect(templateLabel(formatter.t, 'mind-map', 'Mind Map')).toBe(
        formatter.t('editor.templates.mind-map'),
      );
      expect(templateLabel(formatter.t, 'customer-owned', 'My working template')).toBe(
        'My working template',
      );
      expect(nodeRegistry.decision.label).toBe('Decision');
      expect(statusLabel(formatter.t, 'in-progress')).toBe(formatter.t('editor.status.inProgress'));
      expect(statusLabel(formatter.t, '')).toBe(formatter.t('editor.status.noStatus'));
      for (const custom of ['constructor', '__proto__', 'Needs legal review', 'none'])
        expect(statusLabel(formatter.t, custom)).toBe(custom);
      const aria = canvasAriaLabels(formatter.t);
      expect(aria['controls.zoomIn.ariaLabel']).toBe(
        formatter.t('editor.canvas.accessibility.zoomIn'),
      );
      expect(aria['node.a11yDescription.ariaLiveMessage']!({ direction: 'left', x: 1, y: 2 })).toBe(
        formatter.t('editor.canvas.accessibility.nodeMoved', {
          direction: formatter.t('editor.canvas.accessibility.left'),
          x: 1,
          y: 2,
        }),
      );
    },
  );

  it('keeps a live property field, authored title and undoable canonical edits when changing language', async () => {
    const { controller } = await language('en');
    const graph = blankGraph('Authored title');
    const node = newNode(graph.diagram.id, {
      title: 'Customer information',
      nodeType: 'process',
      status: 'Needs legal review',
    });
    graph.nodes.push(node);
    useEditor.getState().setGraph(graph);
    useEditor.getState().select([node.id]);
    render(
      <I18nProvider controller={controller}>
        <Properties />
        <NodeStatus status="Needs legal review" />
      </I18nProvider>,
    );
    const title = screen.getByRole('textbox', { name: 'Node title' });
    fireEvent.change(title, { target: { value: 'Customer information — edited' } });
    await act(async () => {
      await controller.selectLocale('de');
    });
    const german = new MessageFormatter('de', controller.getSnapshot().catalog!);
    expect(screen.getByRole('textbox', { name: german.t('editor.properties.nodeTitle') })).toBe(
      title,
    );
    expect(title).toHaveValue('Customer information — edited');
    const kind = screen.getByRole('combobox', { name: german.t('editor.properties.nodeType') });
    expect(kind).toHaveValue('process');
    expect(
      within(kind).getByRole('option', {
        name: german.t('editor.nodes.typeLabel.decision'),
      }),
    ).toHaveValue('decision');
    fireEvent.change(kind, { target: { value: 'decision' } });
    expect(useEditor.getState().graph?.nodes[0]).toMatchObject({
      id: node.id,
      nodeType: 'decision',
      title: 'Customer information — edited',
      status: 'Needs legal review',
    });
    expect(
      screen.getByRole('img', {
        name: german.t('editor.status.accessible', { label: 'Needs legal review' }),
      }),
    ).toHaveTextContent('Needs legal review');
    expect(useEditor.getState().graph?.diagram.name).toBe('Authored title');
  });

  it('searches icons using a translated label while storing the original icon key', async () => {
    const { controller, formatter } = await language('de');
    const changed = vi.fn();
    render(
      <I18nProvider controller={controller}>
        <IconPicker value="" onChange={changed} />
      </I18nProvider>,
    );
    const summary = screen.getByLabelText(formatter.t('editor.icons.chooseIcon'));
    fireEvent.click(summary);
    fireEvent.change(
      screen.getByRole('textbox', { name: formatter.t('editor.icons.searchIcons') }),
      { target: { value: formatter.t('editor.icons.research') } },
    );
    const result = screen.getByRole('button', {
      name: formatter.t('editor.icons.icon', { iconLabel: formatter.t('editor.icons.research') }),
    });
    fireEvent.click(result);
    expect(changed).toHaveBeenCalledExactlyOnceWith('research');
  });

  it('translates SQL source and unresolved-reference badges while showing the exact original SQL expression and identifier', async () => {
    const { controller, formatter } = await language('fr');
    const node = newNode('diagram', {
      title: 'Original result',
      metadata: {
        sqlQueryResult: {
          version: 1,
          scope: 'query_1',
          name: 'Original result',
          distinct: true,
          columns: [
            {
              ordinal: 1,
              name: 'customer_name',
              expression: 'b.customer_name::string',
              references: [
                {
                  scope: 'query_1',
                  sourceAlias: 'b',
                  column: 'customer_name',
                  resolution: 'unresolved',
                },
              ],
            },
          ],
          clauses: { where: "b.country = 'NO'" },
        },
      },
    });
    const original = structuredClone(node);
    render(
      <I18nProvider controller={controller}>
        <SqlQueryDetails node={node} />
      </I18nProvider>,
    );
    expect(screen.getByText('b.customer_name::string')).toBeInTheDocument();
    expect(screen.getByText('b.customer_name')).toBeInTheDocument();
    expect(
      screen.getByText(formatter.t('editor.sql.referenceResolution.unresolved')),
    ).toBeInTheDocument();
    expect(screen.getByText("b.country = 'NO'")).toBeInTheDocument();
    expect(node).toEqual(original);
  });
});
