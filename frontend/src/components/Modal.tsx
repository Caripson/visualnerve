import { useI18n } from '../i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './modal.css';
export function Modal({
  title,
  close,
  children,
  wide = false,
  dismissible = true,
  className = '',
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
  dismissible?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const options = useRef({ close, dismissible });
  options.current = { close, dismissible };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],summary,[tabindex]',
        ) ?? [],
      ).filter((element) => {
        if (
          element.tabIndex < 0 ||
          element.matches(':disabled') ||
          element.closest('[hidden], [aria-hidden="true"], [inert]')
        )
          return false;
        for (
          let parent: HTMLElement | null = element;
          parent && parent !== ref.current;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.visibility === 'collapse'
          )
            return false;
          if (
            parent instanceof HTMLDetailsElement &&
            !parent.open &&
            !parent.querySelector(':scope > summary')?.contains(element)
          )
            return false;
        }
        return true;
      });
    (focusable()[0] ?? ref.current)?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (options.current.dismissible) options.current.close();
      }
      if (e.key === 'Tab') {
        const all = focusable();
        if (!all.length) {
          e.preventDefault();
          ref.current?.focus();
          return;
        }
        const first = all[0],
          last = all[all.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || !ref.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || !ref.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => dismissible && e.target === e.currentTarget && close()}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'modal-wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          {dismissible && (
            <button className="icon-button" aria-label={t('shared.closeDialog')} onClick={close}>
              <X size={18} />
            </button>
          )}
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}
