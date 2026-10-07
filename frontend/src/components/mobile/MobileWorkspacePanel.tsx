import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]';

/** Keeps the desktop panels mounted while providing modal navigation on small screens. */
export function MobileWorkspacePanel({
  className,
  label,
  active,
  compact,
  close,
  children,
}: {
  className: string;
  label: string;
  active: boolean;
  compact: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.getClientRects().length > 0 && !element.closest('[inert]'),
      );
    const frame = requestAnimationFrame(() => {
      const dismiss = panel.current?.querySelector<HTMLElement>('button[aria-label^="Close "]');
      (dismiss ?? focusable()[0] ?? panel.current)?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (!first) {
          event.preventDefault();
          panel.current?.focus();
        } else if (
          event.shiftKey &&
          (!panel.current?.contains(document.activeElement) || document.activeElement === first)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (!panel.current?.contains(document.activeElement) || document.activeElement === last)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown, true);
      const trigger = document.querySelector<HTMLElement>(
        label === 'Projects' ? '[aria-label="Open projects"]' : '[aria-label="Open properties"]',
      );
      if (
        previous &&
        previous !== document.body &&
        previous.isConnected &&
        previous.getClientRects().length > 0
      )
        previous.focus();
      else trigger?.focus();
    };
  }, [active, close, label]);
  return (
    <div
      ref={panel}
      className={className}
      role={active ? 'dialog' : undefined}
      aria-modal={active ? true : undefined}
      aria-label={active ? label : undefined}
      tabIndex={active ? -1 : undefined}
      inert={compact && !active ? true : undefined}
    >
      {children}
    </div>
  );
}
