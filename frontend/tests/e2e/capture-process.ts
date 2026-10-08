import { resolve } from 'node:path';
import type { Page, Locator } from '@playwright/test';
import { captureAppearancePair } from './capture-appearance';

/** Explicit opt-in keeps CI from rewriting documentation assets. */
export async function captureProcessGuide(
  target: Page | Locator,
  name:
    | 'process-setup'
    | 'simulation-traffic'
    | 'node-quick-add'
    | 'process-hierarchy'
    | 'process-drilldown'
    | 'process-subprocess-setup',
) {
  if (process.env.VN_CAPTURE_PROCESS !== '1') return;
  await captureAppearancePair(target, resolve('../hugo/static/help/images'), name);
}
