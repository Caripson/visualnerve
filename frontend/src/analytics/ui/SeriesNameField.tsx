import { useState } from 'react';
import type { AnalyticsSeries } from '../types';
import { DefinitionRevisionNotice, useDefinitionRevision } from './use-definition-revision';

export function SeriesNameField({
  series,
  save,
  disabled,
}: {
  series: AnalyticsSeries;
  save: (name: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(() => structuredClone(series));
  const revision = useDefinitionRevision(series.id, draft, series, setDraft);
  return (
    <div>
      <label>
        Name
        <input
          aria-label={`Series name ${series.id}`}
          value={draft.name}
          disabled={disabled}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          onBlur={() => {
            if (!revision.blocked && draft.name !== series.name) save(draft.name);
          }}
        />
      </label>
      <DefinitionRevisionNotice revision={revision} label="series" />
    </div>
  );
}
