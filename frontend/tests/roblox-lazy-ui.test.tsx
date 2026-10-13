import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RobloxFeature, RobloxWorkbenchModule } from '../src/roblox/RobloxFeature';
import { createGameGraph } from '../src/roblox/document';
import { createRobloxStarterGame } from '../src/roblox/starter';
import { blankGraph } from '../src/model/types';
import { useEditor } from '../src/state/editor';

beforeEach(() => useEditor.getState().setGraph(null));
afterEach(() => {
  vi.restoreAllMocks();
  useEditor.getState().setGraph(null);
});
it('keeps the optional game workbench unloaded for ordinary diagrams and unopened game documents', () => {
  const load = vi.fn(async () => ({ default: () => <p>Loaded game tools</p> }));
  const module = new RobloxWorkbenchModule(load);
  useEditor.getState().setGraph(blankGraph('Ordinary', 'flowchart'));
  render(<RobloxFeature module={module} />);
  expect(load).not.toHaveBeenCalled();
  act(() => useEditor.getState().setGraph(createGameGraph('Game', createRobloxStarterGame())));
  expect(screen.getByRole('button', { name: 'World & rules' })).toBeVisible();
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'World & rules' }));
  expect(load).toHaveBeenCalledOnce();
});
it('recovers a missing game chunk without blanking the editor and waits for saving before reload', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const module = new RobloxWorkbenchModule(async () => {
    throw new Error('The requested game chunk is no longer available.');
  });
  let finish!: () => void;
  const beforeReload = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const reload = vi.fn();
  useEditor.getState().setGraph(createGameGraph('Game', createRobloxStarterGame()));
  render(<RobloxFeature module={module} beforeReload={beforeReload} reload={reload} />);
  fireEvent.click(screen.getByRole('button', { name: 'World & rules' }));
  await screen.findByRole('dialog', { name: 'Tool could not open' });
  expect(screen.getByRole('button', { name: 'World & rules' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save and reload' }));
  expect(beforeReload).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});
