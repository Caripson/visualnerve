import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyValue } from '../src/collaboration/ui/CopyValue';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
function clipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  window.getSelection()?.removeAllRanges();
});

describe('deliberate copying of collaboration values', () => {
  it('copies a complete fingerprint only when activated and reports success', async () => {
    const write = clipboard();
    const value = 'a'.repeat(64);
    render(<CopyValue label="Device fingerprint" value={value} />);
    const button = screen.getByRole('button', { name: `Copy Device fingerprint: ${value}` });
    fireEvent.focus(button);
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard.'),
    );
    expect(write).toHaveBeenCalledExactlyOnceWith(value);
  });

  it('selects an invitation on focus but copies only on click or explicit copy activation', async () => {
    const write = clipboard();
    const value = 'https://app.example/#collaboration=private-one-use-link';
    render(<CopyValue label="Private invitation link" value={value} multiline />);
    const field = screen.getByRole('textbox', { name: 'Private invitation link' });
    fireEvent.focus(field);
    expect(write).not.toHaveBeenCalled();
    expect(field).toHaveProperty('selectionStart', 0);
    expect(field).toHaveProperty('selectionEnd', value.length);
    fireEvent.click(field);
    await waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith(value));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Private invitation link' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenLastCalledWith(value);
  });

  it('preserves manual selection when clipboard permission is denied', async () => {
    clipboard(vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')));
    const value = 'b'.repeat(64);
    render(<CopyValue label="Device fingerprint" value={value} />);
    fireEvent.click(screen.getByRole('button', { name: `Copy Device fingerprint: ${value}` }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not copy.'));
    expect(screen.queryByText('Copied to clipboard.')).not.toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe(value);
  });

  it('selects the full invitation and gives manual instructions when clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const value = 'https://app.example/#collaboration=private-one-use-link';
    render(<CopyValue label="Private invitation link" value={value} multiline />);
    const field = screen.getByRole('textbox', { name: 'Private invitation link' });
    fireEvent.click(field);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('copy it manually'));
    expect(field).toHaveProperty('selectionStart', 0);
    expect(field).toHaveProperty('selectionEnd', value.length);
  });

  it('does not claim that a replacement invitation was copied when an earlier write finishes', async () => {
    let finish!: () => void;
    const write = clipboard(
      vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const view = render(
      <CopyValue label="Private invitation link" value="original-secret" multiline />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy Private invitation link' }));
    view.rerender(
      <CopyValue label="Private invitation link" value="replacement-secret" multiline />,
    );
    await act(async () => finish());
    expect(write).toHaveBeenCalledExactlyOnceWith('original-secret');
    expect(screen.getByRole('status')).toHaveTextContent('Click or tap to copy.');
    expect(screen.queryByText('Copied to clipboard.')).not.toBeInTheDocument();
  });

  it('does not copy a disabled or expired invitation', () => {
    const write = clipboard();
    render(<CopyValue label="Private invitation link" value="expired-secret" multiline disabled />);
    const field = screen.getByRole('textbox', { name: 'Private invitation link' });
    const button = screen.getByRole('button', { name: 'Copy Private invitation link' });
    expect(field).toBeDisabled();
    expect(button).toBeDisabled();
    fireEvent.click(field);
    fireEvent.click(button);
    expect(write).not.toHaveBeenCalled();
  });
});
