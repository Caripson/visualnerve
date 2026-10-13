import type { GameEntity, GameEntityKind } from '../types';
import { NumberField, objectNames, SelectField, TextField, Toggle, VectorFields } from './fields';

const kindHelp: Record<GameEntityKind, string> = {
  spawn: 'Players appear here when they join. Put this above a solid platform.',
  platform: 'A piece of your world that players can stand on. Resize and move it below.',
  checkpoint: 'Use a touch rule with “Set checkpoint” to save a player’s return point.',
  hazard: 'Use a touch rule with “Damage player” to make this dangerous.',
  collectible: 'Use a touch rule to give an item, then hide the collectible if you want.',
  door: 'Use a rule to turn off its collision when a player meets your condition.',
  goal: 'Use a touch rule with “Player wins” to finish an adventure.',
  npc: 'A visible character marker with an interaction prompt. Add an interaction rule for dialogue or a quest.',
  zone: 'A trigger area. Turn collision and visibility off, then add a touch rule.',
  decoration: 'A prop for your world. Rules can still change its visibility and collision.',
  movingPlatform: 'Moves back and forth by the offset below. Motion is tested in Roblox Studio.',
};
export function EntityEditor({
  entity,
  change,
  remove,
  duplicate,
}: {
  entity: GameEntity;
  change: (next: GameEntity) => void;
  remove: () => void;
  duplicate: () => void;
}) {
  const patch = (next: Partial<GameEntity>) => change({ ...entity, ...next });
  return (
    <section className="roblox-card" aria-label={`Edit ${entity.name}`}>
      <div className="roblox-section-heading">
        <h3>{entity.name || 'Unnamed object'}</h3>
        <div className="roblox-actions">
          <button onClick={duplicate}>Duplicate</button>
          <button onClick={remove}>Delete object</button>
        </div>
      </div>
      <TextField label="Object name" value={entity.name} change={(name) => patch({ name })} />
      <SelectField
        label="Object type"
        value={entity.kind}
        options={objectNames}
        change={(kind) => {
          const next = { ...entity, kind: kind as GameEntityKind };
          if (kind === 'movingPlatform') {
            next.movement ??= { offset: { x: 12, y: 0, z: 0 }, duration: 3 };
            next.anchored = true;
          } else {
            delete next.movement;
            if (kind === 'npc') next.anchored = true;
          }
          change(next);
        }}
      />
      <p className="roblox-hint">{kindHelp[entity.kind]}</p>
      <VectorFields
        label="Position (studs)"
        value={entity.transform.position}
        change={(position) => patch({ transform: { ...entity.transform, position } })}
      />
      <VectorFields
        label="Size (studs)"
        value={entity.transform.size}
        min={0.1}
        change={(size) => patch({ transform: { ...entity.transform, size } })}
      />
      <VectorFields
        label="Rotation (degrees)"
        value={entity.transform.rotation}
        change={(rotation) => patch({ transform: { ...entity.transform, rotation } })}
      />
      <div className="roblox-field-grid">
        <label className="roblox-field">
          <span>Object color</span>
          <input
            type="color"
            value={entity.color}
            onChange={(event) => patch({ color: event.target.value })}
          />
        </label>
        <SelectField
          label="Material"
          value={entity.material}
          options={[
            'Plastic',
            'SmoothPlastic',
            'Neon',
            'Wood',
            'Metal',
            'Glass',
            'Grass',
            'Concrete',
          ].map((value) => [value, value] as const)}
          change={(material) => patch({ material: material as GameEntity['material'] })}
        />
      </div>
      <div className="roblox-toggle-grid">
        <Toggle
          label="Stay in place (anchored)"
          value={entity.anchored}
          change={(anchored) => patch({ anchored })}
        />
        <Toggle
          label="Players can stand on it (collision)"
          value={entity.collidable}
          change={(collidable) => patch({ collidable })}
        />
        <Toggle label="Visible" value={entity.visible} change={(visible) => patch({ visible })} />
        <Toggle label="Enabled" value={entity.enabled} change={(enabled) => patch({ enabled })} />
      </div>
      {entity.kind === 'movingPlatform' && entity.movement && (
        <>
          <VectorFields
            label="Move by (studs)"
            value={entity.movement.offset}
            change={(offset) => patch({ movement: { ...entity.movement!, offset } })}
          />
          <NumberField
            label="Travel time (seconds)"
            min={0.1}
            value={entity.movement.duration}
            change={(duration) => patch({ movement: { ...entity.movement!, duration } })}
          />
        </>
      )}
      <p className="roblox-hint">
        World positions use studs. The diagram uses pixels so you can organize your plan freely.
      </p>
    </section>
  );
}
