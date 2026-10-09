import { APP_LOCALES, isAppLocale, useI18n } from '../i18n';

/** Only an origin-local interface preference; this does not unlock or grant access. */
export function VaultLanguageSelect() {
  const { t, requestedLocale, selectLocale, loading, error, persistenceError, retry } = useI18n();
  return (
    <div className="vault-language">
      <label className="field">
        <span>{t('settings.appLanguage')}</span>
        <select
          aria-label={t('settings.appLanguage')}
          value={requestedLocale}
          onChange={(event) => {
            const locale = event.target.value;
            if (isAppLocale(locale)) void selectLocale(locale);
          }}
        >
          {APP_LOCALES.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {loading && <p role="status">{t('settings.languageLoading')}</p>}
      {error && (
        <div role="alert">
          <p>{t('settings.languageLoadFailed')}</p>
          <button type="button" onClick={() => void retry()}>
            {t('settings.retryLanguage')}
          </button>
        </div>
      )}
      {persistenceError && <p role="status">{t('settings.languageSaveFailed')}</p>}
    </div>
  );
}
