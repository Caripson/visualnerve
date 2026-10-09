import type { MessageId, Translate } from '../i18n';

/** Format known UI feedback only; exception codes, producers and unknown details stay unchanged. */
const messages: Readonly<Record<string, MessageId>> = {
  'Encrypted backup downloaded. Use the password or recovery key from this export to restore it.':
    'privacy.backup.encryptedDownloaded',
  'Backup downloaded. Use Restore backup to import it.': 'privacy.backup.legacyDownloaded',
  'App cache cleared. Your diagrams and settings are preserved. Offline files and voices download again when needed.':
    'privacy.cache.cleared',
  'This browser does not provide an app cache to clear. Your workspace data was not changed.':
    'privacy.cache.unavailable',
  'Your browser granted persistent storage. Manual clearing can still remove data.':
    'privacy.storage.persistentGrantResult',
  'Your browser did not grant persistent storage. You can still save locally and export backups.':
    'privacy.storage.persistentDeniedResult',
  'A diagram supports up to 8 CSV sources.': 'data.sources.sourceLimit',
  'Backup import cancelled.': 'security.backupReader.cancelledError',
  'Choose a valid Visual Nerve workspace backup.': 'security.backupReader.invalidBackupError',
  'Choose a Visual Nerve backup file.': 'privacy.backup.invalidFile',
  'Choose one ZIP project at a time.': 'data.codeImport.oneZip',
  'Connection instructions copied. No integration token is included.':
    'integration.instructions.copied',
  'Could not authenticate the encrypted workspace or its contents.':
    'security.error.authenticationFailed',
  'Drop CSV or TSV files to add diagram sources.': 'data.sources.dropCsvOnly',
  'Encrypted transfer downloaded. Keep its original password and recovery key, and keep this workspace until the destination has been verified.':
    'privacy.transfer.downloaded',
  'Instructions selected. Copy them with your keyboard or device copy menu.':
    'integration.instructions.selectedForCopy',
  'Invalid or unsupported encrypted workspace format.': 'security.error.invalidSchema',
  'Invalid recovery key format.': 'security.error.invalidRecoveryFormat',
  'Loading view…': 'data.analysis.loadingNotice',
  'Local connection updated. The token lasts for this browser session.':
    'integration.settings.connectionSaved',
  'No objects match this view. Broaden the focus and preview again.': 'data.codeImport.noObjects',
  'No supported CREATE TABLE definitions were found in this SQL script.': 'data.sqlImport.noSchema',
  'No supported SELECT query was found in this SQL script.': 'data.sqlImport.noQuery',
  'No supported source files found. Load a file and choose its language, or paste source.':
    'data.codeImport.noSource',
  'Open this diagram before refreshing its source.': 'data.refresh.openBeforeRefresh',
  'Saved view deleted.': 'data.analysis.deletedNotice',
  'Session limits saved. Existing session clocks were not restarted.':
    'security.settings.policySaved',
  'Source refresh failed.': 'data.refresh.failed',
  'The diagram changed during analysis. Preview changes again.':
    'data.refresh.changedDuringAnalysis',
  'The diagram changed during source review. Preview changes again before applying.':
    'data.refresh.changedDuringReview',
  'The diagram changed while preserving history. Preview changes again before applying.':
    'data.refresh.changedDuringHistory',
  'The diagram changed while this dialog was open. Close and reopen Data sources before applying.':
    'data.sources.diagramChanged',
  'The diagram changed. Preview changes again before applying.': 'data.refresh.changedBeforeApply',
  'The encrypted workspace operation exceeds its supported size limits.':
    'security.error.sizeLimit',
  'The open diagram changed. Close this dialog and refresh the source in the intended diagram.':
    'data.refresh.openDiagramChanged',
  'The original workspace has closed. Start a new export.': 'security.legacyTransfer.sourceClosed',
  'The refreshed source could not be saved.': 'data.refresh.saveFailed',
  'The transferred diagram could not be verified.': 'security.transfer.diagramVerificationFailed',
  'The workspace key is unavailable. Unlock the workspace again.': 'security.error.keyUnavailable',
  'This browser does not support the required secure cryptography.':
    'security.error.unsupportedCrypto',
  'Unable to analyze this source.': 'data.codeImport.unableAnalyze',
  'Unable to import this SQL script.': 'data.sqlImport.unableImport',
  'Unlock the workspace in the browser to continue.': 'security.error.unlockLocally',
  'Unsupported or unsafe password derivation parameters.': 'security.error.unsafeKdf',
  'Use 1–240 minutes of inactivity and an absolute limit up to 24 hours.':
    'security.error.sessionPolicyBounds',
  'Use a different, unique passphrase of at least 12 characters and matching confirmation.':
    'security.rotation.validation',
  'Use a password of at least 12 characters and at most 1024 UTF-8 bytes.':
    'security.error.invalidPassword',
  'Use a unique passphrase of at least 12 characters and matching confirmation.':
    'security.legacyTransfer.validation',
  'Use at least 12 characters and enter the same password twice.':
    'security.password.validationMatching',
  'View loaded. Notes, statuses, drawing marks and manual connections were preserved.':
    'data.analysis.loadedNotice',
  'View saved.': 'data.analysis.savedNotice',
  'Workspace transfer requires the encrypted app.': 'security.transfer.encryptedAppRequired',
};

export function localizedFeedback(message: string, t: Translate): string {
  const key = Object.hasOwn(messages, message) ? messages[message] : undefined;
  if (key) return t(key);
  for (const [prefix, wrapper] of [
    ['Some edits could not be saved: ', 'security.settings.unsavedError'],
    ['The editor remains closed: ', 'security.transfer.editorRemainsClosed'],
  ] as const) {
    if (message.startsWith(prefix)) return t(wrapper, { error: message.slice(prefix.length) });
  }
  return message;
}
