import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SimulationDesktopPanel } from '../src/simulation/SimulationDesktopPanel';
import { SimulationActions } from '../src/simulation/SimulationControls';

describe('simulation desktop disclosure', () => {
  it('keeps settings and open replay controls mounted while hiding them from keyboard navigation', () => {
    function Panel() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <SimulationDesktopPanel
          collapsed={collapsed}
          toggle={() => setCollapsed((value) => !value)}
          playback={<button>Playback fixture</button>}
          seconds={3723}
          status="running"
          metricsToggle={<button>Metrics fixture</button>}
          runSettings={<input aria-label="Settings fixture" defaultValue="42" />}
          notices={<p role="alert">Current run error fixture</p>}
        >
          <details>
            <summary>Replay fixture</summary>
            <input aria-label="Replay position fixture" defaultValue="0" />
          </details>
        </SimulationDesktopPanel>
      );
    }
    render(<Panel />);
    const collapse = screen.getByRole('button', { name: 'Collapse simulation panel' });
    expect(collapse.tagName).toBe('BUTTON');
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    const body = document.getElementById(collapse.getAttribute('aria-controls')!)!;
    const settings = screen.getByLabelText('Settings fixture');
    const replay = screen.getByText('Replay fixture').parentElement as HTMLDetailsElement;
    fireEvent.change(settings, { target: { value: '12345' } });
    replay.open = true;
    fireEvent.change(screen.getByLabelText('Replay position fixture'), {
      target: { value: '126' },
    });
    fireEvent.click(collapse);
    const expand = screen.getByRole('button', { name: 'Expand simulation panel' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(body).toHaveAttribute('hidden');
    expect(settings).not.toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Settings fixture' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Metrics fixture' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Playback fixture' })).toBeVisible();
    expect(screen.getByLabelText('Simulated time')).toHaveTextContent('1h 2m 3s');
    expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.click(expand);
    expect(body).not.toHaveAttribute('hidden');
    expect(screen.getByLabelText('Settings fixture')).toBe(settings);
    expect(settings).toHaveValue('12345');
    expect(replay.open).toBe(true);
    expect(screen.getByLabelText('Replay position fixture')).toHaveValue('126');
  });

  it('retains all four accessible playback actions in the condensed desktop strip', () => {
    const actions = {
      busy: false,
      active: true,
      paused: false,
      canResume: false,
      hasRun: true,
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      reset: vi.fn(),
    };
    const view = render(<SimulationActions {...actions} condensed />);
    for (const [name, handler] of [
      ['Rerun simulation', actions.play],
      ['Pause simulation', actions.pause],
      ['Stop simulation', actions.stop],
      ['Reset simulation', actions.reset],
    ] as const) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(handler).toHaveBeenCalledOnce();
    }
    view.rerender(<SimulationActions {...actions} busy condensed />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    view.rerender(<SimulationActions {...actions} compact />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Stop simulation' })).toBeNull();
  });
});
