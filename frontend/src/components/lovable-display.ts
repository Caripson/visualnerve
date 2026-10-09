import type { Translate } from '../i18n';
import { LOVABLE_MAX_PROMPT_LENGTH, LOVABLE_MAX_URL_LENGTH } from '../export/lovable';

/** Known UI diagnostics only. The generated prompt and authored brief stay verbatim. */
export function lovableDisplayMessage(
  message: string,
  t: Translate,
  number: (value: number) => string,
) {
  switch (message) {
    case 'Build prompt copied.':
      return t('lovable.copied');
    case 'Clipboard access is unavailable. The complete prompt is selected; copy it with your keyboard or device copy menu.':
      return t('lovable.clipboardUnavailable');
    case 'Add a prompt before opening Lovable.':
      return t('lovable.addPrompt');
    case 'This text cannot be encoded as a link. Copy or download the complete prompt instead.':
      return t('lovable.encodeFailed');
    case `Lovable links support at most ${LOVABLE_MAX_PROMPT_LENGTH.toLocaleString('en-US')} prompt characters. Copy or download the complete prompt instead.`:
      return t('lovable.promptLimit', { limit: number(LOVABLE_MAX_PROMPT_LENGTH) });
    case `The encoded link exceeds the local ${LOVABLE_MAX_URL_LENGTH.toLocaleString('en-US')}-character URL limit. Copy or download the complete prompt instead.`:
      return t('lovable.urlLimit', { limit: number(LOVABLE_MAX_URL_LENGTH) });
    default:
      return message;
  }
}
