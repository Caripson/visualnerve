import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppChromeRenderer } from './app-chrome';
import { AppLocaleController } from './locale-controller';
import { MessageFormatter } from './message-formatter';
import { appLocaleController } from './runtime';
import './i18n.css';

const ControllerContext = createContext(appLocaleController);

export function I18nProvider({
  children,
  controller = appLocaleController,
}: {
  children: ReactNode;
  controller?: AppLocaleController;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.start();
  }, [controller]);
  useLayoutEffect(() => {
    if (!snapshot.catalog) return;
    const formatter = new MessageFormatter(snapshot.locale, snapshot.catalog);
    document.documentElement.lang = snapshot.locale;
    new AppChromeRenderer(document).render(formatter.t);
  }, [snapshot.locale, snapshot.catalog]);

  if (!snapshot.catalog)
    return (
      <section className="app-language-bootstrap" aria-live="polite">
        <p>{snapshot.error ? 'Language files could not be loaded.' : 'Loading app language…'}</p>
        {snapshot.error && (
          <div>
            <button onClick={() => void controller.retry()}>Retry</button>
            {snapshot.requestedLocale !== 'en' && (
              <button onClick={() => void controller.selectLocale('en')}>
                Continue in English
              </button>
            )}
          </div>
        )}
      </section>
    );
  // After initial success, imports/failures only update labels. The child tree
  // stays mounted, including the existing gate and its stable workspace callbacks.
  const formatter = new MessageFormatter(snapshot.locale, snapshot.catalog);
  return (
    <ControllerContext.Provider value={controller}>
      {snapshot.error && (
        <aside className="app-language-notice" role="alert">
          <span>{formatter.t('i18n.loadFailure')}</span>
          <button onClick={() => void controller.retry()}>{formatter.t('i18n.retry')}</button>
        </aside>
      )}
      {children}
    </ControllerContext.Provider>
  );
}

export function useI18n() {
  const controller = useContext(ControllerContext);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const formatter = useMemo(
    () => (snapshot.catalog ? new MessageFormatter(snapshot.locale, snapshot.catalog) : null),
    [snapshot.locale, snapshot.catalog],
  );
  if (!formatter)
    throw new Error('App language must be initialized before rendering interface components.');
  return {
    t: formatter.t,
    plural: formatter.plural,
    number: formatter.number,
    date: formatter.date,
    locale: snapshot.locale,
    requestedLocale: snapshot.requestedLocale,
    loading: snapshot.loading,
    error: snapshot.error,
    persistenceError: snapshot.persistenceError,
    selectLocale: controller.selectLocale,
    retry: controller.retry,
  };
}
