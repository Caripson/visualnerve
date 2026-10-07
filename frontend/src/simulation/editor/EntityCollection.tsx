import { useEffect, useState, type ReactNode } from 'react';
import { useCompactLayout } from '../../hooks/useCompactLayout';

/** Mobile edits one entity at a time; hidden fields keep their unsaved text and validation. */
export function EntityCollection<T extends { id: string; name: string }>({
  items,
  label,
  children,
}: {
  items: T[];
  label: string;
  children: (item: T) => ReactNode;
}) {
  const compact = useCompactLayout();
  const [selected, setSelected] = useState(items[0]?.id ?? '');
  const [previousCount, setPreviousCount] = useState(items.length);
  useEffect(() => {
    if (items.length > previousCount) setSelected(items.at(-1)?.id ?? '');
    setPreviousCount(items.length);
  }, [items.length, previousCount]);
  const current = items.some((item) => item.id === selected) ? selected : items[0]?.id;
  return (
    <>
      {compact && items.length > 0 && (
        <label className="simulation-field simulation-entity-choice">
          {label}
          <select
            aria-label={label}
            value={current}
            onChange={(event) => setSelected(event.target.value)}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {items.map((item) => (
        <div key={item.id} className="simulation-entity" hidden={compact && item.id !== current}>
          {children(item)}
        </div>
      ))}
    </>
  );
}
