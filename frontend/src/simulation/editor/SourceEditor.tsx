import { NumberField, ScalingFields } from '../fields';
import { JsonField } from './JsonField';
import { ScheduleFields, openingHours } from './ScheduleFields';
import type { SimulationNode } from '../types';
import type { NodeSectionProps } from './types';
export function SourceEditor({
  draft,
  node,
  patchNode,
}: NodeSectionProps & { node: Extract<SimulationNode, { type: 'source' }> }) {
  return (
    <>
      <label className="simulation-field">
        Particle type
        <select
          aria-label="Source particle type"
          value={node.source.particleTypeId}
          onChange={(event) =>
            patchNode({ source: { ...node.source, particleTypeId: event.target.value } })
          }
        >
          {draft.particleTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </label>
      <div className="simulation-grid">
        <NumberField
          label="Arrivals / hour"
          value={node.source.ratePerHour}
          change={(value) => patchNode({ source: { ...node.source, ratePerHour: value } })}
        />
        <NumberField
          label="Arrivals / opening day"
          value={(node.source.ratePerHour ?? 0) * openingHours(node.source.schedule)}
          change={(value) =>
            patchNode({
              source: {
                ...node.source,
                ratePerHour: (value ?? 0) / openingHours(node.source.schedule),
                ...(node.source.maxCount !== undefined ? { maxCount: Math.round(value ?? 0) } : {}),
              },
            })
          }
        />
        <NumberField
          label="Initial burst"
          value={node.source.burst ?? 0}
          step={1}
          change={(value) => patchNode({ source: { ...node.source, burst: value } })}
        />
        <NumberField
          label="Maximum arrivals"
          value={node.source.maxCount}
          step={1}
          change={(value) => patchNode({ source: { ...node.source, maxCount: value } })}
        />
        <NumberField
          label="Source start (minutes)"
          value={(node.source.startSeconds ?? 0) / 60}
          change={(value) =>
            patchNode({ source: { ...node.source, startSeconds: (value ?? 0) * 60 } })
          }
        />
        <label>
          Arrival pattern
          <select
            aria-label="Arrival distribution"
            value={node.source.distribution ?? 'regular'}
            onChange={(event) =>
              patchNode({
                source: {
                  ...node.source,
                  distribution: event.target.value as 'regular' | 'poisson',
                },
              })
            }
          >
            <option value="regular">Evenly spaced</option>
            <option value="poisson">Random arrivals (seeded)</option>
          </select>
        </label>
      </div>
      <ScheduleFields
        label="Opening hours"
        value={node.source.schedule}
        change={(value) => patchNode({ source: { ...node.source, schedule: value } })}
      />
      <JsonField
        label="Opening schedule (seconds)"
        value={node.source.schedule}
        change={(value) =>
          patchNode({ source: { ...node.source, schedule: value as typeof node.source.schedule } })
        }
      />
    </>
  );
}
