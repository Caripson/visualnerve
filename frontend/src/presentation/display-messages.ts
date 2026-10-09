import type { Translate } from '../i18n';
import { presentationMessagePatterns } from './message-patterns';
import { VOICES } from './speech/voices';
import { voiceDisplayLabel } from './voice-labels';

type Parameters = Record<string, string | number>;

/** Exact, bounded matching of documented English producer templates. Unknown errors stay verbatim. */
function parametersFor(template: string, message: string, numeric: readonly string[]) {
  const parameters: Parameters = {};
  const tokens = Array.from(template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g));
  let position = 0;
  let templatePosition = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const prefix = template.slice(templatePosition, token.index);
    if (!message.startsWith(prefix, position)) return;
    position += prefix.length;
    const following = template.slice(token.index! + token[0].length, tokens[index + 1]?.index);
    const end = following ? message.indexOf(following, position) : message.length;
    if (end < 0) return;
    const raw = message.slice(position, end);
    const name = token[1];
    if (numeric.includes(name) && (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))))
      return;
    const value = numeric.includes(name) ? Number(raw) : raw;
    if (Object.hasOwn(parameters, name) && parameters[name] !== value) return;
    parameters[name] = value;
    position = end;
    templatePosition = token.index! + token[0].length;
  }
  return message.slice(position) === template.slice(templatePosition) ? parameters : undefined;
}

function translated(message: string, t: Translate, depth: number): string | undefined {
  if (depth > 3 || message.length > 16_384) return;
  for (const [key, pattern, numeric] of presentationMessagePatterns) {
    const parameters = parametersFor(pattern, message, numeric);
    if (!parameters) continue;
    for (const name of ['detail', 'error'] as const)
      if (typeof parameters[name] === 'string')
        parameters[name] = translated(parameters[name], t, depth + 1) ?? parameters[name];
    if (typeof parameters.voice === 'string') {
      const known = VOICES.find((voice) => voice.label === parameters.voice);
      if (known) parameters.voice = voiceDisplayLabel(known.id, t);
    }
    return t(key, parameters);
  }
  // Speech service appends these canonical numeric suffixes. Recognize them only
  // after their base diagnostic matches, never by parsing translated/user text.
  const suffix = /^(.*?)(?: (\d+)%)?(?: \((\d+)s\))?$/.exec(message);
  if (suffix && suffix[1] !== message) {
    const detail = translated(suffix[1], t, depth + 1);
    if (detail !== undefined)
      return t('voice.composedProgress', {
        detail,
        percentSuffix: suffix[2]
          ? t('voice.progressPercentSuffix', { percent: Number(suffix[2]) })
          : '',
        elapsedSuffix: suffix[3]
          ? t('voice.progressSecondsSuffix', { seconds: Number(suffix[3]) })
          : '',
      });
  }
}

/** Display only. Callers retain the canonical message for API, retry and progress classification. */
export function presentationMessage(message: string, t: Translate) {
  return translated(message, t, 0) ?? message;
}
