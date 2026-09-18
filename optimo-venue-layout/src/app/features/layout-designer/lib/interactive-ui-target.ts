/** True when a pointer/keyboard event originated from a form or dialog control. */
export function isInteractiveUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const el =
    target instanceof HTMLElement
      ? target
      : target.parentElement instanceof HTMLElement
        ? target.parentElement
        : null;
  if (!el) {
    return false;
  }
  if (el.isContentEditable || el.closest('[contenteditable="true"]')) {
    return true;
  }
  const tag = el.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'OPTION' ||
    tag === 'LABEL' ||
    tag === 'DIALOG'
  ) {
    return true;
  }
  return Boolean(
    el.closest(
      'input, textarea, select, button, option, label, dialog, [contenteditable="true"], [role="dialog"], [role="slider"], [role="spinbutton"], [role="checkbox"], [role="radio"], [role="textbox"], [role="combobox"], [role="listbox"], [role="option"], [role="switch"], [role="menuitem"]',
    ),
  );
}
