/** Shared wording for first-visit setup, password changes and backup/export screens. */
export function BackupSecurityNotice({ encrypted = false }: { encrypted?: boolean }) {
  return (
    <aside
      className="storage-notice backup-security-notice"
      aria-label="Security of downloaded copies"
    >
      <strong>Downloaded copies need their own protection</strong>
      {encrypted ? (
        <>
          <p>
            Changing your workspace password or recovery key does not change backups you already
            downloaded. Older encrypted backups can still be opened with the password or recovery
            key used when they were created.
          </p>
          <p>
            After a change, create and verify a new encrypted backup. Replace or remove old copies
            wherever you control them, including shared folders and cloud version history. Copies
            held by someone else cannot be recalled.
          </p>
          <p>
            A normal password change keeps the workspace content key. If a backup and its credential
            may have been exposed, use Workspace security to rotate the current content key.
            Rotation cannot protect copies already taken.
          </p>
          <p>Plaintext exports remain unencrypted, even when your workspace is locked.</p>
        </>
      ) : (
        <p>
          JSON backups and JSON or Markdown exports contain readable workspace content. Keep them in
          a protected location and share them deliberately. Later changes to the workspace do not
          update files you already downloaded or shared.
        </p>
      )}
      <a
        href="/help/settings/#downloaded-copies-and-password-changes"
        target="_blank"
        rel="noopener noreferrer"
      >
        Learn how to protect old backups
      </a>
    </aside>
  );
}
