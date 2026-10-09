import { useI18n } from '../../i18n';
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
  const { t } = useI18n();
  return (
    <>
      <label className="simulation-field">
        {t('simulator.common.particleType')}{' '}
        <select
          aria-label={t('simulator.editor.source.sourceParticleType')}
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
          label={t('simulator.editor.source.arrivalsPerHour')}
          value={node.source.ratePerHour}
          change={(value) => patchNode({ source: { ...node.source, ratePerHour: value } })}
        />
        <NumberField
          label={t('simulator.editor.source.arrivalsPerDay')}
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
          label={t('simulator.editor.source.initialBurst')}
          value={node.source.burst ?? 0}
          step={1}
          change={(value) => patchNode({ source: { ...node.source, burst: value } })}
        />
        <NumberField
          label={t('simulator.editor.source.maximumArrivals')}
          value={node.source.maxCount}
          step={1}
          change={(value) => patchNode({ source: { ...node.source, maxCount: value } })}
        />
        <NumberField
          label={t('simulator.editor.source.sourceStartMinutes')}
          value={(node.source.startSeconds ?? 0) / 60}
          change={(value) =>
            patchNode({ source: { ...node.source, startSeconds: (value ?? 0) * 60 } })
          }
        />
        <label>
          {t('simulator.wizard.fields.arrivalPattern')}{' '}
          <select
            aria-label={t('simulator.editor.source.arrivalDistribution')}
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
            <option value="regular">{t('simulator.editor.source.evenlySpaced')}</option>
            <option value="poisson">{t('simulator.editor.source.randomArrivalsSeeded')}</option>
          </select>
        </label>
      </div>
      <ScheduleFields
        label={t('simulator.editor.source.openingHours')}
        value={node.source.schedule}
        change={(value) => patchNode({ source: { ...node.source, schedule: value } })}
      />
      <JsonField
        fieldId={`source-schedule:${node.id}`}
        label={t('simulator.editor.source.openingScheduleSeconds')}
        value={node.source.schedule}
        change={(value) =>
          patchNode({ source: { ...node.source, schedule: value as typeof node.source.schedule } })
        }
      />
    </>
  );
}
