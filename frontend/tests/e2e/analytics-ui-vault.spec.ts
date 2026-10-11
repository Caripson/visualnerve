import { expect, test } from '@playwright/test';
import { acknowledge } from './fixtures';

/** Delay delivery, rather than replacing the real worker's numerical implementation. */
test('lock and fresh unlock cannot publish an older analysis response or archive', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        let onmessage: ((this: Worker, event: MessageEvent) => unknown) | null = null;
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get: () => onmessage,
          set: (callback: typeof onmessage) => {
            onmessage = callback;
          },
        });
        super.addEventListener('message', (event: MessageEvent) => {
          const callback = onmessage;
          if (!callback) return;
          const probe = window as unknown as {
            delayAnalyticsResponses?: boolean;
            analyticsDelayedResultCount?: number;
            analyticsDelayedDeliveryCount?: number;
            analyticsDelayedDeliveryTime?: number;
          };
          if (probe.delayAnalyticsResponses && event.data?.kind === 'result') {
            probe.analyticsDelayedResultCount = (probe.analyticsDelayedResultCount ?? 0) + 1;
            setTimeout(() => {
              probe.analyticsDelayedDeliveryCount = (probe.analyticsDelayedDeliveryCount ?? 0) + 1;
              probe.analyticsDelayedDeliveryTime = performance.now();
              callback.call(this, event);
            }, 12000);
          } else callback.call(this, event);
        });
      }
    };
  });
  const password = 'Synthetic analytics lifecycle browser passphrase';
  await page.goto('https://public-app.test:4341/?demo=time-series-analysis');
  await page.getByLabel('New workspace password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create encrypted workspace', exact: true }).click();
  await page.getByLabel('I have saved my recovery key in a protected location.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await acknowledge(page);
  await expect(page.getByRole('main', { name: 'Time Series & Signal Analysis' })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('tab', { name: /3 · Measure/ }).click();
  await page
    .getByLabel('Measurement name', { exact: true })
    .fill('OLD_SESSION_ANALYSIS_MUST_NOT_SAVE');
  const before = await page.evaluate(
    async () =>
      await new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('visual-nerve-vault');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction('records').objectStore('records').count();
          get.onsuccess = () => {
            db.close();
            resolve(get.result);
          };
          get.onerror = () => reject(get.error);
        };
      }),
  );
  await page.evaluate(() => {
    (window as unknown as { delayAnalyticsResponses?: boolean }).delayAnalyticsResponses = true;
  });
  await page.getByRole('button', { name: 'Save definition and result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel analysis', exact: true })).toBeVisible();
  await page.waitForFunction(
    () =>
      ((window as unknown as { analyticsDelayedResultCount?: number })
        .analyticsDelayedResultCount ?? 0) > 0,
  );
  // The global header remains available during a worker run.
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Unlock your workspace', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.evaluate(() => {
    const probe = window as unknown as {
      delayAnalyticsResponses?: boolean;
      analyticsFreshUnlockTime?: number;
    };
    probe.delayAnalyticsResponses = false;
    probe.analyticsFreshUnlockTime = performance.now();
  });
  await expect(page.getByRole('main', { name: 'Time Series & Signal Analysis' })).toBeVisible();
  await page.getByRole('tab', { name: /3 · Measure/ }).click();
  await expect(page.getByLabel('Saved measurement', { exact: true })).not.toContainText(
    'OLD_SESSION_ANALYSIS_MUST_NOT_SAVE',
  );
  await page.getByRole('button', { name: 'Calculate measurement', exact: true }).click();
  await expect(page.getByLabel('Measurement results')).toBeVisible();
  await page.waitForFunction(
    () =>
      ((window as unknown as { analyticsDelayedDeliveryCount?: number })
        .analyticsDelayedDeliveryCount ?? 0) > 0,
  );
  await expect(page.getByLabel('Saved measurement', { exact: true })).not.toContainText(
    'OLD_SESSION_ANALYSIS_MUST_NOT_SAVE',
  );
  const deliveredAfterUnlock = await page.evaluate(() => {
    const probe = window as unknown as {
      analyticsFreshUnlockTime: number;
      analyticsDelayedDeliveryTime: number;
    };
    return probe.analyticsDelayedDeliveryTime > probe.analyticsFreshUnlockTime;
  });
  expect(deliveredAfterUnlock).toBe(true);
  const after = await page.evaluate(
    async () =>
      await new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('visual-nerve-vault');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction('records').objectStore('records').count();
          get.onsuccess = () => {
            db.close();
            resolve(get.result);
          };
          get.onerror = () => reject(get.error);
        };
      }),
  );
  expect(after).toBe(before);
});
