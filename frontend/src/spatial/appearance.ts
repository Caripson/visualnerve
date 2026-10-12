export interface SpatialNodeTheme {
  background: string;
  color: string;
}
export interface SpatialTheme extends SpatialNodeTheme {
  surface: string;
}

/** Read the same inherited palette as the native node capture, once per batch. */
export function readSpatialTheme(): SpatialTheme {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined')
    return { background: '#ffffff', surface: '#fdfdfb', color: '#1f2d28' };
  const style = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    background: style.getPropertyValue('--node-bg').trim() || (dark ? '#242d27' : '#ffffff'),
    surface: style.getPropertyValue('--surface').trim() || (dark ? '#202522' : '#fdfdfb'),
    color: style.getPropertyValue('--text').trim() || (dark ? '#e1e7e1' : '#1f2d28'),
  };
}

export function readSpatialNodeTheme(): SpatialNodeTheme {
  const { background, color } = readSpatialTheme();
  return { background, color };
}
