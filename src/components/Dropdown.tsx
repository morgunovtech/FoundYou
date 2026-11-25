import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * The family dropdown (`.v4-dropdown`): a toggle button and a panel of `menuitemradio` items —
 * the language menu and the theme menu of the bar. The markup is the contract of
 * `public/ds/v1/USAGE.md` («Service chrome»), and the behaviour is the one `ds/v1/chrome.js`
 * gives every other page of the family, written again only because React owns this DOM:
 *
 * - `.is-open` on the container, `aria-expanded` on the toggle; one menu open at a time;
 * - opened from the keyboard (Enter / Space), focus goes to the first item; opened with the
 *   pointer, it is parked on the toggle so Escape and the arrows work;
 * - ArrowUp / ArrowDown / Home / End move between items; Escape, a click outside, focus leaving
 *   and a pick all close it, and a pick or Escape hands focus back to the toggle;
 * - a focus the script put on the toggle after a pointer action carries `data-pointer-focus`
 *   (no ring: the visitor has just clicked there); any key press takes the mark off.
 */
export interface DropdownItem {
  value: string;
  label: string;
  checked: boolean;
  /** BCP-47 tag when the label is written in another language (the language menu). */
  lang?: string;
  /** A link item: the address of the same page in that language. Without it the item is a button. */
  href?: string;
}

interface DropdownProps {
  /** `lang` or `theme`: the container class `v4-<name>` and the ids `<name>-toggle`, `<name>-menu`. */
  name: 'lang' | 'theme';
  /** Toggle look: `v4-bar-btn v4-lang-btn` (text) or `v4-icon-btn` (icon only). */
  toggleClassName: string;
  toggleLabel: string;
  toggleChildren: React.ReactNode;
  menuClassName?: string;
  /** `v4-lang-link` or `v4-theme-btn`, next to `v4-menu-item`. */
  itemClassName: string;
  items: DropdownItem[];
  onSelect: (value: string) => void;
}

// What the visitor used last, for the whole page — the same two listeners as chrome.js.
let byPointer = false;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    () => {
      byPointer = true;
    },
    true
  );
  document.addEventListener(
    'keydown',
    () => {
      byPointer = false;
      document.querySelectorAll('.v4-dropdown > [data-pointer-focus]').forEach((el) => {
        el.removeAttribute('data-pointer-focus');
      });
    },
    true
  );
}

export const Dropdown: React.FC<DropdownProps> = ({
  name,
  toggleClassName,
  toggleLabel,
  toggleChildren,
  menuClassName,
  itemClassName,
  items,
  onSelect
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Set by a keyboard activation of the toggle; read once the panel is shown.
  const focusFirstRef = useRef(false);
  const toggleId = `${name}-toggle`;
  const menuId = `${name}-menu`;

  const focusToggle = useCallback((options?: FocusOptions) => {
    const toggle = toggleRef.current;
    if (!toggle) return;
    if (byPointer) toggle.setAttribute('data-pointer-focus', '');
    toggle.focus(options);
  }, []);

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button, a') ?? []);

  // Keyboard open: the first item takes focus once the panel is displayed.
  useEffect(() => {
    if (!open || !focusFirstRef.current) return;
    focusFirstRef.current = false;
    menuItems()[0]?.focus();
  }, [open]);

  // A click anywhere outside closes the menu — this is also what keeps one menu open at a time.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, [open]);

  // Safari and Firefox on macOS do not focus a button on mousedown: the press only blurs the
  // current focus, and the focus-out below would close the menu before the click lands.
  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (open || toggleRef.current?.contains(event.target as Node)) event.preventDefault();
  };

  const onToggleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const willOpen = !open;
    setOpen(willOpen);
    if (!willOpen) return;
    // detail 0 is a keyboard activation; a pointer click reports its count.
    if (event.detail === 0) {
      focusFirstRef.current = true;
    } else if (!rootRef.current?.contains(document.activeElement)) {
      focusToggle({ preventScroll: true });
    }
  };

  const onFocusOut = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      focusToggle();
      return;
    }
    const buttons = menuItems();
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (current + 1 + buttons.length) % buttons.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const pick = (value: string) => {
    onSelect(value);
    setOpen(false);
    focusToggle();
  };

  return (
    <div
      ref={rootRef}
      className={clsx('v4-dropdown', `v4-${name}`, { 'is-open': open })}
      onMouseDown={onMouseDown}
      onBlur={onFocusOut}
      onKeyDown={onKeyDown}
    >
      <button
        ref={toggleRef}
        id={toggleId}
        type="button"
        className={toggleClassName}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={toggleLabel}
        onClick={onToggleClick}
        onBlur={(event) => event.currentTarget.removeAttribute('data-pointer-focus')}
      >
        {toggleChildren}
      </button>
      <div ref={menuRef} id={menuId} className={clsx('v4-menu', menuClassName)} role="menu" aria-labelledby={toggleId}>
        {items.map((item) =>
          item.href ? (
            <a
              key={item.value}
              className={clsx('v4-menu-item', itemClassName)}
              role="menuitemradio"
              aria-checked={item.checked}
              href={item.href}
              hrefLang={item.lang}
              lang={item.lang}
              onClick={(event) => {
                // A plain click switches in place, so a loaded photo stays; a modified one
                // (new tab, new window) is the link it looks like.
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                pick(item.value);
              }}
            >
              {item.label}
            </a>
          ) : (
            <button
              key={item.value}
              type="button"
              className={clsx('v4-menu-item', itemClassName)}
              role="menuitemradio"
              data-theme-value={name === 'theme' ? item.value : undefined}
              aria-checked={item.checked}
              lang={item.lang}
              onClick={() => pick(item.value)}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </div>
  );
};

/** Chevron used by the text toggles; flips while the panel is open (CSS). */
export const Chevron: React.FC = () => (
  <svg
    className="v4-chevron"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 6l4 4 4-4" />
  </svg>
);
