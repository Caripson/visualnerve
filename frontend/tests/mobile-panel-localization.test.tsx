import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileWorkspacePanel } from '../src/components/mobile/MobileWorkspacePanel';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this.closest('[hidden]') ? [] : [new DOMRect(0, 0, 80, 30)]) as unknown as DOMRectList;
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the same focused control and panel draft across translated labels and uses the latest close callback', async () => {
  const firstClose = vi.fn(),
    nextClose = vi.fn();
  const view = (label: string, dismiss: string, close: () => void) => (
    <>
      <button data-mobile-panel-trigger="projects">Projekt</button>
      <MobileWorkspacePanel
        panelKind="projects"
        className="test-panel"
        label={label}
        compact
        active
        close={close}
      >
        <button data-mobile-panel-dismiss="projects" aria-label={dismiss}>
          ×
        </button>
        <input aria-label="Private title" defaultValue="My own untranslated title" />
      </MobileWorkspacePanel>
    </>
  );
  const mounted = render(view('Projekt', 'Stäng projekt', firstClose));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stäng projekt' })).toHaveFocus());
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Unfinished private draft' } });
  input.focus();
  mounted.rerender(view('Projekte', 'Projekte schließen', nextClose));
  await act(async () => undefined);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Unfinished private draft');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(firstClose).not.toHaveBeenCalled();
  expect(nextClose).toHaveBeenCalledOnce();
});

it('returns focus to the visible enabled trigger for the semantic panel kind without parsing an accessible label', async () => {
  const mounted = render(
    <>
      <button data-mobile-panel-trigger="projects">Projets</button>
      <button data-mobile-panel-trigger="details" disabled>
        Détails indisponibles
      </button>
      <button data-mobile-panel-trigger="details" hidden>
        Détails masqués
      </button>
      <button data-mobile-panel-trigger="details">Détails</button>
      <MobileWorkspacePanel
        panelKind="details"
        className="test-panel"
        label="Ominaisuudet"
        compact
        active
        close={() => {}}
      >
        <button data-mobile-panel-dismiss="details" aria-label="Sulje ominaisuudet">
          ×
        </button>
        <input aria-label="Field" />
      </MobileWorkspacePanel>
    </>,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Sulje ominaisuudet' })).toHaveFocus(),
  );
  mounted.rerender(
    <>
      <button data-mobile-panel-trigger="projects">Projets</button>
      <button data-mobile-panel-trigger="details" disabled>
        Détails indisponibles
      </button>
      <button data-mobile-panel-trigger="details" hidden>
        Détails masqués
      </button>
      <button data-mobile-panel-trigger="details">Détails</button>
      <MobileWorkspacePanel
        panelKind="details"
        className="test-panel"
        label="Détails"
        compact
        active={false}
        close={() => {}}
      >
        <button data-mobile-panel-dismiss="details">×</button>
      </MobileWorkspacePanel>
    </>,
  );
  expect(screen.getByRole('button', { name: 'Détails' })).toHaveFocus();
});

it('keeps keyboard focus contained while the panel uses non-English names', async () => {
  render(
    <MobileWorkspacePanel
      panelKind="projects"
      className="test-panel"
      label="Projektit"
      compact
      active
      close={() => {}}
    >
      <button data-mobile-panel-dismiss="projects" aria-label="Sulje projektit">
        ×
      </button>
      <input aria-label="Hakuehto" />
    </MobileWorkspacePanel>,
  );
  const first = screen.getByRole('button'),
    last = screen.getByRole('textbox');
  await waitFor(() => expect(first).toHaveFocus());
  last.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
});
