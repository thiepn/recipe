import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '+
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function availableDialogControls(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element =>
    element.getClientRects().length > 0 &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]'),
  );
}

/** Shared focus custody for modal sheets. No click/keyboard access to background actions.
 * All callbacks remain current across async saves; Escape is denied while a write runs.
 */
export function useAccessibleDialog<T extends HTMLElement>(
  active: boolean, onDismiss: (() => void) | null,
  options: { busy?: boolean; initialFocus?: string; focusOnMount?: boolean } = {},
): RefObject<T | null> {
  const elementRef = useRef<T>(null);
  const callbackRef = useRef(onDismiss);
  callbackRef.current = onDismiss;
  const blockedRef = useRef(options.busy === true);
  blockedRef.current = options.busy === true;
  useEffect(() => {
    if (!active) return;
    const dialog = elementRef.current;
    if (!dialog) return;
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (options.focusOnMount !== false) {
      const preferred = options.initialFocus
        ? dialog.querySelector<HTMLElement>(options.initialFocus)
        : null;
      const first = availableDialogControls(dialog)[0];
      (preferred ?? first ?? dialog).focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!dialog.isConnected) return;
      if (event.key === 'Escape' && callbackRef.current && !event.defaultPrevented) {
        if (blockedRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        callbackRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = availableDialogControls(dialog);
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      const focused = document.activeElement;
      if (!dialog.contains(focused)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && focused === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Do not steal focus from a newly opened modal when one sheet replaces another.
      if (!document.querySelector('[role="dialog"][aria-modal="true"]') && prior?.isConnected)
        prior.focus();
    };
    // The current callbacks and busy state are maintained in refs without re-arming custody.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return elementRef;
}
