const previewBuild =
  import.meta.env.DEV || import.meta.env.VITE_VISUAL_NERVE_BEHAVIORS_PREVIEW === '1';

export const behaviorsEnabled =
  previewBuild && new URLSearchParams(globalThis.location?.search).get('behaviors') === '1';
