import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]';

/** Keeps the desktop panels mounted while providing modal navigation on small screens. */
export function MobileWorkspacePanel({
  className,
  panelKind,
  label,
  active,
  compact,
  close,
  children,
}: {
  className: string;
  panelKind: 'projects' | 'details';
  label: string;
  active: boolean;
  compact: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.getClientRects().length > 0 && !element.closest('[inert]'),
      );
    const frame = requestAnimationFrame(() => {
      const dismiss = focusable().find((element) =>
        element.matches(`[data-mobile-panel-dismiss="${panelKind}"]`),
      );
      (dismiss ?? focusable()[0] ?? panel.current)?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
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
      const trigger = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-mobile-panel-trigger="${panelKind}"]`),
      ).find(
        (element) =>
          !element.matches(':disabled') &&
          !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
          element.getClientRects().length > 0,
      );
      if (
        previous &&
        previous !== document.body &&
        previous.isConnected &&
        !previous.matches(':disabled') &&
        !previous.closest('[inert], [hidden], [aria-hidden="true"]') &&
        previous.getClientRects().length > 0
      )
        previous.focus();
      else trigger?.focus();
    };
  }, [active, panelKind]);
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
