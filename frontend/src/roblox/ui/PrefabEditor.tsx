import { useState } from 'react';
import type { GameDefinition, GameEntityKind, GamePrefab, GamePrefabProperty } from '../types';
import { createGameEntity } from '../starter';
import { EntityEditor } from './EntityEditor';
import { ValueEditor } from './ExpressionEditor';
import { EmptyState, objectNames, SelectField, TextField, VectorFields } from './fields';
import { RulesEditor } from './RulesEditor';

const properties: readonly (readonly [GamePrefabProperty, string])[] = [
  ['color', 'Color'],
  ['enabled', 'Enabled'],
  ['visible', 'Visible'],
  ['collidable', 'Collision'],
  ['position.x', 'Local X position'],
  ['position.y', 'Local Y position'],
  ['position.z', 'Local Z position'],
  ['size.x', 'Width (X)'],
  ['size.y', 'Height (Y)'],
  ['size.z', 'Depth (Z)'],
  ['movement.duration', 'Movement time'],
];
export function PrefabEditor({
  game,
  change,
}: {
  game: GameDefinition;
  change: (game: GameDefinition) => void;
}) {
  const [selected, setSelected] = useState(game.prefabs[0]?.id ?? '');
  const [objectId, setObjectId] = useState('');
  const [kind, setKind] = useState<GameEntityKind>('platform');
  const prefab = game.prefabs.find((item) => item.id === selected) ?? game.prefabs[0];
  const entity = prefab?.entities.find((item) => item.id === objectId) ?? prefab?.entities[0];
  const update = (next: GamePrefab) =>
    change({ ...game, prefabs: game.prefabs.map((item) => (item.id === next.id ? next : item)) });
  const add = () => {
    const id = crypto.randomUUID();
    change({
      ...game,
      prefabs: [
        ...game.prefabs,
        {
          id,
          name: `Reusable room ${game.prefabs.length + 1}`,
          entities: [createGameEntity('platform', crypto.randomUUID())],
          rules: [],
          parameters: [],
          bindings: [],
        },
      ],
    });
    setSelected(id);
  };
  return (
    <section aria-label="Reusable prefabs">
      <div className="roblox-section-heading">
        <div>
          <h3>Build once, reuse anywhere</h3>
          <p className="roblox-hint">
            A prefab is a reusable group of objects and rules. Each copy can have different
            settings, like color, damage, or size.
          </p>
        </div>
        <button className="primary" onClick={add}>
          Create prefab
        </button>
      </div>
      {!prefab ? (
        <EmptyState>
          Create a room, obstacle, or treasure chest that you can reuse throughout your world.
        </EmptyState>
      ) : (
        <>
          <SelectField
            label="Edit prefab"
            value={prefab.id}
            options={game.prefabs.map((item) => [item.id, item.name])}
            change={(id) => {
              setSelected(id);
              setObjectId('');
            }}
          />
          <div className="roblox-card">
            <div className="roblox-section-heading">
              <TextField
                label="Prefab name"
                value={prefab.name}
                change={(name) => update({ ...prefab, name })}
              />
              <button
                onClick={() =>
                  change({ ...game, prefabs: game.prefabs.filter((item) => item.id !== prefab.id) })
                }
              >
                Delete prefab
              </button>
            </div>
            <p className="roblox-hint">
              Positions inside this prefab are relative to the copy’s position. Changing the prefab
              updates all its copies.
            </p>
            <div className="roblox-actions">
              <SelectField
                label="Prefab object to add"
                value={kind}
                options={objectNames}
                change={(next) => setKind(next as GameEntityKind)}
              />
              <button
                onClick={() => {
                  const next = createGameEntity(kind, crypto.randomUUID());
                  update({ ...prefab, entities: [...prefab.entities, next] });
                  setObjectId(next.id);
                }}
              >
                Add prefab object
              </button>
            </div>
            {entity && (
              <>
                <SelectField
                  label="Edit prefab object"
                  value={entity.id}
                  options={prefab.entities.map((item) => [item.id, item.name])}
                  change={setObjectId}
                />
                <EntityEditor
                  entity={entity}
                  change={(next) =>
                    update({
                      ...prefab,
                      entities: prefab.entities.map((item) => (item.id === next.id ? next : item)),
                    })
                  }
                  remove={() =>
                    update({
                      ...prefab,
                      entities: prefab.entities.filter((item) => item.id !== entity.id),
                    })
                  }
                  duplicate={() => {
                    const next = {
                      ...structuredClone(entity),
                      id: crypto.randomUUID(),
                      name: `${entity.name} copy`,
                    };
                    update({ ...prefab, entities: [...prefab.entities, next] });
                    setObjectId(next.id);
                  }}
                />
              </>
            )}
            <details>
              <summary>Parameters · give each copy its own settings</summary>
              <button
                onClick={() =>
                  update({
                    ...prefab,
                    parameters: [
                      ...(prefab.parameters ?? []),
                      {
                        id: crypto.randomUUID(),
                        name: `Setting ${(prefab.parameters?.length ?? 0) + 1}`,
                        default: 25,
                      },
                    ],
                  })
                }
              >
                Add parameter
              </button>
              {prefab.parameters?.map((parameter) => (
                <article className="roblox-collection-row" key={parameter.id}>
                  <TextField
                    label="Parameter name"
                    value={parameter.name}
                    change={(name) =>
                      update({
                        ...prefab,
                        parameters: prefab.parameters!.map((item) =>
                          item.id === parameter.id ? { ...item, name } : item,
                        ),
                      })
                    }
                  />
                  <ValueEditor
                    label={`${parameter.name} default`}
                    value={parameter.default}
                    change={(value) =>
                      update({
                        ...prefab,
                        parameters: prefab.parameters!.map((item) =>
                          item.id === parameter.id ? { ...item, default: value } : item,
                        ),
                      })
                    }
                  />
                  <button
                    onClick={() =>
                      update({
                        ...prefab,
                        parameters: prefab.parameters!.filter((item) => item.id !== parameter.id),
                      })
                    }
                  >
                    Delete parameter {parameter.name}
                  </button>
                </article>
              ))}
              <p className="roblox-hint">
                A parameter can control an object property below or a value in a prefab rule. For
                color, use text such as #22c55e.
              </p>
              {(prefab.parameters?.length ?? 0) > 0 && prefab.entities.length > 0 && (
                <button
                  onClick={() => {
                    const parameter = prefab.parameters![0];
                    update({
                      ...prefab,
                      bindings: [
                        ...(prefab.bindings ?? []),
                        {
                          entityId: prefab.entities[0].id,
                          property:
                            typeof parameter.default === 'boolean'
                              ? 'enabled'
                              : typeof parameter.default === 'string'
                                ? 'color'
                                : 'position.y',
                          parameterId: parameter.id,
                        },
                      ],
                    });
                  }}
                >
                  Connect parameter to object
                </button>
              )}
              {prefab.bindings?.map((binding, index) => (
                <article className="roblox-collection-row" key={index}>
                  <SelectField
                    label={`Connection ${index + 1} object`}
                    value={binding.entityId}
                    options={prefab.entities.map((item) => [item.id, item.name])}
                    change={(entityId) =>
                      update({
                        ...prefab,
                        bindings: prefab.bindings!.map((item, i) =>
                          i === index ? { ...item, entityId } : item,
                        ),
                      })
                    }
                  />
                  <SelectField
                    label={`Connection ${index + 1} property`}
                    value={binding.property}
                    options={properties}
                    change={(property) =>
                      update({
                        ...prefab,
                        bindings: prefab.bindings!.map((item, i) =>
                          i === index
                            ? { ...item, property: property as GamePrefabProperty }
                            : item,
                        ),
                      })
                    }
                  />
                  <SelectField
                    label={`Connection ${index + 1} parameter`}
                    value={binding.parameterId}
                    options={(prefab.parameters ?? []).map((item) => [item.id, item.name])}
                    change={(parameterId) =>
                      update({
                        ...prefab,
                        bindings: prefab.bindings!.map((item, i) =>
                          i === index ? { ...item, parameterId } : item,
                        ),
                      })
                    }
                  />
                  <button
                    onClick={() =>
                      update({
                        ...prefab,
                        bindings: prefab.bindings!.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove connection {index + 1}
                  </button>
                </article>
              ))}
            </details>
            <details>
              <summary>Rules inside this prefab</summary>
              <RulesEditor
                rules={prefab.rules}
                change={(rules) => update({ ...prefab, rules })}
                context={{ ...game, entities: prefab.entities, parameters: prefab.parameters }}
              />
            </details>
          </div>
          <div className="roblox-card">
            <div className="roblox-section-heading">
              <h3>Copies in your world</h3>
              <button
                onClick={() =>
                  change({
                    ...game,
                    instances: [
                      ...game.instances,
                      {
                        id: crypto.randomUUID(),
                        name: `${prefab.name} ${game.instances.filter((item) => item.prefabId === prefab.id).length + 1}`,
                        prefabId: prefab.id,
                        position: { x: 0, y: 0, z: 0 },
                        rotation: { x: 0, y: 0, z: 0 },
                        parameters: {},
                      },
                    ],
                  })
                }
              >
                Place a copy
              </button>
            </div>
            {game.instances
              .filter((item) => item.prefabId === prefab.id)
              .map((instance) => {
                const patch = (value: Partial<typeof instance>) =>
                  change({
                    ...game,
                    instances: game.instances.map((item) =>
                      item.id === instance.id ? { ...item, ...value } : item,
                    ),
                  });
                return (
                  <article className="roblox-collection-row" key={instance.id}>
                    <TextField
                      label="Copy name"
                      value={instance.name}
                      change={(name) => patch({ name })}
                    />
                    <VectorFields
                      label={`${instance.name} position (studs)`}
                      value={instance.position}
                      change={(position) => patch({ position })}
                    />
                    <VectorFields
                      label={`${instance.name} rotation (degrees)`}
                      value={instance.rotation}
                      change={(rotation) => patch({ rotation })}
                    />
                    {prefab.parameters?.map((parameter) => (
                      <ValueEditor
                        key={parameter.id}
                        label={`${instance.name} ${parameter.name}`}
                        value={instance.parameters?.[parameter.id] ?? parameter.default}
                        change={(value) =>
                          patch({ parameters: { ...instance.parameters, [parameter.id]: value } })
                        }
                      />
                    ))}
                    <button
                      onClick={() =>
                        change({
                          ...game,
                          instances: game.instances.filter((item) => item.id !== instance.id),
                        })
                      }
                    >
                      Remove copy {instance.name}
                    </button>
                  </article>
                );
              })}
          </div>
        </>
      )}
    </section>
  );
}
