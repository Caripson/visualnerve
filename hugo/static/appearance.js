// All pages share the workspace's committed preference; reference pages never create storage.
(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  let revision = 0;
  const normalize = value => value === 'light' || value === 'dark' ? value : 'system';
  const paint = () => {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  const setPreference = value => {
    revision++;
    preference = normalize(value);
    paint();
  };
  const refresh = () => {
    const readRevision = ++revision;
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        if (readRevision === revision) {
          preference = normalize(value);
          paint();
        }
        resolve();
      };
      let request;
      try { request = window.indexedDB.open('visual-nerve-cache'); }
      catch { finish('system'); return; }
      // Opening a missing database would create it. Abort instead, including old databases
      // without a settings store: only the workspace is allowed to initialize/migrate storage.
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => finish('system');
      request.onblocked = () => finish('system');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (settled || !db.objectStoreNames.contains('settings')) {
          db.close();
          finish('system');
          return;
        }
        try {
          const transaction = db.transaction('settings', 'readonly');
          const store = transaction.objectStore('settings');
          const theme = store.get('theme');
          const consent = store.get('storage-consent');
          transaction.oncomplete = () => {
            db.close();
            finish(consent.result?.value === true ? theme.result?.value : 'system');
          };
          transaction.onabort = transaction.onerror = () => { db.close(); finish('system'); };
        } catch { db.close(); finish('system'); }
      };
    });
  };
  window.visualNerveAppearance = { setPreference, refresh };
  paint();
  media.addEventListener('change', paint);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
  try {
    const channel = new window.BroadcastChannel('visual-nerve-appearance');
    channel.onmessage = () => void refresh();
  } catch { /* Reload/focus still refreshes the preference when messaging is unavailable. */ }
  void refresh();
})();
