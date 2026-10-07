import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase } from '../src/storage/database';
import { instantiate } from '../src/templates/templates';

const databases: WorkspaceDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

describe('built-in template metadata upgrades', () => {
  it('updates old example labels and adds guided setup while preserving graphs and custom templates', async () => {
    const database = new WorkspaceDatabase(`template-upgrade-${crypto.randomUUID()}`);
    databases.push(database);
    await database.open();
    const kiosk = instantiate('process-simulator', 'Original stored graph');
    kiosk.simulation!.particleTypes[0].revenue = 765;
    const custom = instantiate('mind-map', 'My custom template');
    await database.templates.bulkPut([
      { id: 'process-simulator', name: 'Process Simulator', builtin: true, graph: kiosk },
      { id: 'mind-map', name: 'My custom template', builtin: false, graph: custom },
    ]);
    await database.initialize();
    expect(await database.templates.get('process-simulator')).toEqual({
      id: 'process-simulator',
      name: 'Kiosk + package pickup',
      builtin: true,
      graph: kiosk,
    });
    expect(await database.templates.get('mind-map')).toEqual({
      id: 'mind-map',
      name: 'My custom template',
      builtin: false,
      graph: custom,
    });
    const blank = await database.templates.get('process-simulator-blank');
    expect(blank).toMatchObject({
      name: 'Process Simulator',
      builtin: true,
      graph: {
        diagram: { type: 'process-simulator' },
        simulation: { schemaVersion: 1, nodes: [], edges: [] },
      },
    });
    const records = await database.templates.toArray();
    await database.initialize();
    expect(await database.templates.toArray()).toEqual(records);
  });
});
