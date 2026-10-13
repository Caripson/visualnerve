import { useState } from 'react';
import type { GameAction, GameEvent, GameRule } from '../types';
import {
  ConditionEditor,
  defaultCondition,
  ExpressionEditor,
  literal,
  type LogicContext,
} from './ExpressionEditor';
import { EmptyState, NumberField, SelectField, TextField, Toggle } from './fields';

const actionNames: readonly (readonly [GameAction['kind'], string])[] = [
  ['message', 'Show a message'],
  ['damage', 'Damage player'],
  ['heal', 'Heal player'],
  ['win', 'Player wins'],
  ['setVariable', 'Set a variable'],
  ['addVariable', 'Add to a variable'],
  ['giveItem', 'Give an item'],
  ['removeItem', 'Remove an item'],
  ['startQuest', 'Start a quest'],
  ['advanceQuest', 'Add quest progress'],
  ['completeQuest', 'Complete a quest'],
  ['startTimer', 'Start a timer'],
  ['stopTimer', 'Stop a timer'],
  ['setEntityEnabled', 'Enable / disable an object'],
  ['setEntityVisible', 'Show / hide an object'],
  ['setEntityCollidable', 'Turn object collision on / off'],
  ['teleport', 'Teleport player'],
  ['setCheckpoint', 'Set checkpoint'],
  ['startRound', 'Start a round'],
  ['endRound', 'End a round'],
];
export function availableActions(context: LogicContext) {
  return actionNames.filter(
    ([kind]) =>
      !(
        (['setVariable', 'addVariable'].includes(kind) && !context.variables.length) ||
        (['giveItem', 'removeItem'].includes(kind) && !context.items.length) ||
        (['startQuest', 'advanceQuest', 'completeQuest'].includes(kind) &&
          !context.quests.length) ||
        (['startTimer', 'stopTimer'].includes(kind) && !context.timers.length) ||
        ([
          'setEntityEnabled',
          'setEntityVisible',
          'setEntityCollidable',
          'teleport',
          'setCheckpoint',
        ].includes(kind) &&
          !context.entities.length)
      ),
  );
}
export function defaultAction(kind: GameAction['kind'], context: LogicContext): GameAction {
  switch (kind) {
    case 'setVariable':
    case 'addVariable':
      return { kind, variableId: context.variables[0]?.id ?? '', value: literal(1) };
    case 'giveItem':
    case 'removeItem':
      return { kind, itemId: context.items[0]?.id ?? '', amount: literal(1) };
    case 'startQuest':
    case 'completeQuest':
      return { kind, questId: context.quests[0]?.id ?? '' };
    case 'advanceQuest':
      return { kind, questId: context.quests[0]?.id ?? '', amount: literal(1) };
    case 'startTimer':
    case 'stopTimer':
      return { kind, timerId: context.timers[0]?.id ?? '' };
    case 'setEntityEnabled':
    case 'setEntityVisible':
    case 'setEntityCollidable':
      return { kind, entityId: context.entities[0]?.id ?? '', value: true };
    case 'teleport':
    case 'setCheckpoint':
      return { kind, entityId: context.entities[0]?.id ?? '' };
    case 'message':
      return { kind, text: 'Welcome to my game!' };
    case 'win':
      return { kind, message: 'You did it!' };
    case 'damage':
    case 'heal':
      return { kind, amount: literal(25) };
    default:
      return { kind };
  }
}
function ActionEditor({
  action,
  change,
  context,
  index,
}: {
  action: GameAction;
  change: (action: GameAction) => void;
  context: LogicContext;
  index: number;
}) {
  const label = `Action ${index + 1}`;
  return (
    <div className="roblox-action-editor">
      <SelectField
        label={`${label} does`}
        value={action.kind}
        options={availableActions(context)}
        change={(kind) => change(defaultAction(kind as GameAction['kind'], context))}
      />
      {'variableId' in action && (
        <>
          <SelectField
            label={`${label} variable`}
            value={action.variableId}
            options={context.variables.map((item) => [item.id, item.name])}
            change={(variableId) => change({ ...action, variableId })}
          />
          <ExpressionEditor
            label={`${label} value`}
            value={action.value}
            context={context}
            change={(value) => change({ ...action, value })}
          />
        </>
      )}
      {'itemId' in action && (
        <SelectField
          label={`${label} item`}
          value={action.itemId}
          options={context.items.map((item) => [item.id, item.name])}
          change={(itemId) => change({ ...action, itemId })}
        />
      )}
      {'questId' in action && (
        <SelectField
          label={`${label} quest`}
          value={action.questId}
          options={context.quests.map((item) => [item.id, item.name])}
          change={(questId) => change({ ...action, questId })}
        />
      )}
      {'timerId' in action && (
        <SelectField
          label={`${label} timer`}
          value={action.timerId}
          options={context.timers.map((item) => [item.id, item.name])}
          change={(timerId) => change({ ...action, timerId })}
        />
      )}
      {'entityId' in action && (
        <SelectField
          label={`${label} object`}
          value={action.entityId}
          options={context.entities.map((item) => [item.id, item.name])}
          change={(entityId) => change({ ...action, entityId })}
        />
      )}
      {'amount' in action && (
        <ExpressionEditor
          label={`${label} amount`}
          value={action.amount}
          context={context}
          change={(amount) => change({ ...action, amount })}
        />
      )}
      {'value' in action && typeof action.value === 'boolean' && (
        <Toggle
          label={`${label} on`}
          value={action.value}
          change={(value) => change({ ...action, value })}
        />
      )}
      {action.kind === 'message' && (
        <TextField
          label={`${label} message`}
          value={action.text}
          change={(text) => change({ ...action, text })}
          multiline
        />
      )}
      {action.kind === 'win' && (
        <TextField
          label={`${label} win message`}
          value={action.message}
          change={(message) => change({ ...action, message })}
        />
      )}
    </div>
  );
}
export function RulesEditor({
  rules,
  change,
  context,
}: {
  rules: GameRule[];
  change: (rules: GameRule[]) => void;
  context: LogicContext;
}) {
  const [selected, setSelected] = useState(rules[0]?.id ?? '');
  const rule = rules.find((item) => item.id === selected) ?? rules[0];
  const patch = (next: Partial<GameRule>) =>
    rule && change(rules.map((item) => (item.id === rule.id ? { ...item, ...next } : item)));
  const eventChoices: (readonly [string, string])[] = [
    ['playerJoin', 'A player joins'],
    ['roundStart', 'A round starts'],
    ['roundEnd', 'A round ends'],
  ];
  if (context.entities.length)
    eventChoices.splice(
      1,
      0,
      ['touch', 'A player touches an object'],
      ['interact', 'A player uses an object'],
    );
  if (context.timers.length) eventChoices.push(['timer', 'A timer finishes']);
  return (
    <section aria-label="Game rules">
      <div className="roblox-section-heading">
        <div>
          <h3>When → If → Then</h3>
          <p className="roblox-hint">
            Choose what starts the rule, an optional condition, and what happens next. The server
            runs these rules for every player.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            const id = crypto.randomUUID();
            change([
              ...rules,
              {
                id,
                name: `Rule ${rules.length + 1}`,
                enabled: true,
                event: { kind: 'playerJoin' },
                actions: [{ kind: 'message', text: 'Welcome!' }],
                cooldown: 1,
                oncePerPlayer: false,
              },
            ]);
            setSelected(id);
          }}
        >
          Add rule
        </button>
      </div>
      {!rule ? (
        <EmptyState>
          Add your first rule. For example: when a player touches a coin, give them one key.
        </EmptyState>
      ) : (
        <div className="roblox-editor-columns">
          <div className="roblox-roster" role="group" aria-label="Choose a rule">
            {rules.map((item) => (
              <button
                key={item.id}
                aria-pressed={item.id === rule.id}
                onClick={() => setSelected(item.id)}
              >
                <b>{item.name}</b>
                <small>
                  {item.event.kind} · {item.actions.length} actions
                </small>
              </button>
            ))}
          </div>
          <section className="roblox-card">
            <div className="roblox-section-heading">
              <h3>{rule.name}</h3>
              <button onClick={() => change(rules.filter((item) => item.id !== rule.id))}>
                Delete rule
              </button>
            </div>
            <TextField label="Rule name" value={rule.name} change={(name) => patch({ name })} />
            <Toggle
              label="Rule enabled"
              value={rule.enabled}
              change={(enabled) => patch({ enabled })}
            />
            <fieldset>
              <legend>When this happens</legend>
              <SelectField
                label="Rule starts when"
                value={rule.event.kind}
                options={eventChoices}
                change={(kind) => {
                  const event: GameEvent =
                    kind === 'touch' || kind === 'interact'
                      ? { kind, entityId: context.entities[0]?.id ?? '' }
                      : kind === 'timer'
                        ? { kind, timerId: context.timers[0]?.id ?? '' }
                        : { kind: kind as 'playerJoin' | 'roundStart' | 'roundEnd' };
                  patch({ event });
                }}
              />
              {'entityId' in rule.event && (
                <SelectField
                  label="Trigger object"
                  value={rule.event.entityId}
                  options={context.entities.map((item) => [item.id, item.name])}
                  change={(entityId) => patch({ event: { ...rule.event, entityId } as GameEvent })}
                />
              )}
              {'timerId' in rule.event && (
                <SelectField
                  label="Trigger timer"
                  value={rule.event.timerId}
                  options={context.timers.map((item) => [item.id, item.name])}
                  change={(timerId) => patch({ event: { kind: 'timer', timerId } })}
                />
              )}
            </fieldset>
            <fieldset>
              <legend>If this is true (optional)</legend>
              <Toggle
                label="Use a condition"
                value={!!rule.condition}
                change={(enabled) => {
                  const next = { ...rule };
                  if (enabled) next.condition = defaultCondition();
                  else delete next.condition;
                  change(rules.map((item) => (item.id === next.id ? next : item)));
                }}
              />
              {rule.condition && (
                <ConditionEditor
                  condition={rule.condition}
                  context={context}
                  change={(condition) => patch({ condition })}
                />
              )}
            </fieldset>
            <fieldset>
              <legend>Then do these actions, in order</legend>
              {rule.actions.map((action, index) => (
                <div className="roblox-rule-action" key={index}>
                  <ActionEditor
                    action={action}
                    index={index}
                    context={context}
                    change={(next) =>
                      patch({ actions: rule.actions.map((item, i) => (i === index ? next : item)) })
                    }
                  />
                  <div className="roblox-actions">
                    <button
                      aria-label={`Move action ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => {
                        const actions = [...rule.actions];
                        [actions[index - 1], actions[index]] = [actions[index], actions[index - 1]];
                        patch({ actions });
                      }}
                    >
                      Move up
                    </button>
                    <button
                      disabled={rule.actions.length === 1}
                      onClick={() => patch({ actions: rule.actions.filter((_, i) => i !== index) })}
                    >
                      Remove action {index + 1}
                    </button>
                  </div>
                </div>
              ))}
              <button
                disabled={rule.actions.length >= 64}
                onClick={() =>
                  patch({
                    actions: [...rule.actions, { kind: 'message', text: 'Something happened!' }],
                  })
                }
              >
                Add action
              </button>
            </fieldset>
            <div className="roblox-field-grid">
              <NumberField
                label="Wait before repeating (seconds)"
                value={rule.cooldown}
                min={0}
                change={(cooldown) => patch({ cooldown })}
              />
              <Toggle
                label="Run only once for each player"
                value={rule.oncePerPlayer}
                change={(oncePerPlayer) => patch({ oncePerPlayer })}
              />
            </div>
            <p className="roblox-hint">
              Shared timers have no individual player; use shared variables and object actions.
              Round start and end events run for each player currently in the server.
            </p>
          </section>
        </div>
      )}
    </section>
  );
}
