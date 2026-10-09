import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_LOCALES, I18nProvider, type AppLocale } from '../src/i18n';
import { AppLocaleController } from '../src/i18n/locale-controller';
import { LocaleCatalogLoader } from '../src/i18n/catalog-loader';
import { MessageFormatter } from '../src/i18n/message-formatter';
import { ModelEditor } from '../src/simulation/ModelEditor';
import { MetricsDashboard } from '../src/simulation/MetricsDashboard';
import { StarterReview } from '../src/simulation/StarterReview';
import { starterDefaults } from '../src/simulation/starter';
import { createSimulationGraph } from '../src/simulation/document';
import { createBasicModel } from '../src/simulation/examples';
import { SimulationEngine } from '../src/simulation/engine';
import {
  nodeTrafficReason,
  runStatusLabel,
  simulationDiagnosticLabel,
  trafficStatusLabel,
} from '../src/simulation/display';
import { useEditor } from '../src/state/editor';

const controllers: AppLocaleController[] = [];
async function language(locale: AppLocale) {
  const controller = new AppLocaleController(new LocaleCatalogLoader(), {
    getItem: () => locale,
    setItem: vi.fn(),
  });
  controllers.push(controller);
  await controller.start();
  const catalog = controller.getSnapshot().catalog!;
  return { controller, formatter: new MessageFormatter(locale, catalog) };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  useEditor.getState().setGraph(null);
  document.documentElement.lang = 'en';
});

describe('simulation labels without changing semantic values', () => {
  it.each(APP_LOCALES.map(({ id }) => id))(
    'keeps node types, outcome status and tabs canonical in %s while translating their display',
    async (locale) => {
      const { controller, formatter } = await language(locale);
      const graph = createSimulationGraph('Customer process — user title', createBasicModel());
      const original = JSON.stringify(graph.simulation);
      useEditor.getState().setGraph(graph);
      render(
        <I18nProvider controller={controller}>
          <ModelEditor graph={graph} close={vi.fn()} />
        </I18nProvider>,
      );
      const choose = screen.getByRole('combobox', {
        name: formatter.t('simulator.editor.node.addSimulationNode'),
      });
      expect(
        within(choose)
          .getAllByRole('option')
          .map((option) => (option as HTMLOptionElement).value),
      ).toEqual(['', 'source', 'work', 'router', 'fork', 'resource', 'outcome']);
      expect(
        within(choose).getByRole('option', { name: formatter.t('simulator.parallel.fork') }),
      ).toHaveValue('fork');
      expect(
        within(choose).getByRole('option', {
          name: formatter.t('simulator.editor.nodeType.resource'),
        }),
      ).toHaveValue('resource');
      fireEvent.change(
        screen.getByRole('combobox', { name: formatter.t('simulator.editor.node.simulationNode') }),
        { target: { value: graph.simulation!.nodes.find((node) => node.type === 'outcome')!.id } },
      );
      const outcomes = screen.getByRole('combobox', {
        name: formatter.t('simulator.editor.outcome.statusLabel'),
      });
      expect(outcomes).toHaveValue('completed');
      expect(
        within(outcomes)
          .getAllByRole('option')
          .map((option) => (option as HTMLOptionElement).value),
      ).toEqual(['completed', 'failed', 'rejected']);
      fireEvent.click(
        screen.getByRole('button', {
          name: formatter.t('simulator.editor.section.resources.desktop'),
        }),
      );
      expect(
        screen.getByRole('button', {
          name: formatter.t('simulator.editor.resource.addSharedResource'),
        }),
      ).toBeInTheDocument();
      expect(JSON.stringify(useEditor.getState().graph?.simulation)).toBe(original);
    },
  );

  it('preserves edited assumptions and invalid JSON identity across language changes, then applies only the corrected draft', async () => {
    const { controller, formatter } = await language('en');
    const graph = createSimulationGraph('Authored process', createBasicModel());
    useEditor.getState().setGraph(graph);
    const close = vi.fn();
    render(
      <I18nProvider controller={controller}>
        <ModelEditor graph={graph} close={close} />
      </I18nProvider>,
    );
    fireEvent.change(
      screen.getByRole('combobox', { name: formatter.t('simulator.editor.node.simulationNode') }),
      { target: { value: graph.simulation!.nodes.find((node) => node.type === 'work')!.id } },
    );
    const capacity = screen.getByRole('spinbutton', {
      name: formatter.t('simulator.editor.work.capacity'),
    });
    fireEvent.change(capacity, { target: { value: '8' } });
    const json = screen.getByRole('textbox', {
      name: formatter.t('simulator.editor.work.workAvailabilitySchedule'),
    });
    fireEvent.change(json, { target: { value: '[' } });
    expect(
      screen.getByRole('button', { name: formatter.t('simulator.editor.model.apply') }),
    ).toBeDisabled();
    await act(async () => {
      await controller.selectLocale('sv');
    });
    const swedish = new MessageFormatter('sv', controller.getSnapshot().catalog!);
    expect(
      screen.getByRole('textbox', {
        name: swedish.t('simulator.editor.work.workAvailabilitySchedule'),
      }),
    ).toBe(json);
    expect(json).toHaveValue('[');
    expect(capacity).toHaveValue(8);
    expect(
      screen.getByRole('button', { name: swedish.t('simulator.editor.model.apply') }),
    ).toBeDisabled();
    expect(
      screen
        .getAllByRole('alert')
        .map((alert) => alert.textContent)
        .join(' '),
    ).toContain(swedish.t('simulator.editor.json.invalidSyntax'));
    await act(async () => {
      await controller.selectLocale('de');
    });
    const german = new MessageFormatter('de', controller.getSnapshot().catalog!);
    expect(
      screen.getByRole('textbox', {
        name: german.t('simulator.editor.work.workAvailabilitySchedule'),
      }),
    ).toBe(json);
    expect(
      screen.getByRole('button', { name: german.t('simulator.editor.model.apply') }),
    ).toBeDisabled();
    expect(useEditor.getState().graph!.simulation).toBe(graph.simulation);
    fireEvent.change(json, { target: { value: '[]' } });
    fireEvent.click(screen.getByRole('button', { name: german.t('simulator.editor.model.apply') }));
    expect(close).toHaveBeenCalledOnce();
    expect(
      useEditor.getState().graph!.simulation!.nodes.find((node) => node.type === 'work'),
    ).toMatchObject({ work: { capacity: 8 } });
    expect(useEditor.getState().graph!.diagram.name).toBe('Authored process');
  });

  it.each(APP_LOCALES.map(({ id }) => id))(
    'renders complete dashboard facts in %s while preserving metric selectors and simulation state',
    async (locale) => {
      const { controller, formatter } = await language(locale);
      const engine = new SimulationEngine(createBasicModel(), { seed: 42, durationSeconds: 3600 });
      engine.advance(60);
      const state = engine.state();
      const original = structuredClone(state);
      const { container } = render(
        <I18nProvider controller={controller}>
          <MetricsDashboard state={state} currency="SEK" compact />
        </I18nProvider>,
      );
      expect(container.querySelectorAll('[data-metric]')).toHaveLength(25);
      expect(
        container.querySelector('[data-metric="Current queue"]')?.previousElementSibling,
      ).toHaveTextContent(formatter.t('simulator.metrics.currentQueue'));
      expect(container.querySelector('[data-metric="Revenue"]')).toHaveTextContent('SEK');
      expect(state).toEqual(original);
      expect(
        screen.getByRole('heading', { name: formatter.t('simulator.metrics.workQueues') }),
      ).toBeInTheDocument();
    },
  );

  it('translates actual traffic, named shared resources and recognized validation while keeping arbitrary diagnostics unchanged', async () => {
    const { formatter } = await language('fr');
    const traffic = {
      level: 'congested' as const,
      label: 'Resource blocked',
      reason: 'Waiting for Customer staff · 12 queued',
      queue: 12,
      utilization: 0.99,
      waitingResources: ['Customer staff'],
    };
    expect(trafficStatusLabel(formatter.t, traffic.label)).toBe(
      formatter.t('simulator.traffic.resourceBlocked'),
    );
    expect(nodeTrafficReason(formatter.t, traffic)).toBe(
      formatter.t('simulator.traffic.waitingForQueued', {
        resourceNames: 'Customer staff',
        queueCount: 12,
      }),
    );
    expect(
      simulationDiagnosticLabel(
        formatter.t,
        'Step 2 capacity must be a whole number between 1 and 100000.',
      ),
    ).toBe(
      formatter.t('simulator.wizard.validation.mustBeAWholeNumberBetweenAnd', {
        fieldLabel: formatter.t('simulator.wizard.validation.stepCapacity', { stepNumber: 2 }),
        minimum: 1,
        maximum: 100000,
      }),
    );
    expect(simulationDiagnosticLabel(formatter.t, 'Name subprocess 2 and its work step.')).toBe(
      formatter.t('simulator.wizard.validation.nameSubprocessAndItsWorkStep', { stepNumber: 2 }),
    );
    expect(simulationDiagnosticLabel(formatter.t, 'Custom data diagnostic')).toBe(
      'Custom data diagnostic',
    );
    expect(runStatusLabel(formatter.t, 'constructor')).toBe('constructor');
    expect(traffic).toMatchObject({
      label: 'Resource blocked',
      waitingResources: ['Customer staff'],
    });
  });

  it('uses whole plural messages for Finnish counts instead of translated fragment concatenation', async () => {
    const { controller } = await language('fi');
    const draft = {
      ...starterDefaults(),
      arrivalMode: 'batch' as const,
      batchCount: '2',
      capacity: '2',
    };
    render(
      <I18nProvider controller={controller}>
        <StarterReview draft={draft} />
      </I18nProvider>,
    );
    expect(screen.getByText('2 yksikköä alussa')).toBeInTheDocument();
    expect(screen.getByText(/2 paikkaa/)).toBeInTheDocument();
  });
});
