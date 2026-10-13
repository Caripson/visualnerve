import { useEffect, useMemo, useState } from 'react';
import { RobloxSimulator, type SimulatorSnapshot } from '../simulator';
import type { GameDefinition, GameEvent } from '../types';
import { NumberField, SelectField } from './fields';

export function TestEditor({ game }: { game: GameDefinition }) {
  const [generation, setGeneration] = useState(0);
  const source = JSON.stringify(game);
  const simulator = useMemo(() => new RobloxSimulator(game), [source, generation]);
  const [snapshot, setSnapshot] = useState<SimulatorSnapshot>(() => simulator.join('Player1'));
  const [playerId, setPlayerId] = useState('Player1');
  const [kind, setKind] = useState<'touch' | 'interact' | 'roundStart' | 'roundEnd'>('touch');
  const [entityId, setEntityId] = useState(simulator.game.entities[0]?.id ?? '');
  const [seconds, setSeconds] = useState(5);
  useEffect(() => {
    setSnapshot(simulator.join('Player1'));
    setPlayerId('Player1');
    setEntityId(simulator.game.entities[0]?.id ?? '');
  }, [simulator]);
  const player = snapshot.players.find((item) => item.id === playerId) ?? snapshot.players[0];
  const selectedEntity =
    simulator.game.entities.find((item) => item.id === entityId) ?? simulator.game.entities[0];
  const trigger = () => {
    const event: GameEvent =
      kind === 'touch' || kind === 'interact'
        ? { kind, entityId: selectedEntity?.id ?? '' }
        : { kind };
    setSnapshot(simulator.trigger(event, player?.id));
  };
  const entityName = (id: string) =>
    simulator.game.entities.find((item) => item.id === id)?.name ?? id;
  return (
    <section aria-label="Test game rules">
      <h3>Try your rules with pretend players</h3>
      <p className="roblox-hint">
        This runs the rule logic in your browser. Choose a player, trigger a touch or interaction,
        and advance timers. Jumping, distance checks, collision, and network behavior are tested in
        Roblox Studio.
      </p>
      <div className="roblox-card">
        <div className="roblox-actions">
          <button onClick={() => setGeneration((value) => value + 1)}>Restart rule test</button>
          <button
            disabled={snapshot.players.length >= game.settings.maxPlayers}
            onClick={() => {
              let count = 1;
              while (snapshot.players.some((item) => item.id === `Player${count}`)) count++;
              const id = `Player${count}`;
              setSnapshot(simulator.join(id));
              setPlayerId(id);
            }}
          >
            Add test player
          </button>
          <button
            disabled={!player}
            onClick={() => {
              if (player) setSnapshot(simulator.leave(player.id));
            }}
          >
            Remove selected player
          </button>
          <button
            disabled={!player}
            onClick={() => {
              if (player) setSnapshot(simulator.respawn(player.id));
            }}
          >
            Respawn selected player
          </button>
        </div>
        <div className="roblox-field-grid">
          <SelectField
            label="Test player"
            value={player?.id ?? ''}
            options={snapshot.players.map((item) => [item.id, item.id])}
            change={setPlayerId}
          />
          <SelectField
            label="Test event"
            value={kind}
            options={[
              ['touch', 'Touch an object'],
              ['interact', 'Interact with an object'],
              ['roundStart', 'Try round-start rules'],
              ['roundEnd', 'Try round-end rules'],
            ]}
            change={(next) => setKind(next as typeof kind)}
          />
          {(kind === 'touch' || kind === 'interact') && (
            <SelectField
              label="Test object"
              value={selectedEntity?.id ?? ''}
              options={simulator.game.entities.map((item) => [item.id, item.name])}
              change={setEntityId}
            />
          )}
        </div>
        <button
          className="primary"
          disabled={(kind === 'touch' || kind === 'interact') && (!player || !selectedEntity)}
          onClick={trigger}
        >
          Trigger event
        </button>
        {(kind === 'roundStart' || kind === 'roundEnd') && (
          <p className="roblox-hint">
            This tries the round event for your selected player. To start or end the preview round
            itself, trigger a rule containing Start a round or End a round.
          </p>
        )}
        <div className="roblox-actions">
          <NumberField
            label="Advance time (seconds)"
            value={seconds}
            min={0}
            max={86400}
            change={setSeconds}
          />
          <button
            onClick={() => {
              if (seconds >= 0) setSnapshot(simulator.advance(seconds));
            }}
          >
            Advance timers
          </button>
        </div>
        <p role="status">
          Preview time: {snapshot.time} seconds · Round{' '}
          {snapshot.roundActive ? 'active' : 'not active'}
        </p>
      </div>
      <div className="roblox-field-grid">
        {snapshot.players.map((item) => (
          <article className="roblox-card" key={item.id} aria-label={`${item.id} results`}>
            <h4>
              {item.id}
              {item.won ? ' · Won!' : ''}
            </h4>
            <p>
              Health: {item.health} · Checkpoint:{' '}
              {item.checkpoint ? entityName(item.checkpoint) : 'Start point'}
            </p>
            <dl>
              {game.variables
                .filter((variable) => variable.scope === 'player')
                .map((variable) => (
                  <div key={variable.id}>
                    <dt>{variable.name}</dt>
                    <dd>{String(item.variables[variable.id])}</dd>
                  </div>
                ))}
              {game.items.map((value) => (
                <div key={value.id}>
                  <dt>{value.name}</dt>
                  <dd>{item.inventory[value.id] ?? 0}</dd>
                </div>
              ))}
              {game.quests.map((quest) => (
                <div key={quest.id}>
                  <dt>{quest.name}</dt>
                  <dd>
                    {item.quests[quest.id]?.state} · {item.quests[quest.id]?.progress ?? 0}/
                    {quest.target}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="roblox-hint">
              Position: {item.position.x}, {item.position.y}, {item.position.z} studs
            </p>
            {item.messages.length > 0 && (
              <ul aria-label={`${item.id} messages`}>
                {item.messages.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      <details className="roblox-card">
        <summary>Shared variables and object state</summary>
        <dl>
          {game.variables
            .filter((variable) => variable.scope === 'shared')
            .map((variable) => (
              <div key={variable.id}>
                <dt>{variable.name}</dt>
                <dd>{String(snapshot.shared[variable.id])}</dd>
              </div>
            ))}
        </dl>
        <ul>
          {Object.entries(snapshot.entities).map(([id, state]) => (
            <li key={id}>
              {entityName(id)}: {state.enabled ? 'enabled' : 'disabled'},{' '}
              {state.visible ? 'visible' : 'hidden'}, {state.collidable ? 'solid' : 'pass-through'}
            </li>
          ))}
        </ul>
      </details>
      {snapshot.notices.length > 0 && (
        <ul role="status">
          {snapshot.notices.map((notice, index) => (
            <li key={index}>{notice}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
