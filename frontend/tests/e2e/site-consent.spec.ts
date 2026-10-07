import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// A deliberately synthetic test-only ID. No request reaches Google's servers.
const ID = 'G-TEST1234';
const STORE = 'visualnerve-site-consent-v1';
const STAMP = 'visualnerve-site-consent-saved-at';
const GA = /https:\/\/[^/]*(?:google-analytics\.com|googletagmanager\.com)\//;
type Fixture = {
  context: BrowserContext;
  requests: { url: string; referrer: string | undefined }[];
};

async function configured(
  context: BrowserContext,
  routeName?: string,
  measurement = ID,
): Promise<Fixture> {
  const requests: Fixture['requests'] = [];
  await context.route(GA, async (route) => {
    const request = route.request();
    requests.push({ url: request.url(), referrer: request.headers().referer });
    if (request.url().includes('/gtag/js?'))
      await route.fulfill({
        contentType: 'application/javascript',
        body: `window.__testAnalyticsCommands = (window.dataLayer || []).map(x => Array.from(x)); document.cookie = '_ga=synthetic-test-cookie; Path=/; SameSite=Lax';`,
      });
    else await route.fulfill({ status: 204, body: '' });
  });
  await context.route('http://127.0.0.1:4327/**', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const path = new URL(route.request().url()).pathname;
    const html = (await response.text()).replace(
      /<meta name="visualnerve-(?:google-analytics|analytics-page)"[^>]*>/g,
      '',
    );
    const assets = html.includes('src="/site/consent.js"')
      ? ''
      : '<link rel="stylesheet" href="/site/vendor/klaro.css"><link rel="stylesheet" href="/site/consent.css"><script defer src="/site/consent.js"></script><script defer src="/site/vendor/klaro.js" data-klaro-config="visualNerveConsentConfig"></script>';
    await route.fulfill({
      response,
      body: html.replace(
        '</head>',
        `<meta name="visualnerve-google-analytics" content="${measurement}"><meta name="visualnerve-analytics-page" content="${routeName || path}">${assets}</head>`,
      ),
    });
  });
  return { context, requests };
}
async function savedChoice(context: BrowserContext, consent: boolean, age = 0) {
  await context.addInitScript(
    ({ store, stamp, consent, age }) => {
      localStorage.setItem(
        store,
        encodeURIComponent(JSON.stringify({ 'google-analytics': consent })),
      );
      localStorage.setItem(stamp, String(Date.now() - age));
    },
    { store: STORE, stamp: STAMP, consent, age },
  );
}
async function commands(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __testAnalyticsCommands?: unknown[][] }).__testAnalyticsCommands ||
      [],
  );
}
async function analyticsOff(page: Page, fixture: Fixture) {
  await expect(page.locator('#visualnerve-google-tag')).toHaveCount(0);
  expect(fixture.requests).toEqual([]);
  expect(
    (await page.context().cookies()).filter((cookie) => cookie.name.startsWith('_ga')),
  ).toEqual([]);
}

test('no configured measurement ID leaves analytics off and Cookie settings explains the local state', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    fixture = await configured(context, undefined, ''),
    page = await context.newPage();
  try {
    await page.goto('/features/');
    await expect(page.locator('#klaro-cookie-notice')).toHaveCount(0);
    await page.locator('[data-cookie-settings]').first().click();
    const dialog = page.getByRole('dialog', { name: 'Cookie settings', exact: true });
    await expect(dialog).toContainText('No optional analytics configured');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('[data-cookie-settings]').first()).toBeFocused();
    await analyticsOff(page, fixture);
  } finally {
    await context.close();
  }
});

for (const width of [320, 390, 1440]) {
  test(`analytics is opt-in with equal reject and accept choices at ${width}px`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
        viewport: { width, height: 844 },
        colorScheme: width === 1440 ? 'dark' : 'light',
      }),
      fixture = await configured(context),
      page = await context.newPage();
    try {
      await page.goto('/features/?description=PRIVATE_SOURCE#graph-title');
      const notice = page.getByRole('dialog', { name: 'Optional analytics', exact: true });
      await expect(notice).toBeVisible();
      await analyticsOff(page, fixture);
      const accept = notice.getByRole('button', { name: 'Accept analytics', exact: true }),
        reject = notice.getByRole('button', { name: 'Reject analytics', exact: true });
      const styles = await Promise.all(
        [accept, reject].map((button) =>
          button.evaluate((element) => {
            const s = getComputedStyle(element),
              r = element.getBoundingClientRect();
            return {
              color: s.color,
              background: s.backgroundColor,
              fontWeight: s.fontWeight,
              height: r.height,
              width: r.width,
            };
          }),
        ),
      );
      expect(styles[0]).toEqual(styles[1]);
      expect(styles[0].height).toBeGreaterThanOrEqual(44);
      await expect(accept).toBeInViewport({ ratio: 0.99 });
      await expect(reject).toBeInViewport({ ratio: 0.99 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: testInfo.outputPath(`consent-${width}.png`) });
      await notice.getByRole('link', { name: 'Cookie settings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Cookie settings', exact: true });
      await expect(dialog).toBeVisible();
      const geometry = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const rgb = (value: string) =>
          value
            .match(/[0-9.]+/g)!
            .slice(0, 3)
            .map(Number);
        const luminance = (value: number[]) =>
          value
            .map((channel) => {
              const c = channel / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const background = luminance(rgb(getComputedStyle(element).backgroundColor));
        const contrasts = [
          ...element.querySelectorAll('.cm-list-description,.cm-powered-by a'),
        ].map((text) => {
          const color = luminance(rgb(getComputedStyle(text).color));
          return (Math.max(color, background) + 0.05) / (Math.min(color, background) + 0.05);
        });
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          contrasts,
        };
      });
      expect(geometry.width).toBeLessThanOrEqual(width - 32);
      expect(geometry.left).toBeGreaterThanOrEqual(15.9);
      expect(geometry.right).toBeLessThanOrEqual(width - 15.9);
      expect(geometry.top).toBeGreaterThanOrEqual(15.9);
      expect(geometry.bottom).toBeLessThanOrEqual(844 - 15.9);
      expect(geometry.contrasts.length).toBeGreaterThan(0);
      for (const ratio of geometry.contrasts) expect(ratio).toBeGreaterThanOrEqual(4.5);
      await dialog
        .getByRole('button', { name: 'Reject analytics', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        dialog.getByRole('button', { name: 'Reject analytics', exact: true }),
      ).toBeInViewport({ ratio: 0.99 });
      await page.screenshot({ path: testInfo.outputPath(`consent-settings-${width}.png`) });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(notice).toBeVisible();
      await reject.click();
      await expect(notice).toHaveCount(0);
      await page.reload();
      await expect(notice).toHaveCount(0);
      await expect(page.locator('[data-cookie-settings]').first()).toBeVisible();
      await analyticsOff(page, fixture);
      expect(
        await page.evaluate(
          (store) => JSON.parse(decodeURIComponent(localStorage.getItem(store)!)),
          STORE,
        ),
      ).toEqual({ 'google-analytics': false });
    } finally {
      await context.close();
    }
  });
}

test('acceptance sends one sanitized public page view and withdrawal deletes cookies and unloads the tag', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    fixture = await configured(context),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/features/?source=PRIVATE_SQL#customer-description');
    await page
      .getByRole('dialog', { name: 'Optional analytics' })
      .getByRole('button', { name: 'Accept analytics', exact: true })
      .click();
    await expect.poll(() => fixture.requests.length).toBe(1);
    await expect.poll(async () => (await commands(page)).length).toBe(5);
    expect(fixture.requests[0]).toEqual({
      url: `https://www.googletagmanager.com/gtag/js?id=${ID}`,
      referrer: undefined,
    });
    const queue = await commands(page),
      config = queue.find((command) => command[0] === 'config')![2] as Record<string, unknown>,
      events = queue.filter((command) => command[0] === 'event');
    expect(config).toMatchObject({
      page_location: 'http://127.0.0.1:4327/features/',
      page_title: 'Visual Nerve',
      page_referrer: '',
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: '127.0.0.1',
      cookie_expires: 2592000,
      cookie_update: false,
    });
    expect(events).toEqual([
      [
        'event',
        'page_view',
        {
          page_location: 'http://127.0.0.1:4327/features/',
          page_title: 'Visual Nerve',
          page_referrer: '',
          send_to: ID,
        },
      ],
    ]);
    expect(JSON.stringify(queue)).not.toMatch(/PRIVATE_SQL|customer-description/);
    expect((await context.cookies()).some((cookie) => cookie.name === '_ga')).toBe(true);
    const settings = page.locator('[data-cookie-settings]').first();
    await settings.click();
    const dialog = page.getByRole('dialog', { name: 'Cookie settings', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await dialog.getByRole('button', { name: 'Close', exact: true }).press('Shift+Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(settings).toBeFocused();
    await settings.click();
    const checkbox = dialog.getByRole('checkbox').first();
    await checkbox.focus();
    await checkbox.press('Space');
    await expect(checkbox).not.toBeChecked();
    await Promise.all([
      page.waitForEvent('load'),
      dialog.getByRole('button', { name: 'Save choices', exact: true }).click(),
    ]);
    await expect(page.locator('#visualnerve-google-tag')).toHaveCount(0);
    expect(fixture.requests).toHaveLength(1);
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith('_ga'))).toEqual([]);
    expect(
      await page.evaluate(
        (store) => JSON.parse(decodeURIComponent(localStorage.getItem(store)!)),
        STORE,
      ),
    ).toEqual({ 'google-analytics': false });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const path of ['/app/', '/help/', '/api/docs/']) {
  test(`a saved opt-in and accidental metadata cannot enable analytics on ${path}`, async ({
    browser,
  }) => {
    const context = await browser.newContext(),
      fixture = await configured(context),
      page = await context.newPage();
    try {
      await savedChoice(context, true);
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(
              (window as unknown as { visualNerveConsentConfig?: unknown })
                .visualNerveConsentConfig,
            ),
          ),
        )
        .toBe(true);
      await analyticsOff(page, fixture);
      await expect(page.locator('#klaro-cookie-notice')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test('a saved opt-in expires after 30 days instead of loading the Google tag', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    fixture = await configured(context),
    page = await context.newPage();
  try {
    await savedChoice(context, true, 31 * 24 * 60 * 60 * 1000);
    await page.goto('/features/');
    await expect(page.getByRole('dialog', { name: 'Optional analytics' })).toBeVisible();
    await analyticsOff(page, fixture);
  } finally {
    await context.close();
  }
});

test('acceptance and withdrawal synchronize between public tabs without erasing a newly saved choice', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    fixture = await configured(context),
    first = await context.newPage(),
    second = await context.newPage();
  try {
    await first.goto('/features/');
    await second.goto('/security/');
    await first
      .getByRole('dialog', { name: 'Optional analytics' })
      .getByRole('button', { name: 'Accept analytics', exact: true })
      .click();
    await expect.poll(() => fixture.requests.length).toBe(2);
    await expect(first.locator('#visualnerve-google-tag')).toHaveCount(1);
    await expect(second.locator('#visualnerve-google-tag')).toHaveCount(1);
    await second.locator('[data-cookie-settings]').first().click();
    const dialog = second.getByRole('dialog', { name: 'Cookie settings', exact: true });
    await dialog.locator('label[for="purpose-item-analytics"]').click();
    await expect(dialog.getByRole('checkbox').first()).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Save choices', exact: true }).click();
    await expect(first.locator('#visualnerve-google-tag')).toHaveCount(0);
    await expect(second.locator('#visualnerve-google-tag')).toHaveCount(0);
    expect(fixture.requests).toHaveLength(2);
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith('_ga'))).toEqual([]);
  } finally {
    await context.close();
  }
});

test('invalid stored consent fails closed without throwing or interpreting a truthy value as opt-in', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    fixture = await configured(context),
    page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(
    ({ store, stamp }) => {
      localStorage.setItem(
        store,
        encodeURIComponent(JSON.stringify({ 'google-analytics': 'yes' })),
      );
      localStorage.setItem(stamp, String(Date.now()));
    },
    { store: STORE, stamp: STAMP },
  );
  try {
    await page.goto('/features/');
    await expect(page.getByRole('dialog', { name: 'Optional analytics' })).toBeVisible();
    await analyticsOff(page, fixture);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('blocked local storage keeps analytics off and Cookie settings reports the failure accessibly', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    fixture = await configured(context),
    page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    });
  });
  try {
    await page.goto('/features/');
    await expect(page.locator('#klaro-cookie-notice')).toHaveCount(0);
    await page.locator('[data-cookie-settings]').first().click();
    const dialog = page.getByRole('dialog', { name: 'Cookie settings', exact: true });
    await expect(dialog).toContainText('Optional analytics is unavailable and remains off');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await analyticsOff(page, fixture);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a storage write failure cannot turn an attempted acceptance into analytics consent', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    fixture = await configured(context),
    page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript((store) => {
    const persist = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === store) throw new DOMException('Storage full', 'QuotaExceededError');
      return persist.call(this, key, value);
    };
  }, STORE);
  try {
    await page.goto('/features/');
    await page
      .getByRole('dialog', { name: 'Optional analytics' })
      .getByRole('button', { name: 'Accept analytics', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Cookie settings', exact: true })).toContainText(
      'Optional analytics is unavailable and remains off',
    );
    await analyticsOff(page, fixture);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
