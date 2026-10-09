import { useI18n } from '../i18n';
import { useId } from 'react';

export function VaultPasswordFields({
  password,
  confirmation,
  setPassword,
  setConfirmation,
  disabled,
  confirm = false,
}: {
  password: string;
  confirmation?: string;
  setPassword: (value: string) => void;
  setConfirmation?: (value: string) => void;
  disabled: boolean;
  confirm?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <>
      <label className="field" htmlFor={`${id}-password`}>
        <span>
          {confirm
            ? t('security.credential.newWorkspacePassword')
            : t('security.credential.workspacePassword')}
        </span>
        <input
          id={`${id}-password`}
          type="password"
          autoComplete={confirm ? 'new-password' : 'current-password'}
          minLength={confirm ? 12 : undefined}
          maxLength={1024}
          required
          disabled={disabled}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {confirm && (
        <>
          <p className="muted">{t('security.password.passphraseHint')}</p>
          <label className="field" htmlFor={`${id}-confirmation`}>
            <span>{t('security.credential.confirmNewPassword')}</span>
            <input
              id={`${id}-confirmation`}
              type="password"
              autoComplete="new-password"
              required
              maxLength={1024}
              disabled={disabled}
              value={confirmation ?? ''}
              onChange={(event) => setConfirmation?.(event.target.value)}
            />
          </label>
        </>
      )}
    </>
  );
}
