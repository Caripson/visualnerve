import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackupSecurityNotice } from '../src/security/BackupSecurityNotice';
import { PrivacyIntro } from '../src/components/DataPrivacy';
import { VaultPasswordChange } from '../src/security/VaultPasswordChange';
import type { VaultSession } from '../src/security/vault-session';

describe('backup independence guidance', () => {
  it('explains old credentials, sharing and replacement alongside encrypted backups', () => {
    render(<BackupSecurityNotice encrypted />);
    const notice = screen.getByLabelText('Security of downloaded copies');
    expect(notice).toHaveTextContent(
      'Changing your workspace password or recovery key does not change backups you already downloaded',
    );
    expect(notice).toHaveTextContent('password or recovery key used when they were created');
    expect(notice).toHaveTextContent('create and verify a new encrypted backup');
    expect(notice).toHaveTextContent('cloud version history');
    expect(notice).toHaveTextContent('Copies held by someone else cannot be recalled');
    expect(notice).toHaveTextContent('Plaintext exports remain unencrypted');
    expect(screen.getByRole('link', { name: 'Learn how to protect old backups' })).toHaveAttribute(
      'href',
      '/help/settings/#downloaded-copies-and-password-changes',
    );
  });

  it('does not describe legacy JSON exports as encrypted', () => {
    render(<BackupSecurityNotice />);
    expect(screen.getByLabelText('Security of downloaded copies')).toHaveTextContent(
      'JSON backups and JSON or Markdown exports contain readable workspace content',
    );
    expect(screen.queryByText(/Older encrypted backups/)).not.toBeInTheDocument();
  });

  it('shows the notice during first-use local-storage onboarding', () => {
    render(<PrivacyIntro />);
    expect(
      screen.getByRole('dialog', { name: 'Your work stays in this browser' }),
    ).toContainElement(screen.getByLabelText('Security of downloaded copies'));
  });

  it('places the encrypted-backup warning inside the password change form', () => {
    render(<VaultPasswordChange session={{} as VaultSession} close={() => undefined} />);
    const form = screen.getByLabelText('New workspace password').closest('form');
    expect(form).toContainElement(screen.getByLabelText('Security of downloaded copies'));
    expect(form).toHaveTextContent('Older encrypted backups can still be opened');
  });
});
