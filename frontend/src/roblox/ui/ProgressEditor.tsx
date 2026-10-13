import type { GameDefinition } from '../types';
import { ValueEditor } from './ExpressionEditor';
import { EmptyState, NumberField, SelectField, TextField, Toggle } from './fields';

export function ProgressEditor({
  game,
  change,
}: {
  game: GameDefinition;
  change: (game: GameDefinition) => void;
}) {
  return (
    <section aria-label="Player progress">
      <h3>Give your game something to remember</h3>
      <p className="roblox-hint">
        Add a counter, inventory item, quest, or timer here. Then use it in your rules. Player
        progress lasts for the current server session; this builder does not save progress between
        visits.
      </p>
      <details open className="roblox-card">
        <summary>Variables · score, energy, team state</summary>
        <p className="roblox-hint">
          A player variable belongs to one player. A shared variable belongs to everyone in this
          server.
        </p>
        <button
          onClick={() =>
            change({
              ...game,
              variables: [
                ...game.variables,
                {
                  id: crypto.randomUUID(),
                  name: `Score ${game.variables.length + 1}`,
                  scope: 'player',
                  initial: 0,
                },
              ],
            })
          }
        >
          Add variable
        </button>
        {!game.variables.length && (
          <EmptyState>Use a variable to count coins or remember whether a switch is on.</EmptyState>
        )}
        {game.variables.map((variable) => {
          const patch = (value: Partial<typeof variable>) =>
            change({
              ...game,
              variables: game.variables.map((item) =>
                item.id === variable.id ? { ...item, ...value } : item,
              ),
            });
          return (
            <article className="roblox-collection-row" key={variable.id}>
              <div className="roblox-field-grid">
                <TextField
                  label="Variable name"
                  value={variable.name}
                  change={(name) => patch({ name })}
                />
                <SelectField
                  label={`${variable.name} belongs to`}
                  value={variable.scope}
                  options={[
                    ['player', 'Each player'],
                    ['shared', 'Everyone in this server'],
                  ]}
                  change={(scope) => patch({ scope: scope as 'player' | 'shared' })}
                />
              </div>
              <ValueEditor
                label={`${variable.name} starts at`}
                value={variable.initial}
                change={(initial) => {
                  const next = { ...variable, initial };
                  if (typeof initial !== 'number') {
                    delete next.min;
                    delete next.max;
                  }
                  change({
                    ...game,
                    variables: game.variables.map((item) =>
                      item.id === variable.id ? next : item,
                    ),
                  });
                }}
              />
              {typeof variable.initial === 'number' && (
                <>
                  <Toggle
                    label={`${variable.name} has limits`}
                    value={variable.min !== undefined || variable.max !== undefined}
                    change={(enabled) => {
                      const next = { ...variable };
                      if (enabled) {
                        next.min = 0;
                        next.max = 100;
                      } else {
                        delete next.min;
                        delete next.max;
                      }
                      change({
                        ...game,
                        variables: game.variables.map((item) =>
                          item.id === variable.id ? next : item,
                        ),
                      });
                    }}
                  />
                  {(variable.min !== undefined || variable.max !== undefined) && (
                    <div className="roblox-field-grid">
                      <NumberField
                        label={`${variable.name} minimum`}
                        value={variable.min ?? 0}
                        change={(min) => patch({ min })}
                      />
                      <NumberField
                        label={`${variable.name} maximum`}
                        value={variable.max ?? 100}
                        change={(max) => patch({ max })}
                      />
                    </div>
                  )}
                </>
              )}
              <button
                onClick={() =>
                  change({
                    ...game,
                    variables: game.variables.filter((item) => item.id !== variable.id),
                  })
                }
              >
                Delete variable {variable.name}
              </button>
            </article>
          );
        })}
      </details>
      <details className="roblox-card">
        <summary>Inventory · keys, gems, tools</summary>
        <p className="roblox-hint">
          An inventory item is a count in the player’s backpack. It does not automatically create a
          visible tool.
        </p>
        <button
          onClick={() =>
            change({
              ...game,
              items: [
                ...game.items,
                { id: crypto.randomUUID(), name: `Key ${game.items.length + 1}`, maxStack: 99 },
              ],
            })
          }
        >
          Add inventory item
        </button>
        {game.items.map((item) => (
          <article className="roblox-collection-row" key={item.id}>
            <div className="roblox-field-grid">
              <TextField
                label="Item name"
                value={item.name}
                change={(name) =>
                  change({
                    ...game,
                    items: game.items.map((value) =>
                      value.id === item.id ? { ...value, name } : value,
                    ),
                  })
                }
              />
              <NumberField
                label={`${item.name} maximum count`}
                min={1}
                step={1}
                value={item.maxStack}
                change={(maxStack) =>
                  change({
                    ...game,
                    items: game.items.map((value) =>
                      value.id === item.id ? { ...value, maxStack } : value,
                    ),
                  })
                }
              />
            </div>
            <button
              onClick={() =>
                change({ ...game, items: game.items.filter((value) => value.id !== item.id) })
              }
            >
              Delete item {item.name}
            </button>
          </article>
        ))}
      </details>
      <details className="roblox-card">
        <summary>Quests · goals players work toward</summary>
        <button
          onClick={() =>
            change({
              ...game,
              quests: [
                ...game.quests,
                {
                  id: crypto.randomUUID(),
                  name: `Adventure ${game.quests.length + 1}`,
                  description: 'Collect the keys to unlock the next area.',
                  target: 3,
                },
              ],
            })
          }
        >
          Add quest
        </button>
        {game.quests.map((quest) => {
          const patch = (value: Partial<typeof quest>) =>
            change({
              ...game,
              quests: game.quests.map((item) =>
                item.id === quest.id ? { ...item, ...value } : item,
              ),
            });
          return (
            <article className="roblox-collection-row" key={quest.id}>
              <TextField label="Quest name" value={quest.name} change={(name) => patch({ name })} />
              <TextField
                label={`${quest.name} instructions`}
                multiline
                value={quest.description}
                change={(description) => patch({ description })}
              />
              <NumberField
                label={`${quest.name} target`}
                value={quest.target}
                min={1}
                step={1}
                change={(target) => patch({ target })}
              />
              <p className="roblox-hint">
                Rules start the quest, add progress, and complete it. Choose when the reward
                happens.
              </p>
              <button
                onClick={() =>
                  change({ ...game, quests: game.quests.filter((item) => item.id !== quest.id) })
                }
              >
                Delete quest {quest.name}
              </button>
            </article>
          );
        })}
      </details>
      <details className="roblox-card">
        <summary>Timers & rounds · countdowns and challenges</summary>
        <p className="roblox-hint">
          Rules start and stop timers. A timer finishing can trigger another rule. “Start round” and
          “End round” fire round events; you decide the rules for your round.
        </p>
        <button
          onClick={() =>
            change({
              ...game,
              timers: [
                ...game.timers,
                {
                  id: crypto.randomUUID(),
                  name: `Countdown ${game.timers.length + 1}`,
                  scope: 'player',
                  duration: 30,
                  repeat: false,
                },
              ],
            })
          }
        >
          Add timer
        </button>
        {game.timers.map((timer) => {
          const patch = (value: Partial<typeof timer>) =>
            change({
              ...game,
              timers: game.timers.map((item) =>
                item.id === timer.id ? { ...item, ...value } : item,
              ),
            });
          return (
            <article className="roblox-collection-row" key={timer.id}>
              <div className="roblox-field-grid">
                <TextField
                  label="Timer name"
                  value={timer.name}
                  change={(name) => patch({ name })}
                />
                <SelectField
                  label={`${timer.name} belongs to`}
                  value={timer.scope}
                  options={[
                    ['player', 'Each player'],
                    ['shared', 'Everyone in this server'],
                  ]}
                  change={(scope) => patch({ scope: scope as 'player' | 'shared' })}
                />
                <NumberField
                  label={`${timer.name} seconds`}
                  value={timer.duration}
                  min={0.1}
                  change={(duration) => patch({ duration })}
                />
                <Toggle
                  label={`${timer.name} repeats`}
                  value={timer.repeat}
                  change={(repeat) => patch({ repeat })}
                />
              </div>
              <button
                onClick={() =>
                  change({ ...game, timers: game.timers.filter((item) => item.id !== timer.id) })
                }
              >
                Delete timer {timer.name}
              </button>
            </article>
          );
        })}
      </details>
      <p className="roblox-hint">
        If something is used in a rule, update that rule before deleting it. Check & build tells you
        exactly where it is used.
      </p>
    </section>
  );
}
