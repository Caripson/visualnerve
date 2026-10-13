import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RobloxWorkbench } from '../src/roblox/ui/RobloxWorkbench';
import { NewDiagram } from '../src/components/Dialogs';
import { createGameGraph, gameProjection, setGameDefinition } from '../src/roblox/document';
import {
  createGameEntity,
  createRobloxAdventureGame,
  createRobloxEmptyGame,
  createRobloxStarterGame,
} from '../src/roblox/starter';
import { useEditor } from '../src/state/editor';
import { createTemplateDiagram } from '../src/templates/create';
import { NumberField } from '../src/roblox/ui/fields';

vi.mock('../src/roblox/ui/WorldPreview', () => ({
  WorldPreview: () => <p>World geometry test view</p>,
}));
vi.mock('../src/templates/create', () => ({ createTemplateDiagram: vi.fn(async () => {}) }));

beforeEach(() => {
  useEditor.getState().setGraph(null);
  useEditor.setState({ status: 'saved', message: '', commandError: '' });
  vi.clearAllMocks();
});
function mount(
  tab: 'world' | 'rules' | 'progress' | 'prefabs' | 'test' | 'build' = 'world',
  game = createRobloxEmptyGame(),
) {
  const graph = createGameGraph('My Roblox game', game);
  useEditor.getState().setGraph(graph);
  const close = vi.fn();
  render(<RobloxWorkbench close={close} initialTab={tab} />);
  return { graph, close };
}
function conditionGame() {
  const game = createRobloxEmptyGame();
  game.quests = [{ id: 'adventure', name: 'Adventure', description: 'Find a key', target: 1 }];
  game.rules = [
    {
      id: 'check',
      name: 'A rule to edit',
      enabled: true,
      event: { kind: 'playerJoin' },
      actions: [{ kind: 'message', text: 'Hello' }],
      cooldown: 1,
      oncePerPlayer: false,
      condition: {
        kind: 'compare',
        operator: '>=',
        left: { kind: 'literal', value: 0 },
        right: { kind: 'literal', value: 1 },
      },
    },
  ];
  return game;
}

describe('Roblox game authoring', () => {
  it('keeps incomplete numeric text local, restores the previous number on blur, and accepts an external value', () => {
    const change = vi.fn();
    const { rerender } = render(<NumberField label="A world position" value={8} change={change} />);
    const input = screen.getByLabelText('A world position');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Finish this number');
    fireEvent.blur(input);
    expect(input).toHaveValue(8);
    expect(screen.getByRole('status')).toHaveTextContent('previous value was restored');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    rerender(<NumberField label="A world position" value={42} change={change} />);
    expect(input).toHaveValue(42);
    fireEvent.change(input, { target: { value: '-12.5' } });
    expect(change).toHaveBeenLastCalledWith(-12.5);
  });
  it('creates an arbitrary object, edits world units, preserves a concurrent diagram position, and supports Undo', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Object to add'), { target: { value: 'npc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
    const entity = useEditor.getState().graph!.diagram.game!.entities[0];
    expect(entity.kind).toBe('npc');
    const node = useEditor
      .getState()
      .graph!.nodes.find((item) => gameProjection(item)?.id === entity.id)!;
    act(() => useEditor.getState().updateNode(node.id, { x: 777, y: 333 }));
    fireEvent.change(screen.getByLabelText('Position (studs) X'), { target: { value: '42' } });
    expect(useEditor.getState().graph!.diagram.game!.entities[0].transform.position.x).toBe(42);
    expect(useEditor.getState().graph!.nodes.find((item) => item.id === node.id)).toMatchObject({
      x: 777,
      y: 333,
    });
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().graph!.diagram.game!.entities[0].transform.position.x).toBe(0);
    expect(useEditor.getState().graph!.nodes.find((item) => item.id === node.id)?.x).toBe(777);
  });

  it('keeps an intermediate text comparison draft visible, then saves the valid comparison atomically', () => {
    mount('rules', conditionGame());
    fireEvent.change(screen.getByLabelText('Condition left source'), {
      target: { value: 'questState' },
    });
    expect(screen.getByText('These edits are not saved yet.')).toBeVisible();
    expect(screen.getByRole('button', { name: '3 · Check & build' })).toBeDisabled();
    expect(useEditor.getState().graph!.diagram.game!.rules[0].condition).toMatchObject({
      left: { kind: 'literal', value: 0 },
    });
    fireEvent.change(screen.getByLabelText('Condition comparison'), { target: { value: '==' } });
    fireEvent.change(screen.getByLabelText('Condition right value type'), {
      target: { value: 'string' },
    });
    expect(screen.queryByText('These edits are not saved yet.')).not.toBeInTheDocument();
    expect(useEditor.getState().graph!.diagram.game!.rules[0].condition).toMatchObject({
      kind: 'compare',
      operator: '==',
      left: { kind: 'questState', questId: useEditor.getState().graph!.diagram.game!.quests[0].id },
      right: { kind: 'literal', value: '' },
    });
  });

  it('retains a concurrent API game update when a draft becomes valid and offers discard/review', () => {
    mount('rules', conditionGame());
    fireEvent.change(screen.getByLabelText('Condition left source'), {
      target: { value: 'questState' },
    });
    act(() =>
      useEditor.getState().command('API game edit', (current) =>
        setGameDefinition(current, {
          ...current.diagram.game!,
          description: 'Changed through API',
        }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Condition comparison'), { target: { value: '==' } });
    fireEvent.change(screen.getByLabelText('Condition right value type'), {
      target: { value: 'string' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('This game changed while you were editing');
    expect(useEditor.getState().graph!.diagram.game!.description).toBe('Changed through API');
    expect(useEditor.getState().graph!.diagram.game!.rules[0].condition).toMatchObject({
      left: { kind: 'literal', value: 0 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard unfinished edits' }));
    expect(screen.queryByText('These edits are not saved yet.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Condition left source')).toHaveValue('literal');
  });

  it('warns before closing an unfinished draft and lets the creator keep editing', () => {
    const { close } = mount('rules', conditionGame());
    fireEvent.change(screen.getByLabelText('Condition left source'), {
      target: { value: 'questState' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Keep your unfinished edits?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Keep your unfinished edits?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits and close' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('lets users construct inventory rewards and nested conditions through ordinary controls', () => {
    const game = createRobloxEmptyGame();
    game.entities = [createGameEntity('spawn', 'start')];
    mount('progress', game);
    fireEvent.click(screen.getByText('Inventory · keys, gems, tools'));
    fireEvent.click(screen.getByRole('button', { name: 'Add inventory item' }));
    const item = useEditor.getState().graph!.diagram.game!.items[0];
    fireEvent.click(screen.getByRole('button', { name: '2 · Rules' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    fireEvent.change(screen.getByLabelText('Rule starts when'), { target: { value: 'touch' } });
    fireEvent.change(screen.getByLabelText('Action 1 does'), { target: { value: 'giveItem' } });
    fireEvent.change(screen.getByLabelText('Action 1 amount value'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Use a condition'));
    fireEvent.change(screen.getByLabelText('Condition type'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Condition 1 left source'), {
      target: { value: 'inventory' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(useEditor.getState().graph!.diagram.game!.rules[0]).toMatchObject({
      event: { kind: 'touch', entityId: useEditor.getState().graph!.diagram.game!.entities[0].id },
      actions: [{ kind: 'giveItem', itemId: item.id, amount: { kind: 'literal', value: 2 } }],
      condition: {
        kind: 'all',
        conditions: [{ left: { kind: 'inventory', itemId: item.id } }, { kind: 'compare' }],
      },
    });
  });

  it('runs independent test-player rewards and resets all preview state', () => {
    mount('test', createRobloxStarterGame());
    fireEvent.change(screen.getByLabelText('Test object'), {
      target: {
        value: useEditor
          .getState()
          .graph!.diagram.game!.entities.find((item) => item.kind === 'collectible')!.id,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Trigger event' }));
    expect(
      within(screen.getByRole('article', { name: 'Player1 results' })).getByText('10'),
    ).toBeVisible();
    act(() => {
      const current = useEditor.getState().graph!;
      useEditor.getState().setGraph(structuredClone(current));
    });
    expect(
      within(screen.getByRole('article', { name: 'Player1 results' })).getByText('10'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add test player' }));
    expect(
      within(screen.getByRole('article', { name: 'Player2 results' })).getByText('0'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Trigger event' }));
    expect(
      within(screen.getByRole('article', { name: 'Player2 results' })).getByText('10'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Restart rule test' }));
    expect(screen.queryByRole('article', { name: 'Player2 results' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Player1 results' })).getByText('0'),
    ).toBeVisible();
  });

  it('edits parameterized prefab copies while preserving reusable definitions', () => {
    mount('prefabs', createRobloxAdventureGame());
    fireEvent.change(screen.getByLabelText('River crystal Score reward'), {
      target: { value: '75' },
    });
    const game = useEditor.getState().graph!.diagram.game!;
    expect(
      game.instances.find((item) => item.name === 'River crystal')!.parameters![
        game.prefabs[0].parameters!.find((item) => item.name === 'Score reward')!.id
      ],
    ).toBe(75);
    expect(game.prefabs[0].parameters!.find((item) => item.name === 'Score reward')!.default).toBe(
      10,
    );
  });

  it('creates the selected advanced starter through the canonical template', async () => {
    const close = vi.fn();
    const { container } = render(<NewDiagram close={close} />);
    fireEvent.change(screen.getByLabelText('Template collection'), { target: { value: 'roblox' } });
    fireEvent.click(screen.getByRole('button', { name: /Roblox Game Builder/ }));
    fireEvent.click(screen.getByRole('radio', { name: /A bigger adventure/ }));
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(createTemplateDiagram).toHaveBeenLastCalledWith(
      'roblox-game-builder',
      'Untitled diagram',
      'adventure',
    );
  });
});
