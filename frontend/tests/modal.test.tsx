import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { Modal } from '../src/components/Modal';

it('keeps focus in a controlled input when the close callback changes during typing', () => {
  function Form() {
    const [name, setName] = useState('');
    return (
      <Modal title="Import" close={() => undefined}>
        <input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      </Modal>
    );
  }
  render(<Form />);
  const input = screen.getByLabelText('Name');
  input.focus();
  fireEvent.change(input, { target: { value: 'A' } });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'Audit import' } });
  expect(input).toHaveValue('Audit import');
  expect(input).toHaveFocus();
});

it('uses current dismissal options without resetting focus and restores the opener on unmount', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const originalClose = vi.fn(),
    latestClose = vi.fn();
  const content = <input aria-label="Name" />;
  const view = render(
    <Modal title="Import" close={originalClose}>
      {content}
    </Modal>,
  );
  const input = screen.getByLabelText('Name');
  input.focus();
  view.rerender(
    <Modal title="Import" close={latestClose} dismissible={false}>
      {content}
    </Modal>,
  );
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(originalClose).not.toHaveBeenCalled();
  expect(latestClose).not.toHaveBeenCalled();
  view.rerender(
    <Modal title="Import" close={latestClose}>
      {content}
    </Modal>,
  );
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(latestClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});

it('traps Tab around enabled controls and skips hidden fields', () => {
  render(
    <Modal title="Busy import" close={() => undefined} dismissible={false}>
      <input aria-label="Disabled" disabled />
      <div hidden>
        <input aria-label="Hidden" />
      </div>
      <input aria-label="Name" />
      <button>Submit</button>
      <textarea disabled aria-label="Disabled notes" />
    </Modal>,
  );
  const input = screen.getByLabelText('Name'),
    button = screen.getByRole('button', { name: 'Submit' });
  expect(input).toHaveFocus();
  button.focus();
  fireEvent.keyDown(button, { key: 'Tab' });
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
  expect(button).toHaveFocus();
});

it('keeps closed disclosures and CSS-hidden controls out of the focus loop', () => {
  render(
    <Modal title="Settings" close={() => undefined} dismissible={false}>
      <button>First action</button>
      <details>
        <summary>Advanced</summary>
        <button>Hidden danger action</button>
      </details>
      <div style={{ display: 'none' }}>
        <input aria-label="Hidden by layout" />
      </div>
      <button>Last action</button>
    </Modal>,
  );
  const first = screen.getByRole('button', { name: 'First action' });
  const last = screen.getByRole('button', { name: 'Last action' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(first).toHaveFocus();
  first.focus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  screen.getByText('Advanced').closest('details')!.open = true;
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(first).toHaveFocus();
});

it('keeps keyboard focus in a busy modal when all controls are disabled or inert', () => {
  render(
    <Modal title="Busy import" close={() => undefined} dismissible={false}>
      <input aria-label="Disabled" disabled />
      <form inert>
        <button>Import</button>
      </form>
    </Modal>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Busy import' });
  expect(dialog).toHaveFocus();
  expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
  expect(dialog).toHaveFocus();
  expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
  expect(dialog).toHaveFocus();
});
