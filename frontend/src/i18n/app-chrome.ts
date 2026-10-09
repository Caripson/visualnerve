import type { Translate } from './types';

const messages = {
  localWorkspace: 'chrome.localWorkspace',
  site: 'chrome.site',
  workspace: 'chrome.workspace',
  guide: 'chrome.guide',
  apiReference: 'chrome.apiReference',
  privacy: 'chrome.privacy',
  website: 'chrome.website',
  reportIssue: 'chrome.reportIssue',
} as const;

/** A finite renderer for our static editor shell; no DOM text discovery or HTML. */
export class AppChromeRenderer {
  constructor(private readonly document: Document) {}

  render(translate: Translate) {
    if (!this.document.getElementById('visual-nerve')) return;
    const header = this.document.querySelector<HTMLElement>('header[data-app-chrome]');
    if (!header) return;
    for (const node of header.querySelectorAll<HTMLElement>('[data-app-chrome-text]')) {
      const marker = node.dataset.appChromeText;
      if (marker && Object.hasOwn(messages, marker))
        node.textContent = translate(messages[marker as keyof typeof messages]);
    }
    for (const node of header.querySelectorAll<HTMLElement>('[data-app-chrome-label]')) {
      const marker = node.dataset.appChromeLabel;
      if (marker && Object.hasOwn(messages, marker))
        node.setAttribute('aria-label', translate(messages[marker as keyof typeof messages]));
    }
  }
}
