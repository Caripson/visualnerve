import { afterEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStarterDemo } from '../src/templates/useStarterDemo';
import { createTemplateDiagram } from '../src/templates/create';

vi.mock('../src/templates/create', () => ({ createTemplateDiagram: vi.fn(async () => {}) }));

afterEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, '', '/');
});

it.each([
  ['api-compute-capacity', 'API & Compute Capacity'],
  ['network-multi-site-capacity', 'Network & Multi-Site Capacity'],
  ['energy-power-capacity', 'Energy & Power Capacity'],
  ['datacenter-capacity', 'Datacenter Capacity'],
])(
  'opens the allowlisted %s only after consent/unlock readiness and consumes its URL once',
  async (key, name) => {
    history.replaceState(null, '', `/?demo=${key}&source=home#capacity`);
    const hook = renderHook(({ ready, consent }) => useStarterDemo(ready, consent), {
      initialProps: { ready: false, consent: false },
    });
    expect(createTemplateDiagram).not.toHaveBeenCalled();
    hook.rerender({ ready: true, consent: false });
    expect(createTemplateDiagram).not.toHaveBeenCalled();
    hook.rerender({ ready: true, consent: true });
    await waitFor(() => expect(location.search).toBe('?source=home'));
    expect(createTemplateDiagram).toHaveBeenCalledExactlyOnceWith(key, name);
    expect(location.hash).toBe('#capacity');
    hook.rerender({ ready: true, consent: true });
    hook.unmount();
    renderHook(() => useStarterDemo(true, true));
    expect(createTemplateDiagram).toHaveBeenCalledTimes(1);
  },
);

it.each(['unknown', '__proto__', 'constructor', 'private-template'])(
  'ignores unsupported demo identifier %s',
  async (key) => {
    history.replaceState(null, '', `/?demo=${encodeURIComponent(key)}`);
    renderHook(() => useStarterDemo(true, true));
    expect(createTemplateDiagram).not.toHaveBeenCalled();
    expect(new URL(location.href).searchParams.get('demo')).toBe(key);
  },
);

it.each([
  ['kiosk', 'process-simulator', 'Kiosk package pickup'],
  ['time-series-analysis', 'time-series-analysis', 'Growth & Churn'],
])('preserves the existing %s example link', async (demo, template, name) => {
  history.replaceState(null, '', `/?demo=${demo}`);
  renderHook(() => useStarterDemo(true, true));
  await waitFor(() => expect(location.search).toBe(''));
  expect(createTemplateDiagram).toHaveBeenCalledExactlyOnceWith(template, name);
});
