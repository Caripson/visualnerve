/** Private encrypted, temporary narration. No key or logical identifier is stored here. */
export const NARRATION_CLIP_CACHE_PREFIX = 'visual-nerve-narration-temp-v1-';
export function isNarrationClipCache(name: string) {
  return /^visual-nerve-narration-temp-v1-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
    name,
  );
}
export const NARRATION_MEMORY_BYTES = 32 * 1024 * 1024;
export const NARRATION_SPILL_BYTES = 1024 * 1024 * 1024;
