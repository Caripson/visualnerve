import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEffect, type ComponentType } from 'react';
import { I18nProvider } from '../src/i18n';
import { AppLocaleController } from '../src/i18n/locale-controller';
import { LocaleCatalogLoader } from '../src/i18n/catalog-loader';
import { Properties, type PropertiesProps } from '../src/components/Properties';
import { PropertiesFeature, PropertyInspectorModule } from '../src/components/PropertiesFeature';
import { blankGraph, newNode } from '../src/model/types';
import { useEditor } from '../src/state/editor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function selectedGraph() {
  const graph = blankGraph('Original diagram');
  graph.nodes.push(
    newNode(graph.diagram.id, { title: 'Authored Settings', metadata: { original: true } }),
  );
  useEditor.getState().setGraph(graph);
  useEditor.getState().select([graph.nodes[0].id]);
  return graph;
}

afterEach(() => {
  cleanup();
  useEditor.getState().setGraph(null);
  vi.restoreAllMocks();
});

it('defers the inspector for an empty workspace and unopened mobile details, then retains one loaded view', async () => {
  useEditor.getState().setGraph(null);
  const pending = deferred<{ default: ComponentType<PropertiesProps> }>();
  const load = vi.fn(() => pending.promise);
  const module = new PropertyInspectorModule(load);
  const mounted = vi.fn();
  function Inspector() {
    useEffect(mounted, []);
    return <input aria-label="Retained inspector draft" defaultValue="Unchanged" />;
  }
  const view = render(<PropertiesFeature active={false} module={module} />);
  expect(load).not.toHaveBeenCalled();
  expect(screen.getByText('Select an object to inspect it.')).toBeInTheDocument();
  act(() => {
    selectedGraph();
  });
  // Explicitly closed mobile panels never import just because a diagram exists.
  expect(load).not.toHaveBeenCalled();
  view.rerender(<PropertiesFeature active module={module} />);
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  expect(screen.getByRole('status')).toHaveTextContent('Opening tools…');
  view.rerender(<PropertiesFeature active={false} module={module} />);
  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => {
    pending.resolve({ default: Inspector });
    await pending.promise;
  });
  const draft = await screen.findByLabelText('Retained inspector draft');
  fireEvent.change(draft, { target: { value: 'Still present when reopened' } });
  view.rerender(<PropertiesFeature active module={module} />);
  expect(screen.getByLabelText('Retained inspector draft')).toBe(draft);
  expect(draft).toHaveValue('Still present when reopened');
  expect(load).toHaveBeenCalledOnce();
  expect(mounted).toHaveBeenCalledOnce();
});

it('preserves the real metadata draft, focus and original graph across language switches and closing/reopening details', async () => {
  const graph = selectedGraph();
  const source = structuredClone(graph);
  const load = vi.fn(async () => ({ default: Properties }));
  const module = new PropertyInspectorModule(load);
  const controller = new AppLocaleController(
    new LocaleCatalogLoader(),
    { getItem: () => null, setItem: vi.fn() },
    undefined,
  );
  await controller.start();
  const view = render(
    <I18nProvider controller={controller}>
      <PropertiesFeature module={module} />
    </I18nProvider>,
  );
  try {
    const draft = await screen.findByLabelText('Custom metadata');
    draft.closest('details')!.setAttribute('open', '');
    draft.focus();
    fireEvent.change(draft, { target: { value: '{ unfinished: "<private>"' } });
    await act(async () => {
      await controller.selectLocale('sv');
    });
    const catalog = controller.getSnapshot().catalog!;
    expect(screen.getByLabelText(catalog['editor.properties.customMetadata'])).toBe(draft);
    expect(draft).toHaveValue('{ unfinished: "<private>"');
    expect(draft).toHaveFocus();
    view.rerender(
      <I18nProvider controller={controller}>
        <PropertiesFeature active={false} module={module} />
      </I18nProvider>,
    );
    view.rerender(
      <I18nProvider controller={controller}>
        <PropertiesFeature active module={module} />
      </I18nProvider>,
    );
    expect(screen.getByLabelText(catalog['editor.properties.customMetadata'])).toBe(draft);
    expect(draft).toHaveValue('{ unfinished: "<private>"');
    expect(load).toHaveBeenCalledOnce();
    expect(useEditor.getState().graph).toBe(graph);
    expect(graph).toEqual(source);
  } finally {
    view.unmount();
    controller.dispose();
  }
});

it('keeps editing available after a missing inspector chunk and never reloads before saves finish', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const graph = selectedGraph();
  const load = vi.fn(async (): Promise<{ default: ComponentType<PropertiesProps> }> => {
    throw new Error('Missing optional chunk');
  });
  const module = new PropertyInspectorModule(load);
  const saved = deferred<void>();
  const beforeReload = vi
    .fn()
    .mockRejectedValueOnce(new Error('Storage full <private>'))
    .mockImplementationOnce(() => saved.promise);
  const reload = vi.fn();
  render(
    <>
      <button>Edit diagram</button>
      <PropertiesFeature module={module} beforeReload={beforeReload} reload={reload} />
    </>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This tool could not load. Continue editing or reload after saving to try again.',
  );
  expect(screen.getByRole('button', { name: 'Edit diagram' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save and reload' }));
  await screen.findByText(/Storage full <private>/);
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save and reload' }));
  expect(screen.getByRole('button', { name: 'Saving before reload…' })).toBeDisabled();
  expect(reload).not.toHaveBeenCalled();
  await act(async () => {
    saved.resolve();
    await saved.promise;
  });
  expect(reload).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledOnce();
  expect(useEditor.getState().graph).toBe(graph);
});

it('never publishes a late inspector or reload into a replacement workspace after unmount', async () => {
  selectedGraph();
  const loaded = deferred<{ default: ComponentType<PropertiesProps> }>();
  const mounted = vi.fn();
  function OldInspector() {
    useEffect(mounted, []);
    return <p>Old private inspector</p>;
  }
  const module = new PropertyInspectorModule(() => loaded.promise);
  const old = render(<PropertiesFeature module={module} />);
  old.unmount();
  await act(async () => {
    loaded.resolve({ default: OldInspector });
    await loaded.promise;
  });
  expect(mounted).not.toHaveBeenCalled();

  vi.spyOn(console, 'error').mockImplementation(() => {});
  const save = deferred<void>();
  const reload = vi.fn();
  const failed = new PropertyInspectorModule(async () => {
    throw new Error('Missing old inspector');
  });
  const recovery = render(
    <PropertiesFeature module={failed} beforeReload={() => save.promise} reload={reload} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Save and reload' }));
  recovery.unmount();
  const next = selectedGraph();
  render(<p>Replacement workspace</p>);
  await act(async () => {
    save.resolve();
    await save.promise;
  });
  expect(reload).not.toHaveBeenCalled();
  expect(useEditor.getState().graph).toBe(next);
  expect(screen.queryByText('Old private inspector')).toBeNull();
  expect(screen.getByText('Replacement workspace')).toBeInTheDocument();
});
