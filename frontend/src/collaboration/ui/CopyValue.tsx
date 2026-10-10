import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '../../i18n';

/** Copy only on a deliberate click/key activation, never on focus or arrival of a secret. */
export function CopyValue({
  label,
  value,
  buttonLabel,
  hideLabel = false,
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string;
  buttonLabel?: string;
  hideLabel?: boolean;
  multiline?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const content = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    generation.current++;
    setStatus('idle');
    return () => {
      generation.current++;
    };
  }, [value, disabled]);
  async function copy() {
    if (disabled) return;
    const request = ++generation.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (request === generation.current) setStatus('copied');
    } catch {
      if (request !== generation.current) return;
      // Keep the complete value selectable when permissions or browser support prevent copying.
      if (input.current) input.current.select();
      else if (content.current) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(content.current);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setStatus('failed');
    }
  }
  const action = buttonLabel ?? t('collaboration.copyValue', { label });
  const icon =
    status === 'copied' ? (
      <Check size={16} aria-hidden="true" />
    ) : (
      <Copy size={16} aria-hidden="true" />
    );
  return (
    <div className="collaboration-copy-field">
      {!hideLabel && (
        <label
          className="collaboration-copy-label"
          htmlFor={multiline ? `${id}-input` : `${id}-button`}
        >
          {label}
        </label>
      )}
      {multiline ? (
        <div className="collaboration-copy-input">
          <textarea
            ref={input}
            id={`${id}-input`}
            aria-label={hideLabel ? label : undefined}
            aria-describedby={`${id}-feedback`}
            readOnly
            disabled={disabled}
            rows={3}
            spellCheck={false}
            value={value}
            onFocus={(event) => event.target.select()}
            onClick={(event) => {
              event.currentTarget.select();
              void copy();
            }}
          />
          <button type="button" aria-label={action} disabled={disabled} onClick={() => void copy()}>
            {icon}
          </button>
        </div>
      ) : (
        <button
          id={`${id}-button`}
          type="button"
          className="collaboration-copy-value"
          aria-label={`${action}: ${value}`}
          aria-describedby={`${id}-feedback`}
          disabled={disabled}
          onClick={() => void copy()}
        >
          <code id={`${id}-value`} ref={content}>
            {value}
          </code>
          {icon}
        </button>
      )}
      <span id={`${id}-feedback`} className="collaboration-copy-feedback" role="status">
        {t(
          status === 'copied'
            ? 'collaboration.valueCopied'
            : status === 'failed'
              ? 'collaboration.valueCopyFailed'
              : 'collaboration.copyHint',
        )}
      </span>
    </div>
  );
}
