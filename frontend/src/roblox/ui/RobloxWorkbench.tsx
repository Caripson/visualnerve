import { lazy, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { LazyDialogBoundary } from '../../components/LazyDialogBoundary';
import { settleWorkspaceBeforeReload } from '../../ui/settle-workspace-reload';
import { useEditor } from '../../state/editor';
import { setGameDefinition } from '../document';
import { createGameEntity } from '../starter';
import { expandGameDefinition } from '../expand';
import { validateGameDefinition } from '../validate';
import type { GameDefinition, GameEntityKind } from '../types';
import { EntityEditor } from './EntityEditor';
import { RulesEditor } from './RulesEditor';
import { ProgressEditor } from './ProgressEditor';
import { PrefabEditor } from './PrefabEditor';
import { BuildEditor } from './BuildEditor';
import { TestEditor } from './TestEditor';
import { RobloxPublisher } from './RobloxPublisher';
import { EmptyState, NumberField, objectNames, SelectField, TextField } from './fields';
import './roblox.css';

const WorldPreview = lazy(() =>
  import('./WorldPreview').then((module) => ({ default: module.WorldPreview })),
);
export type RobloxTab = 'world' | 'rules' | 'progress' | 'prefabs' | 'test' | 'build' | 'guide';
const tabs: readonly (readonly [RobloxTab, string])[] = [
  ['world', '1 · World'],
  ['rules', '2 · Rules'],
  ['progress', 'Progress'],
  ['prefabs', 'Prefabs'],
  ['test', 'Test rules'],
  ['build', '3 · Check & build'],
  ['guide', 'Getting started'],
];
export function RobloxWorkbench({
  initialTab = 'world',
  close,
}: {
  initialTab?: RobloxTab;
  close: () => void;
}) {
  const graph = useEditor((state) => state.graph);
  const selectedNodes = useEditor((state) => state.selectedNodes);
  const commandError = useEditor((state) => state.commandError);
  const [tab, setTab] = useState<RobloxTab>(initialTab);
  const [objectId, setObjectId] = useState('');
  const [kind, setKind] = useState<GameEntityKind>('platform');
  const [draft, setDraft] = useState<{ diagramId: string; base: string; game: GameDefinition }>();
  const [closingPending, setClosingPending] = useState(false);
  const savedGame = graph?.diagram.game;
  const activeDraft = draft?.diagramId === graph?.diagram.id ? draft : undefined;
  const game = activeDraft?.game ?? savedGame;
  const gameKey = JSON.stringify(game);
  const checked = useMemo(() => (game ? validateGameDefinition(game) : undefined), [gameKey]);
  const previewDefinition = activeDraft ? savedGame : game;
  const previewKey = JSON.stringify(previewDefinition);
  const expanded = useMemo(
    () => (previewDefinition ? expandGameDefinition(previewDefinition) : undefined),
    [previewKey],
  );
  if (!graph || !game) return null;
  const entityCard = graph.nodes.find((node) => selectedNodes.includes(node.id));
  const semantic = entityCard?.metadata.roblox as { kind?: string; id?: string } | undefined;
  const selectedId = objectId || (semantic?.kind === 'entities' ? semantic.id : undefined);
  const entity = game.entities.find((item) => item.id === selectedId) ?? game.entities[0];
  const commit = (next: GameDefinition, base: string) => {
    const diagramId = graph.diagram.id;
    try {
      useEditor.getState().command('Edit Roblox game', (current) => {
        if (current.diagram.id !== diagramId || JSON.stringify(current.diagram.game) !== base)
          throw new Error(
            'This game changed while you were editing. Discard the unfinished edits to review the latest version.',
          );
        return setGameDefinition(current, next);
      });
    } catch (failure) {
      useEditor.setState({ commandError: (failure as Error).message });
      return;
    }
    if (
      useEditor.getState().graph?.diagram.id === diagramId &&
      JSON.stringify(useEditor.getState().graph?.diagram.game) === JSON.stringify(next)
    ) {
      setDraft(undefined);
      useEditor.setState({ commandError: '' });
    }
  };
  const change = (next: GameDefinition) => {
    const base = activeDraft?.base ?? JSON.stringify(savedGame);
    setDraft({ diagramId: graph.diagram.id, base, game: next });
    if (validateGameDefinition(next).valid) commit(next, base);
  };
  const requestClose = () => {
    if (activeDraft) setClosingPending(true);
    else close();
  };
  const select = (id: string) => {
    if (id.includes('/')) {
      setTab('prefabs');
      return;
    }
    setObjectId(id);
    const node = graph.nodes.find(
      (item) => (item.metadata.roblox as { id?: string } | undefined)?.id === id,
    );
    if (node) useEditor.getState().select([node.id]);
  };
  return (
    <Modal
      title={`Roblox Game Builder · ${game.name}`}
      close={requestClose}
      wide
      className="roblox-modal"
    >
      <div className="roblox-workbench">
        <p className="roblox-intro">
          Build your world. Connect your ideas. Play it in Roblox Studio.
        </p>
        <nav className="roblox-tabs" aria-label="Game builder steps">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              disabled={!!activeDraft && (id === 'build' || id === 'test')}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {commandError && (
          <div className="notice error-notice" role="alert">
            <span>{commandError}</span>
            <button onClick={() => useEditor.setState({ commandError: '' })}>Dismiss</button>
          </div>
        )}
        {activeDraft && (
          <aside className="roblox-card roblox-draft-notice" role="status">
            <strong>These edits are not saved yet.</strong>
            <p>
              Finish the settings below. Valid changes save automatically. The world preview shows
              your last valid version.
            </p>
            {checked?.diagnostics
              .filter((item) => item.severity === 'error')
              .map((item, index) => (
                <p key={index}>
                  {item.message} <small>{item.path}</small>
                </p>
              ))}
            <div className="roblox-actions">
              <button
                disabled={!checked?.valid}
                onClick={() => commit(activeDraft.game, activeDraft.base)}
              >
                Save edits
              </button>
              <button
                onClick={() => {
                  setDraft(undefined);
                  setClosingPending(false);
                  useEditor.setState({ commandError: '' });
                }}
              >
                Discard unfinished edits
              </button>
            </div>
          </aside>
        )}
        {closingPending && activeDraft && (
          <aside className="roblox-card" role="alert">
            <strong>Keep your unfinished edits?</strong>
            <p>
              Some edits still need attention. You can keep editing or discard those edits and close
              the builder.
            </p>
            <div className="roblox-actions">
              <button className="primary" onClick={() => setClosingPending(false)}>
                Keep editing
              </button>
              <button
                onClick={() => {
                  setDraft(undefined);
                  close();
                }}
              >
                Discard edits and close
              </button>
            </div>
          </aside>
        )}
        {tab === 'world' && (
          <section aria-label="Create your game world">
            <div className="roblox-section-heading">
              <div>
                <h3>Your world</h3>
                <p className="roblox-hint">
                  Add anything from a simple platform to a whole adventure. Use position fields to
                  place objects exactly.
                </p>
              </div>
              <a href="/help/roblox-game-builder/#world">World help</a>
            </div>
            <LazyDialogBoundary
              close={() => {}}
              beforeReload={async () => {
                if (activeDraft)
                  throw new Error('Finish or discard the unfinished game edits before reloading.');
                await settleWorkspaceBeforeReload();
              }}
              loading={
                <p role="status">
                  Loading your world preview. The object list and position fields are available
                  below.
                </p>
              }
              failure={({ reload, saving, error }) => (
                <aside className="roblox-card">
                  <p role="alert">
                    The 3D preview could not load. You can still edit every object with the list and
                    position fields.
                  </p>
                  <button disabled={saving} onClick={reload}>
                    {saving ? 'Saving…' : 'Save and reload preview'}
                  </button>
                  {error && <p role="alert">{error}</p>}
                </aside>
              )}
            >
              <WorldPreview entities={expanded!.entities} selected={entity?.id} select={select} />
            </LazyDialogBoundary>
            <div className="roblox-actions">
              <SelectField
                label="Object to add"
                value={kind}
                options={objectNames}
                change={(next) => setKind(next as GameEntityKind)}
              />
              <button
                className="primary"
                onClick={() => {
                  const next = createGameEntity(kind, crypto.randomUUID());
                  change({ ...game, entities: [...game.entities, next] });
                  setObjectId(next.id);
                }}
              >
                Add object
              </button>
            </div>
            {!entity ? (
              <EmptyState>
                Add a player start and a platform to begin. Then add rules that make your world come
                alive.
              </EmptyState>
            ) : (
              <div className="roblox-editor-columns">
                <div className="roblox-roster" role="group" aria-label="World objects">
                  {game.entities.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={item.id === entity.id}
                      onClick={() => select(item.id)}
                    >
                      <span className="roblox-object-dot" style={{ backgroundColor: item.color }} />
                      <b>{item.name}</b>
                      <small>
                        {objectNames.find((option) => option[0] === item.kind)?.[1]} ·{' '}
                        {item.transform.position.x}, {item.transform.position.y},{' '}
                        {item.transform.position.z}
                      </small>
                    </button>
                  ))}
                </div>
                <EntityEditor
                  entity={entity}
                  change={(next) =>
                    change({
                      ...game,
                      entities: game.entities.map((item) => (item.id === next.id ? next : item)),
                    })
                  }
                  remove={() =>
                    change({
                      ...game,
                      entities: game.entities.filter((item) => item.id !== entity.id),
                    })
                  }
                  duplicate={() => {
                    const next = structuredClone(entity);
                    next.id = crypto.randomUUID();
                    next.name = `${entity.name} copy`;
                    next.transform.position.x += next.transform.size.x + 2;
                    change({ ...game, entities: [...game.entities, next] });
                    setObjectId(next.id);
                  }}
                />
              </div>
            )}
            <details className="roblox-card">
              <summary>Game name and player settings</summary>
              <TextField
                label="Game name"
                value={game.name}
                change={(name) => change({ ...game, name })}
              />
              <TextField
                label="Describe your game"
                value={game.description}
                multiline
                change={(description) => change({ ...game, description })}
              />
              <div className="roblox-field-grid">
                {(
                  [
                    ['maxPlayers', 'Maximum players', 1, 100],
                    ['gravity', 'Gravity', 0, 1000],
                    ['walkSpeed', 'Walking speed', 1, 100],
                    ['jumpPower', 'Jump power', 0, 200],
                    ['respawnSeconds', 'Respawn delay (seconds)', 0, 60],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <NumberField
                    key={key}
                    label={label}
                    value={game.settings[key]}
                    min={min}
                    max={max}
                    step={key === 'maxPlayers' ? 1 : 'any'}
                    change={(value) =>
                      change({ ...game, settings: { ...game.settings, [key]: value } })
                    }
                  />
                ))}
                <label className="roblox-field">
                  <span>Ambient light color</span>
                  <input
                    type="color"
                    value={game.settings.ambient}
                    onChange={(event) =>
                      change({
                        ...game,
                        settings: { ...game.settings, ambient: event.target.value },
                      })
                    }
                  />
                </label>
              </div>
              <p className="roblox-hint">
                One stud is Roblox’s world unit. Default walking speed is 16 studs per second.
                Maximum players is a design setting; check your experience’s player limit in
                Roblox’s settings too.
              </p>
            </details>
          </section>
        )}
        {tab === 'rules' && (
          <RulesEditor
            rules={game.rules}
            context={game}
            change={(rules) => change({ ...game, rules })}
          />
        )}
        {tab === 'progress' && <ProgressEditor game={game} change={change} />}
        {tab === 'prefabs' && <PrefabEditor game={game} change={change} />}
        {tab === 'test' && <TestEditor game={game} />}
        {tab === 'build' && (
          <BuildEditor
            game={game}
            navigate={setTab}
            publishing={(build) => <RobloxPublisher game={game} build={build} />}
          />
        )}
        {tab === 'guide' && (
          <section className="roblox-guide" aria-label="Getting started with Roblox">
            <h3>Your idea is the starting point</h3>
            <p>
              Try writing one sentence: “Players explore floating islands, collect keys, and open a
              secret door.” Build one small part first, then keep adding to it.
            </p>
            <ol>
              <li>
                <strong>Make the world.</strong> Add a player start above a platform. Add a
                checkpoint, a key, a door, and a goal. Name each object so you can find it again.
                <button onClick={() => setTab('world')}>Build my world</button>
              </li>
              <li>
                <strong>Make things happen.</strong> A rule reads like a sentence: when a player
                touches the key, give them one key. When they use the door, if they have three keys,
                turn its collision off.<button onClick={() => setTab('rules')}>Make a rule</button>
              </li>
              <li>
                <strong>Add depth.</strong> Variables count things. Quests give players goals.
                Timers create pressure. Prefabs let you reuse a whole room with different settings.
                <button onClick={() => setTab('progress')}>Add progress</button>
                <button onClick={() => setTab('prefabs')}>Reuse a creation</button>
              </li>
              <li>
                <strong>Check, test, share.</strong> Fix the messages in Check & build, download
                your .rbxlx file, and open it in Roblox Studio. Test with two players, then publish
                to your test game.<button onClick={() => setTab('build')}>Check & build</button>
              </li>
            </ol>
            <p>
              Your diagram is the map of your ideas. The world preview shows the actual object sizes
              and positions. Roblox Studio is where the game runs.
            </p>
            <p>
              Use Undo to try things freely. Your game plan, rules, and layout are saved with this
              diagram in your local workspace.
            </p>
            <a href="/help/roblox-game-builder/">Open the full guide</a>
          </section>
        )}
      </div>
    </Modal>
  );
}
