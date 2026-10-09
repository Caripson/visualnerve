import { useI18n } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './toolbar-menu.css';

/** Render above the workspace so a scrolling toolbar cannot clip its tools. */
export function ToolbarMenu({
  label,
  icon,
  children,
  className = '',
  text = true,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  text?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback((focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const width = Math.min(310, window.innerWidth - 24);
      const availableBelow = window.innerHeight - anchor.bottom - 18;
      const availableAbove = anchor.top - 18;
      const height = panel.current.scrollHeight;
      const above = height > availableBelow && availableAbove > availableBelow;
      const maxHeight = Math.max(
        1,
        Math.min(window.innerHeight - 24, Math.max(80, above ? availableAbove : availableBelow)),
      );
      const wantedTop = above ? anchor.top - Math.min(height, maxHeight) - 6 : anchor.bottom + 6;
      const top = Math.max(
        12,
        Math.min(window.innerHeight - Math.min(height, maxHeight) - 12, wantedTop),
      );
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, anchor.right - width));
      setPosition({ top, left, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    panel.current
      ?.querySelector<HTMLElement>('button:not(:disabled),select:not(:disabled)')
      ?.focus();
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const dismiss = () => close();
    window.addEventListener('visualnerve:close-toolbar-menus', dismiss);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('visualnerve:close-toolbar-menus', dismiss);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);
  return (
    <div className={`toolbar-menu ${className}`}>
      <button
        ref={trigger}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {text && <span>{label}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="toolbar-menu-panel"
            role="dialog"
            aria-label={t('shared.toolbarMenuRegion', { label })}
            style={{
              top: position.top,
              left: position.left,
              maxHeight: position.maxHeight || undefined,
            }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('button:not(:disabled)')) close();
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
