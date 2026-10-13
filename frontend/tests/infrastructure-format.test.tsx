import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatInfrastructureQuantity } from '../src/simulation/infrastructure/format';
import { InfrastructureMetricsPanel } from '../src/simulation/infrastructure/InfrastructureMetricsPanel';
import { InfrastructureComparisonPanel } from '../src/simulation/infrastructure/InfrastructureComparisonPanel';
import { compareInfrastructure } from '../src/simulation/infrastructure/comparison';
import { EnergyPowerCapacityExample } from '../src/simulation/infrastructure/examples';
import { SimulationEngine } from '../src/simulation/engine';

describe('small infrastructure quantities', () => {
  it('preserves meaningful digits and prints zero only for actual zero', () => {
    expect(formatInfrastructureQuantity(0, 'en-US')).toBe('0');
    expect(formatInfrastructureQuantity(0.0002, 'en-US')).toBe('0.0002');
    expect(formatInfrastructureQuantity(0.0003, 'en-US')).toBe('0.0003');
    expect(formatInfrastructureQuantity(-0.0002, 'en-US')).toBe('-0.0002');
    expect(formatInfrastructureQuantity(2e-9, 'en-US')).toBe('2E-9');
    expect(formatInfrastructureQuantity(Number.MIN_VALUE, 'en-US')).not.toBe('0');
    expect(formatInfrastructureQuantity(1234.5678, 'en-US')).toBe('1,234.568');
  });
  it('shows tiny delivered energy/grid cost and uses percent versus percentage-point changes', () => {
    const engine = new SimulationEngine(new EnergyPowerCapacityExample().model());
    engine.advance(1);
    const state = engine.state();
    state.infrastructure!.energy.power.deliveredKWh = 0.0002;
    state.infrastructure!.energy.power.gridCost = 0.0003;
    state.infrastructure!.energy.power.stateOfCharge = 0.5;
    const other = structuredClone(state.infrastructure!);
    other.energy.power.deliveredKWh = 0.0004;
    other.energy.power.gridCost = 0.0006;
    other.energy.power.stateOfCharge = 0.4;
    const comparison = compareInfrastructure(state.infrastructure, other)!;
    render(
      <>
        <InfrastructureMetricsPanel state={state} currency="SEK" />
        <InfrastructureComparisonPanel comparison={comparison} currency="SEK" />
      </>,
    );
    const region = screen.getByRole('region', { name: 'Infrastructure capacity metrics' });
    expect(
      region.querySelector('[data-infrastructure-metric="power:Delivered"]'),
    ).toHaveTextContent('0.0002 kWh');
    expect(
      region.querySelector('[data-infrastructure-metric="power:Grid cost"]'),
    ).toHaveTextContent('0.0003 SEK');
    const row = screen.getByRole('row', {
      name: 'State of charge 50 % 40 % -10 percentage points',
    });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['50 %', '40 %', '-10 percentage points']);
    expect(
      screen.getByRole('row', { name: 'Delivered 0.0002 kWh 0.0004 kWh 0.0002 kWh' }),
    ).toBeInTheDocument();
    expect(state.infrastructure!.energy.power.deliveredKWh).toBe(0.0002);
  });
});
