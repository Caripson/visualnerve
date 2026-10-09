import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../src/components/Dialogs';
import { I18nProvider } from '../src/i18n';
import { APP_LOCALE_KEY, AppLocaleController } from '../src/i18n/locale-controller';
import { LocaleCatalogLoader } from '../src/i18n/catalog-loader';
import english from '../src/i18n/catalogs/en';
import swedish from '../src/i18n/catalogs/sv';
import { workspace } from '../src/storage/workspace';

// Other Settings sections are outside this test. Keep a real retained form field
// to verify that language loading never replaces/reinitializes the dialog.
vi.mock('../src/components/DataPrivacy', () => ({
  DataPrivacy: () => (
    <input aria-label="Retained setting draft" defaultValue="private unsaved value" />
  ),
  StorageNotice: () => null,
}));
vi.mock('../src/components/VoiceSettings', () => ({ VoiceSettings: () => null }));
vi.mock('../src/components/McpSettings', () => ({ McpSettings: () => null }));
vi.mock('../src/components/ImportSettings', () => ({ ImportSettings: () => null }));
vi.mock('../src/components/ProjectFileLimitSettings', () => ({
  ProjectFileLimitSettings: () => null,
}));

afterEach(() => vi.restoreAllMocks());

function settings(controller: AppLocaleController) {
  return render(
    <I18nProvider controller={controller}>
      <SettingsDialog close={() => {}} theme="system" setTheme={() => {}} restore={() => {}} />
    </I18nProvider>,
  );
}

it('changes only the technical browser language and retains unsaved Settings fields while loading', async () => {
  let resolve!: (value: { default: typeof swedish }) => void;
  const pending = new Promise<{ default: typeof swedish }>((yes) => {
    resolve = yes;
  });
  const controller = new AppLocaleController(
    new LocaleCatalogLoader({
      en: async () => ({ default: english }),
      da: async () => ({ default: english }),
      nb: async () => ({ default: english }),
      sv: () => pending,
      fi: async () => ({ default: english }),
      de: async () => ({ default: english }),
      es: async () => ({ default: english }),
      fr: async () => ({ default: english }),
    }),
    { getItem: () => null, setItem: vi.fn() },
    undefined,
  );
  const settingWrite = vi.spyOn(workspace, 'setPreference');
  await controller.start();
  const rendered = settings(controller);
  const field = screen.getByRole('textbox', { name: 'Retained setting draft' });
  fireEvent.change(field, { target: { value: 'My unchanged draft' } });
  const language = screen.getByRole('combobox', { name: 'App language' });
  expect(Array.from((language as HTMLSelectElement).options).map((option) => option.value)).toEqual(
    ['en', 'da', 'nb', 'sv', 'fi', 'de', 'es', 'fr'],
  );
  fireEvent.change(language, { target: { value: 'sv' } });
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading language…');
  expect(field).toHaveValue('My unchanged draft');
  await act(async () => {
    resolve({ default: swedish });
    await pending;
  });
  await waitFor(() =>
    expect(screen.getByRole('dialog', { name: 'Inställningar' })).toBeInTheDocument(),
  );
  expect(screen.getByRole('textbox', { name: 'Retained setting draft' })).toBe(field);
  expect(field).toHaveValue('My unchanged draft');
  expect(screen.getByRole('combobox', { name: 'Appspråk' })).toBe(language);
  expect(settingWrite).not.toHaveBeenCalled();
  rendered.unmount();
  controller.dispose();
});

it('explains Help/API and narration boundaries and reports blocked technical preference storage locally', async () => {
  const writes: Array<[string, string]> = [];
  const controller = new AppLocaleController(
    new LocaleCatalogLoader(),
    {
      getItem: () => null,
      setItem: (key, value) => {
        writes.push([key, value]);
        throw new Error('browser storage blocked');
      },
    },
    undefined,
  );
  await controller.start();
  const rendered = settings(controller);
  const language = screen.getByRole('combobox', { name: 'App language' });
  fireEvent.change(language, { target: { value: 'sv' } });
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Appspråk' })).toHaveValue('sv'));
  const section = screen.getByRole('region', { name: 'Appspråk' });
  expect(section).toHaveTextContent('API-dokumentation är på engelska');
  expect(section).toHaveTextContent('Uppläsning behåller sin egen röst');
  expect(within(section).getByRole('status')).toHaveTextContent(
    'Webbläsaren kunde inte spara ditt språkval',
  );
  expect(writes).toEqual([[APP_LOCALE_KEY, 'sv']]);
  expect(controller.getSnapshot().locale).toBe('sv');
  rendered.unmount();
  controller.dispose();
});
