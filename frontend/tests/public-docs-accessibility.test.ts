import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/dom';

const read = (path: string) => readFileSync(resolve('../hugo', path), 'utf8');
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function searchSurface() {
  const template = read('layouts/partials/help-page.html');
  const form = template.match(/<form class="help-search-form"[\s\S]*?<\/form>/)![0];
  const results = template.match(/<section id="help-search-results"[\s\S]*?<\/section>/)![0];
  document.body.innerHTML = form + results;
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      guides: [
        { title: 'Code', summary: 'Code import', text: 'Visualize code', url: '/help/code/' },
        {
          title: 'Sharing code',
          summary: 'Export code',
          text: 'Share code diagrams',
          url: '/help/sharing/',
        },
      ],
    }),
  });
  runInNewContext(read('static/help/help.js'), { document, fetch, setTimeout, clearTimeout });
  return { input: screen.getByRole('combobox', { name: 'Search help' }), fetch };
}

describe('public help and API accessibility', () => {
  it('names the search popup grid and navigates its real links with one roving tab stop', async () => {
    const { input } = searchSurface();
    expect(input).toHaveAttribute('aria-haspopup', 'grid');
    expect(input).toHaveAttribute('aria-controls', 'help-search-grid');
    fireEvent.input(input, { target: { value: 'code' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Code' })).toHaveFocus());
    const grid = screen.getByRole('grid', { name: 'Matching help guides' });
    expect(grid.querySelectorAll('[role="row"]')).toHaveLength(2);
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(2);
    const first = screen.getByRole('link', { name: 'Code' });
    const last = screen.getByRole('link', { name: 'Sharing code' });
    expect(last).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(last).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(last, { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sharing code' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('link', { name: 'Sharing code' }), { key: 'Escape' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('does not move keyboard focus into stale results when the query changes during loading', async () => {
    const { input, fetch } = searchSurface();
    let complete!: (value: unknown) => void;
    fetch.mockReturnValue(new Promise((resolve) => (complete = resolve)));
    input.focus();
    fireEvent.input(input, { target: { value: 'code' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.input(input, { target: { value: '' } });
    complete({ ok: true, json: async () => ({ guides: [] }) });
    await waitFor(() => expect(input).toHaveFocus());
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
  });

  it('names vendor-rendered API server selectors after Swagger finishes loading', async () => {
    document.body.innerHTML =
      '<p id="api-load-status"></p><span id="api-version" hidden></span>' +
      '<div id="swagger-ui" class="swagger-ui"><div class="servers"><select id="servers"><option>Local bridge</option></select></div></div>';
    const SwaggerUIBundle = vi.fn((options: { onComplete(): void }) => options.onComplete());
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ info: { version: '1' }, paths: {} }),
    });
    runInNewContext(read('static/api/docs/docs.js'), {
      document,
      fetch,
      SwaggerUIBundle,
      location: { hostname: 'visualnerve.caripson.com' },
      window,
      MutationObserver,
      setTimeout,
      clearTimeout,
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'API server' })).toBeVisible());
    expect(SwaggerUIBundle).toHaveBeenCalledOnce();
  });

  it('labels a server selector committed after onComplete and disconnects its scoped observer', async () => {
    document.body.innerHTML =
      '<p id="api-load-status"></p><span id="api-version" hidden></span>' +
      '<div id="swagger-ui"></div>';
    const disconnected = vi.fn();
    class TrackedObserver extends MutationObserver {
      disconnect() {
        disconnected();
        super.disconnect();
      }
    }
    const SwaggerUIBundle = vi.fn((options: { onComplete(): void }) => options.onComplete());
    runInNewContext(read('static/api/docs/docs.js'), {
      document,
      window,
      MutationObserver: TrackedObserver,
      setTimeout,
      clearTimeout,
      fetch: async () => ({ ok: true, json: async () => ({ info: { version: '1' }, paths: {} }) }),
      SwaggerUIBundle,
      location: { hostname: 'visualnerve.caripson.com' },
    });
    await waitFor(() => expect(SwaggerUIBundle).toHaveBeenCalledOnce());
    expect(disconnected).not.toHaveBeenCalled();
    document.getElementById('swagger-ui')!.innerHTML =
      '<div class="swagger-ui"><label for="servers"><select id="servers"><option>Local bridge</option></select></label></div>';
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'API server' })).toBeVisible());
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it('replaces empty wrapping labels without overwriting meaningful server control names', async () => {
    document.body.innerHTML =
      '<p id="api-load-status"></p><span id="api-version" hidden></span>' +
      '<div id="swagger-ui" class="servers">' +
      '<label for="servers"><select id="servers"><option>https://bridge.example/api/v1</option></select></label>' +
      '<label for="named-server">Preferred API server<select id="named-server"><option>Local bridge</option></select></label>' +
      '<select aria-label="Authorized API server"><option>Local bridge</option></select>' +
      '</div>';
    const emptyLabelSelect = document.getElementById('servers') as HTMLSelectElement;
    expect(emptyLabelSelect.labels).toHaveLength(1);
    const SwaggerUIBundle = vi.fn((options: { onComplete(): void }) => options.onComplete());
    runInNewContext(read('static/api/docs/docs.js'), {
      document,
      window,
      MutationObserver,
      setTimeout,
      clearTimeout,
      fetch: async () => ({ ok: true, json: async () => ({ info: { version: '1' }, paths: {} }) }),
      SwaggerUIBundle,
      location: { hostname: 'visualnerve.caripson.com' },
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'API server' })).toBeVisible());
    expect(screen.getByRole('combobox', { name: 'Preferred API server' })).not.toHaveAttribute(
      'aria-label',
    );
    expect(screen.getByRole('combobox', { name: 'Authorized API server' })).toHaveAttribute(
      'aria-label',
      'Authorized API server',
    );
  });

  it('keeps every shared code token and HTTP method badge above normal-text contrast in both appearances', () => {
    const syntax = read('static/site/syntax.css');
    const palettes = [...syntax.matchAll(/:root(?:\[data-theme="dark"\])?\s*\{([^}]+)\}/g)];
    expect(palettes).toHaveLength(2);
    for (const [, block] of palettes) {
      const colors = Object.fromEntries(
        [...block.matchAll(/--code-([\w-]+):\s*(#[\da-f]{6});/g)].map((match) => [
          match[1],
          match[2],
        ]),
      );
      for (const [name, color] of Object.entries(colors))
        if (name !== 'surface') expect(contrast(color, colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
    const docs = read('static/api/docs/docs.css');
    const methods = [...docs.matchAll(/--api-method-bg:\s*(#[\da-f]{6});/g)];
    expect(methods.length).toBeGreaterThanOrEqual(7);
    for (const [, background] of methods)
      expect(contrast('#ffffff', background)).toBeGreaterThanOrEqual(4.5);
    expect(read('hugo.toml')).toContain('noClasses = false');
    expect(read('layouts/partials/site-head.html')).toContain('/site/syntax.css');
    expect(read('layouts/partials/help-page.html')).toContain('/site/syntax.css');
  });
});

function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[\da-f]{2}/gi)!.map((value) => {
      const srgb = parseInt(value, 16) / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
