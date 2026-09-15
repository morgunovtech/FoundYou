import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * The design-system dropdown (`.v4-dropdown`): a toggle button plus a paper
 * panel of `menuitemradio` buttons. Behaviour mirrors morgunov.tech/script.js:
 * `.is-open` on the container and `aria-expanded` on the toggle; closes on
 * Escape, outside pointer, focus leaving, or a pick; ArrowUp/Down/Home/End
 * move between items; focus returns to the toggle on close.
 */
export interface DropdownItem {
  value: string;
  label: string;
  checked: boolean;
  /** BCP-47 tag when the label is written in another language (language menu). */
  lang?: string;
}

interface DropdownProps {
  /** Extra class on the container: `v4-lang` or `v4-theme`. */
  className: string;
  /** Toggle look: `v4-bar-btn` (text) or `v4-icon-btn` (icon only). */
  toggleClassName: string;
  toggleLabel: string;
  toggleChildren: React.ReactNode;
  menuClassName?: string;
  items: DropdownItem[];
  onSelect: (value: string) => void;
}

export const Dropdown: React.FC<DropdownProps> = ({
  className,
  toggleClassName,
  toggleLabel,
  toggleChildren,
  menuClassName,
  items,
  onSelect
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reactId = useId().replace(/:/g, '');
  const toggleId = `dd-toggle-${reactId}`;
  const menuId = `dd-menu-${reactId}`;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // Focus the checked item (or the first) once the panel is shown.
  useEffect(() => {
    if (!open) return;
    const checkedIndex = Math.max(0, items.findIndex((item) => item.checked));
    itemRefs.current[checkedIndex]?.focus();
  }, [open, items]);

  // Outside pointer and focus leaving the component both close it.
  useEffect(() => {
    if (!open) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) close(false);
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !root.contains(next)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('focusout', onFocusOut);
    };
  }, [open, close]);

  const onToggleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = itemRefs.current.filter((el): el is HTMLButtonElement => Boolean(el));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = current < buttons.length - 1 ? current + 1 : 0;
        break;
      case 'ArrowUp':
        next = current > 0 ? current - 1 : buttons.length - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'Tab':
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div ref={rootRef} className={clsx('v4-dropdown', className, { 'is-open': open })}>
      <button
        ref={toggleRef}
        id={toggleId}
        type="button"
        className={toggleClassName}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={toggleLabel}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onToggleKeyDown}
      >
        {toggleChildren}
      </button>
      <div
        id={menuId}
        className={clsx('v4-menu', menuClassName)}
        role="menu"
        aria-labelledby={toggleId}
        onKeyDown={onMenuKeyDown}
      >
        {items.map((item, index) => (
          <button
            key={item.value}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            className="v4-menu-item"
            role="menuitemradio"
            aria-checked={item.checked}
            lang={item.lang}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onSelect(item.value);
              close(true);
            }}
          >
            {item.label}
          </button>
        ))}
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
