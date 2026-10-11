import { useEffect, useRef, useState } from 'react';

function semanticKey(value: object | undefined) {
  if (!value) return '';
  const {
    version: _version,
    resultId: _result,
    ...fields
  } = value as { version?: number; resultId?: string };
  return JSON.stringify(fields);
}
export interface DefinitionRevision {
  blocked: boolean;
  updated: boolean;
  available: boolean;
  reload: () => void;
  assertCurrent: () => void;
}

/** Keep edits, but never silently overwrite an authoritative definition changed elsewhere. */
export function useDefinitionRevision<T extends object>(
  selected: string,
  draft: T,
  canonical: T | undefined,
  setDraft: (value: T) => void,
): DefinitionRevision {
  const key = JSON.stringify(canonical);
  const previous = useRef<{ id: string; key: string | undefined; value?: T }>({
    id: '',
    key: undefined,
  });
  const [conflict, setConflict] = useState(false);
  const [updated, setUpdated] = useState(false);
  const changed = !!selected && previous.current.id === selected && previous.current.key !== key;
  useEffect(() => {
    if (previous.current.id !== selected) {
      previous.current = {
        id: selected,
        key,
        value: canonical ? structuredClone(canonical) : undefined,
      };
      setConflict(false);
      setUpdated(false);
      return;
    }
    if (!selected || previous.current.key === key) return;
    const prior = previous.current.value;
    if (
      canonical &&
      (semanticKey(draft) === semanticKey(prior) || semanticKey(draft) === semanticKey(canonical))
    ) {
      setDraft(structuredClone(canonical));
      setConflict(false);
      setUpdated(true);
    } else {
      setConflict(true);
      setUpdated(false);
    }
    previous.current = {
      id: selected,
      key,
      value: canonical ? structuredClone(canonical) : undefined,
    };
  }, [selected, key]);
  const blocked = conflict || changed;
  return {
    blocked,
    updated,
    available: !!canonical,
    reload() {
      if (canonical) {
        setDraft(structuredClone(canonical));
        previous.current = { id: selected, key, value: structuredClone(canonical) };
        setConflict(false);
        setUpdated(false);
      }
    },
    assertCurrent() {
      if (blocked)
        throw new Error(
          'This saved definition changed elsewhere. Reload the current definition before saving, or explicitly duplicate your draft as a new object.',
        );
    },
  };
}
export function DefinitionRevisionNotice({
  revision,
  label,
}: {
  revision: DefinitionRevision;
  label: string;
}) {
  if (!revision.blocked && !revision.updated) return null;
  return (
    <div className="analytics-note" role={revision.blocked ? 'alert' : 'status'}>
      {revision.blocked
        ? `The saved ${label} changed elsewhere${revision.available ? '' : ' or was deleted'}. Your unsaved edits are preserved. Reload the saved definition before saving; you can also explicitly duplicate your draft as a new object.`
        : `The saved ${label} definition was refreshed. These fields now show its current values.`}
      {revision.blocked && revision.available && (
        <button style={{ marginTop: 10, display: 'block' }} onClick={revision.reload}>
          Reload saved {label}
        </button>
      )}
    </div>
  );
}
