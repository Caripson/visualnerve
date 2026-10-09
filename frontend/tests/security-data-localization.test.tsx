import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider, APP_LOCALES } from '../src/i18n';
import { AppLocaleController } from '../src/i18n/locale-controller';
import { LocaleCatalogLoader } from '../src/i18n/catalog-loader';
import { MessageFormatter } from '../src/i18n/message-formatter';
import { VaultCrypto } from '../src/security/vault-crypto';
import { VaultRecordStorage } from '../src/security/vault-storage';
import { VaultSession } from '../src/security/vault-session';
import { VaultGate } from '../src/security/VaultGate';
import { VaultRecoveryNotice } from '../src/security/VaultRecoveryNotice';
import { TranslatedText } from '../src/components/TranslatedText';
import { RestoreBackup } from '../src/components/DataPrivacy';
import { localizedFeedback } from '../src/components/localized-feedback';
import {
  cleanupRuleText,
  evidenceDispositionLabel,
  filterOperationLabel,
  measureRuleText,
  metricOperationLabel,
  qualityIssueLabel,
} from '../src/components/data-ui-text';
import { workspace } from '../src/storage/workspace';
import { parseCsv } from '../src/data/csv';
import type { WorkspaceBackup } from '../src/storage/database';

async function localeController() {
  const controller = new AppLocaleController(
    new LocaleCatalogLoader(),
    {
      getItem: () => null,
      setItem: vi.fn(),
    },
    undefined,
  );
  await controller.start();
  return controller;
}

for (const { id } of APP_LOCALES) {
  it(`${id}: recovery warnings and acknowledgement remain complete and credentials stay literal`, async () => {
    const controller = await localeController();
    await controller.selectLocale(id);
    const catalog = controller.getSnapshot().catalog!;
    const proceed = vi.fn();
    const secret = 'VNREC1-Private<&backup>/{password}';
    const view = render(
      <I18nProvider controller={controller}>
        <VaultRecoveryNotice subject="backup" recoveryKey={secret} continue={proceed} />
      </I18nProvider>,
    );
    const notice = screen.getByLabelText(catalog['security.backup.copiesRegion']);
    expect(notice).toHaveTextContent(catalog['security.backup.oldCredentials']);
    expect(notice).toHaveTextContent(catalog['security.backup.rotationLimit']);
    expect(notice).toHaveTextContent(catalog['security.backup.plaintextStaysReadable']);
    expect(screen.getByLabelText(catalog['security.recovery.privateLabel'])).toHaveValue(secret);
    const continueButton = screen.getByRole('button', {
      name: catalog['security.recovery.continue'],
    });
    expect(continueButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', { name: catalog['security.recovery.savedAcknowledgement'] }),
    );
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    expect(proceed).toHaveBeenCalledOnce();
    view.unmount();
    controller.dispose();
  });
}

it('changing the locked gate language preserves the password draft without unlocking or restarting the session', async () => {
  const controller = await localeController();
  const name = `localized-gate-${crypto.randomUUID()}`;
  const session = new VaultSession(
    new VaultRecordStorage(name),
    new VaultCrypto(webcrypto as unknown as Crypto),
  );
  const initialize = vi.spyOn(session, 'initialize');
  const setup = vi.spyOn(session, 'setup');
  const unlock = vi.spyOn(session, 'unlock');
  const recover = vi.spyOn(session, 'recover');
  const open = vi.fn(async () => {});
  const view = render(
    <I18nProvider controller={controller}>
      <VaultGate session={session} openWorkspace={open}>
        <p>Private content</p>
      </VaultGate>
    </I18nProvider>,
  );
  try {
    const password = await screen.findByLabelText('New workspace password');
    const confirmation = screen.getByLabelText('Confirm new password');
    const originalSnapshot = session.getSnapshot();
    fireEvent.change(password, { target: { value: 'unchanged unique password' } });
    fireEvent.change(confirmation, { target: { value: 'unchanged unique password' } });
    fireEvent.change(screen.getByLabelText('App language'), { target: { value: 'sv' } });
    await waitFor(() => expect(controller.getSnapshot().locale).toBe('sv'));
    const catalog = controller.getSnapshot().catalog!;
    expect(screen.getByLabelText(catalog['security.credential.newWorkspacePassword'])).toBe(
      password,
    );
    expect(screen.getByLabelText(catalog['security.credential.confirmNewPassword'])).toBe(
      confirmation,
    );
    expect(password).toHaveValue('unchanged unique password');
    expect(confirmation).toHaveValue('unchanged unique password');
    expect(password).toHaveAttribute('minlength', '12');
    expect(password).toHaveAttribute('maxlength', '1024');
    expect(password).toHaveAttribute('type', 'password');
    expect(session.getSnapshot()).toBe(originalSnapshot);
    expect(session.getSnapshot().status).toBe('uninitialized');
    expect(initialize).toHaveBeenCalledOnce();
    expect(setup).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText('Private content')).toBeNull();
  } finally {
    view.unmount();
    controller.dispose();
    await session.dispose();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
});

it('lazy restore retains replace mode and explicit consent across language changes, submitting original data and canonical mode', async () => {
  const controller = await localeController();
  const backup: WorkspaceBackup = {
    format: 'visual-nerve-workspace',
    formatVersion: 1,
    exportedAt: '2026-10-08T10:00:00Z',
    diagrams: [],
    nodes: [],
    edges: [],
    owners: [],
    settings: [],
    templates: [],
  };
  const restore = vi.spyOn(workspace, 'restoreBackup').mockResolvedValue(undefined);
  const close = vi.fn();
  const view = render(
    <I18nProvider controller={controller}>
      <RestoreBackup backup={backup} close={close} />
    </I18nProvider>,
  );
  try {
    fireEvent.click(await screen.findByLabelText('Replace all local data'));
    const confirmation = screen.getByLabelText('Confirm replacement of all local data');
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled();
    fireEvent.click(confirmation);
    await act(async () => {
      await controller.selectLocale('de');
    });
    const catalog = controller.getSnapshot().catalog!;
    expect(screen.getByLabelText(catalog['privacy.restore.confirmReplaceAccessible'])).toBe(
      confirmation,
    );
    expect(confirmation).toBeChecked();
    expect(screen.getByLabelText(catalog['privacy.restore.replaceLabel'])).toBeChecked();
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: catalog['privacy.backup.restore'] }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(restore).toHaveBeenCalledExactlyOnceWith(backup, 'replace');
  } finally {
    view.unmount();
    controller.dispose();
    restore.mockRestore();
  }
});

it('rich translated sentences keep authored content as React text with its original emphasis', async () => {
  const controller = await localeController();
  await controller.selectLocale('fr');
  const title = 'Settings <img src=x onerror=alert(1)> {title}';
  const view = render(
    <I18nProvider controller={controller}>
      <p data-testid="sentence">
        <TranslatedText
          messageId="data.analysis.startFromObject"
          slots={{ title: <strong>{title}</strong> }}
        />
      </p>
    </I18nProvider>,
  );
  expect(screen.getByTestId('sentence')).toHaveTextContent(title);
  expect(document.querySelector('strong')).toHaveTextContent(title);
  expect(document.querySelector('img')).toBeNull();
  view.unmount();
  controller.dispose();
});

it('localizes known data diagnostics only, preserving source values, regular expressions, custom labels and unknown errors', async () => {
  const catalog = await new LocaleCatalogLoader().load('sv');
  const formatter = new MessageFormatter('sv', catalog);
  const dataset = parseCsv('Settings,Number\n<private>,1.2345', 'original.csv');
  const sourceBefore = structuredClone(dataset);
  expect(metricOperationLabel('median', formatter.t)).toBe(catalog['data.measure.median']);
  expect(filterOperationLabel('startsWith', formatter.t)).toBe(catalog['data.filter.startsWith']);
  for (const unknown of ['constructor', '__proto__', 'New worker enum']) {
    expect(metricOperationLabel(unknown, formatter.t)).toBe(unknown);
    expect(filterOperationLabel(unknown, formatter.t)).toBe(unknown);
    expect(evidenceDispositionLabel(unknown, formatter.t)).toBe(unknown);
    expect(measureRuleText(unknown, 'Original custom rule', formatter.t)).toBe(
      'Original custom rule',
    );
  }
  const issue = {
    id: 'missing:column',
    kind: 'missing' as const,
    label: 'Original worker label',
    columnId: dataset.columns[0].id,
    count: 1,
  };
  expect(qualityIssueLabel(issue, dataset, formatter.t)).toBe(
    formatter.t('data.quality.issue.missing', { column: 'Settings' }),
  );
  expect(issue.label).toBe('Original worker label');
  expect(
    qualityIssueLabel(
      { ...issue, kind: 'missing-reference', label: '<custom relationship label>' },
      dataset,
      formatter.t,
    ),
  ).toBe('<custom relationship label>');
  const rule = {
    columnId: dataset.columns[0].id,
    pattern: '^\\d+[-–]',
    flags: 'giu',
    replacement: '$1<private>',
    trim: false,
  };
  expect(cleanupRuleText(rule, 'Settings', formatter.t)).toBe(
    formatter.t('data.measureEvidence.cleanupReplace', {
      column: 'Settings',
      pattern: rule.pattern,
      flags: rule.flags,
      replacement: JSON.stringify(rule.replacement),
      format: catalog['data.measureEvidence.autoFormat'],
    }),
  );
  expect(localizedFeedback('Invalid recovery key format.', formatter.t)).toBe(
    catalog['security.error.invalidRecoveryFormat'],
  );
  expect(
    localizedFeedback(
      'App cache cleared. Your diagrams and settings are preserved. Offline files and voices download again when needed.',
      formatter.t,
    ),
  ).toBe(catalog['privacy.cache.cleared']);
  const technicalError = 'CUSTOM_ENGINE_ERROR: alias=Settings path=<private> line=7';
  expect(localizedFeedback(technicalError, formatter.t)).toBe(technicalError);
  expect(dataset).toEqual(sourceBefore);
});
