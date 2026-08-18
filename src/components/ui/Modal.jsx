/**
 * Modal — the shared accessible dialog shell.
 *
 * Every modal in the app routes through this. Previously each one was a bare
 * `fixed inset-0` div: no `role="dialog"`, no focus trap, no Escape handling, no
 * focus restore, and the page behind stayed scrollable. Keyboard and screen-reader
 * users could tab straight out of an open dialog into the page underneath.
 *
 * Provides:
 *  - `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`
 *  - focus moved into the panel on open, restored to the trigger on close
 *  - Tab / Shift+Tab cycling confined to the panel
 *  - Escape to close, backdrop click to close
 *  - body scroll lock, with scrollbar-width compensation so content doesn't jump
 *  - reference-counted lock, so stacked modals don't unlock early
 */
import { useEffect, useRef, useId, useCallback } from 'react';
import { CloseIcon } from '../icons/Icons';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'details > summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/* ── Body scroll lock, reference counted for stacked modals ── */
let lockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';

const lockBodyScroll = () => {
  if (lockCount === 0) {
    const { body, documentElement } = document;
    // Compensate for the disappearing scrollbar so the page doesn't shift.
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    savedOverflow = body.style.overflow;
    savedPaddingRight = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) {
      const current = parseInt(window.getComputedStyle(body).paddingRight, 10) || 0;
      body.style.paddingRight = `${current + scrollbar}px`;
    }
  }
  lockCount++;
};

const unlockBodyScroll = () => {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
    document.body.style.paddingRight = savedPaddingRight;
  }
};

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-2xl',
  '2xl': 'sm:max-w-4xl',
  '4xl': 'sm:max-w-6xl',
};

/**
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {string} props.title - Required: labels the dialog for assistive tech.
 * @param {string} [props.subtitle]
 * @param {React.ReactNode} [props.icon]
 * @param {keyof SIZES} [props.size='xl']
 * @param {string} [props.maxHeight='max-h-[90vh]']
 * @param {boolean} [props.sheetOnMobile=false] - Slide up from the bottom on small screens.
 * @param {React.ReactNode} [props.headerActions] - Rendered left of the close button.
 * @param {React.ReactNode} [props.stickyTop] - Non-scrolling area under the header.
 * @param {string} [props.bodyClassName]
 */
const Modal = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  size = 'xl',
  maxHeight = 'max-h-[90vh]',
  sheetOnMobile = false,
  headerActions,
  stickyTop,
  bodyClassName = 'px-5 sm:px-6 pb-6',
  children,
}) => {
  const panelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const titleId = useId();
  const descId = useId();

  /* Focus management + scroll lock, tied to the open state. */
  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll();

    // Defer one frame so the panel is in the DOM and measurable.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector(FOCUSABLE);
      if (first instanceof HTMLElement) first.focus();
      else panel.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      unlockBodyScroll();
      // Return focus to whatever opened the dialog.
      const target = restoreFocusRef.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center ${
        sheetOnMobile ? 'items-end sm:items-center sm:p-4' : 'items-center p-4 sm:p-6'
      }`}
    >
      <div
        className="absolute inset-0 bg-surface-900/40 dark:bg-surface-900/70 backdrop-blur-sm wizard-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full ${SIZES[size] || SIZES.xl} ${maxHeight}
          bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700
          shadow-pop dark:shadow-pop-dark wizard-panel overflow-hidden flex flex-col
          ${sheetOnMobile ? 'rounded-t-2xl sm:rounded-2xl' : 'rounded-2xl'}
          focus:outline-none`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-9 h-9 rounded-xl bg-accent-100 dark:bg-accent-900/50 border border-accent-200 dark:border-accent-700 flex items-center justify-center text-accent-600 dark:text-accent-300 flex-shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-base font-bold text-surface-800 dark:text-surface-50 truncate"
              >
                {title}
              </h2>
              {subtitle && (
                <p
                  id={descId}
                  className="text-[11px] text-surface-500 dark:text-surface-300 mt-0.5 truncate"
                >
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close dialog"
              className="p-2 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-50 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {stickyTop && <div className="flex-shrink-0">{stickyTop}</div>}

        {/* ── Scrollable body ── */}
        <div className={`overflow-y-auto flex-1 custom-scrollbar ${bodyClassName}`}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
