import { expect, test, type Locator, type Page } from '@playwright/test';
import { acknowledge } from './fixtures';

test.skip(
  process.env.VITE_VISUAL_NERVE_BEHAVIORS_PREVIEW !== '1',
  'The Behavior prototype requires a preview-enabled test build.',
);

async function openDemo(page: Page, demo: string, title: string) {
  await page.goto(`?behaviors=1&demo=${demo}`);
  await acknowledge(page);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

function canvasCard(page: Page, title: string) {
  return page.locator('.react-flow__node').filter({ has: page.getByText(title, { exact: true }) });
}

async function dragBehavior(page: Page, source: Locator, target: Locator) {
  const handle = source.locator('[data-behavior-drag]');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  try {
    await handle.dispatchEvent('dragstart', { dataTransfer });
    const panel = page.getByRole('dialog', { name: 'Behavior library menu' });
    await expect(panel).toHaveCSS('pointer-events', 'none');
    const accepted = await target.evaluate(
      (card, transfer) =>
        !card.dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        ),
      dataTransfer,
    );
    expect(accepted).toBe(true);
    await target.dispatchEvent('drop', { dataTransfer });
  } finally {
    await handle.dispatchEvent('dragend', { dataTransfer });
    await dataTransfer.dispose();
  }
}

async function connect(page: Page, source: string, target: string) {
  await page.getByRole('button', { name: 'Connect nodes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect nodes' });
  await dialog.getByRole('combobox', { name: 'Connection from' }).selectOption({ label: source });
  await dialog.getByRole('combobox', { name: 'Connection to' }).selectOption({ label: target });
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
}

test('the Behavior library keeps drafts and attaches independently configured copies', async ({
  page,
}) => {
  await openDemo(page, 'behaviors-editor', 'Behavior demo: Rename');
  const library = page.getByRole('button', { name: 'Behavior library', exact: true });
  const definition = page.getByRole('article', { name: 'Rename target' });
  const sourceA = canvasCard(page, 'Källa A');
  const sourceB = canvasCard(page, 'Källa B');

  await library.click();
  await page.getByRole('button', { name: 'New behavior' }).click();
  await page.getByLabel('Behavior name').fill('Rename target');
  await page.getByRole('button', { name: 'Activate source' }).click();
  await expect(definition).toContainText('Active');

  const edit = definition.getByRole('button', { name: 'Edit Rename target' });
  await edit.click();
  const source = page.getByLabel('Behavior source');
  const invalid = 'on connectionAdded\n  nonsense\nend';
  await source.fill(invalid);
  await expect(page.getByText(/Line 2, column 3/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate source' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(definition).toContainText('Active, draft saved');
  await edit.click();
  await expect(source).toHaveValue(invalid);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await dragBehavior(page, definition, sourceA);
  await library.click();
  await sourceA.click();
  const binding = page.getByRole('group', { name: 'Rename target' });
  const parameter = binding.getByRole('textbox', { name: 'nextName' });
  await expect(parameter).toHaveValue('Quality check');
  await parameter.fill('Target from A');
  await parameter.press('Enter');

  await sourceB.click();
  await library.click();
  await definition.getByRole('button', { name: 'Add to selected node' }).click();
  await library.click();
  await expect(parameter).toHaveValue('Quality check');
  await parameter.fill('Target from B');
  await parameter.press('Enter');
  await sourceA.click();
  await expect(parameter).toHaveValue('Target from A');

  const edges = page.locator('.react-flow__edge');
  await connect(page, 'Källa A', 'Mål A');
  await expect(edges).toHaveCount(1);
  await expect(canvasCard(page, 'Target from A')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(edges).toHaveCount(0);
  await expect(canvasCard(page, 'Mål A')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(edges).toHaveCount(1);
  await expect(canvasCard(page, 'Target from A')).toBeVisible();
  await connect(page, 'Källa B', 'Mål B');
  await expect(canvasCard(page, 'Target from B')).toBeVisible();
  await sourceB.click();
  await binding.getByRole('checkbox', { name: 'Enabled' }).uncheck();
  await connect(page, 'Källa B', 'Target from A');
  await expect(edges).toHaveCount(3);
  await expect(canvasCard(page, 'Target from A')).toBeVisible();

  await library.click();
  await page.getByText('Behavior trace (2)', { exact: true }).click();
  await expect(page.getByText('Mål A → Target from A', { exact: true })).toBeVisible();
  await expect(page.getByText('Mål B → Target from B', { exact: true })).toBeVisible();
  await library.click();
  await sourceB.click();
  await binding.getByRole('button', { name: 'Remove binding' }).click();
  await expect(binding).toHaveCount(0);
  await sourceA.click();
  await expect(parameter).toHaveValue('Target from A');

  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.goto('?behaviors=1');
  await page.getByRole('button', { name: 'Behavior demo: Rename', exact: true }).click();
  await sourceA.click();
  await expect(parameter).toHaveValue('Target from A');
  await sourceB.click();
  await expect(binding).toHaveCount(0);
});

test('simulation bindings require a compatible Work node and keep typed reference values', async ({
  page,
}) => {
  await openDemo(page, 'behaviors-cashier', 'Behavior demo: Checkout / 2 people');
  const cashier = canvasCard(page, 'Kassor');
  const library = page.getByRole('button', { name: 'Behavior library', exact: true });
  const threshold = page.getByRole('article', { name: 'Kötröskel' });

  await cashier.click();
  await expect(
    page
      .getByRole('group', { name: 'Öppna reservkassa' })
      .getByRole('combobox', { name: 'staffing' }),
  ).toHaveValue('staff');

  const binding = page.getByRole('group', { name: 'Kötröskel' });
  await expect(binding.getByRole('spinbutton', { name: 'threshold' })).toHaveValue('15');
  await binding.getByRole('button', { name: 'Remove binding' }).click();

  await canvasCard(page, 'Ankomster').click();
  await library.click();
  await expect(threshold.getByRole('button', { name: 'Add to selected node' })).toBeDisabled();
  await library.click();
  await cashier.click();
  const behaviorChoice = page.getByRole('combobox', { name: 'Behavior to add' });
  await behaviorChoice.selectOption({ label: 'Kötröskel' });
  await page.getByRole('button', { name: 'Add behavior', exact: true }).click();

  const enabled = binding.getByRole('checkbox', { name: 'Enabled' });
  await expect(enabled).not.toBeChecked();
  await expect(enabled).toBeDisabled();
  const receiver = binding.getByRole('combobox', { name: 'receiver' });
  await expect(receiver).toHaveValue('');
  await expect(receiver.getByRole('option', { name: 'Ankomster' })).toHaveCount(0);
  await receiver.selectOption({ label: 'Kassor' });
  const cashierId = await cashier.getAttribute('data-id');
  await expect(receiver).toHaveValue(cashierId!);
  await expect(enabled).toBeEnabled();
  await enabled.check();
  await expect(enabled).toBeChecked();
});

test('the Behavior library requires explicit preview opt-in', async ({ page }) => {
  await page.goto('?demo=kiosk');
  await acknowledge(page);
  await expect(page.getByRole('heading', { name: 'Kiosk package pickup', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Behavior library', exact: true })).toHaveCount(0);
});
