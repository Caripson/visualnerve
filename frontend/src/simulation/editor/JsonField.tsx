import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const ValidationContext = createContext<(field: string, invalid: boolean) => void>(() => undefined);
export function EditorValidationProvider({
  children,
  change,
}: {
  children: ReactNode;
  change: (field: string, invalid: boolean) => void;
}) {
  return <ValidationContext.Provider value={change}>{children}</ValidationContext.Provider>;
}

export function JsonField({
  label,
  value,
  change,
}: {
  label: string;
  value: unknown;
  change: (value: unknown) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2) ?? '');
  const [error, setError] = useState('');
  const validity = useContext(ValidationContext);
  // Reopening a section shows its current valid draft; invalid syntax never changes that draft.
  useEffect(() => {
    validity(label, false);
  }, [label, validity]);
  return (
    <label className="simulation-field">
      <span>{label}</span>
      <textarea
        aria-label={label}
        rows={4}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            change(event.target.value.trim() ? JSON.parse(event.target.value) : undefined);
            setError('');
            validity(label, false);
          } catch {
            setError('Enter valid JSON before applying.');
            validity(label, true);
          }
        }}
      />
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
