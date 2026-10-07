export type AppearancePreference = 'light' | 'dark' | 'system';

declare global {
  interface Window {
    visualNerveAppearance?: {
      setPreference(value: AppearancePreference): void;
      refresh(): Promise<void>;
    };
  }
}

export function appearancePreference(value: unknown): AppearancePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The shared page controller owns appearance; this fallback also supports Vite development. */
export function applyAppearance(value: unknown) {
  const preference = appearancePreference(value);
  if (window.visualNerveAppearance) {
    window.visualNerveAppearance.setPreference(preference);
    return;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const paint = () => {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  paint();
  media.addEventListener('change', paint);
  return () => media.removeEventListener('change', paint);
}

/** Notify other pages only after the canonical settings transaction has committed. */
export function appearanceSettingsChanged() {
  void window.visualNerveAppearance?.refresh();
  try {
    const channel = new window.BroadcastChannel('visual-nerve-appearance');
    channel.postMessage('refresh');
    channel.close();
  } catch {
    // Pages also read committed settings when focused, reopened or restored from history.
  }
}
