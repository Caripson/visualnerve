import { codeLanguages } from '../code/catalog';
import type { CodeLanguage } from '../code/types';

export function CodeLanguageSelect({
  value,
  label,
  disabled,
  onChange,
}: {
  value: CodeLanguage | '';
  label: string;
  disabled?: boolean;
  onChange: (language: CodeLanguage) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as CodeLanguage)}
    >
      {!value && <option value="">Choose language…</option>}
      {codeLanguages.map((language) => (
        <option key={language.id} value={language.id}>
          {language.name}
        </option>
      ))}
    </select>
  );
}
