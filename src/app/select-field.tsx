"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type Option = { value: string; label: string; description?: string };

/** Select-only combobox: focus stays on its trigger while the list is open. */
export function SelectField({
  id,
  labelId,
  value,
  options,
  onChange,
  disabled = false,
  hint,
}: {
  id: string;
  labelId: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const searchRef = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ above: false, height: 280 });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const expanded = open && !disabled;
  const listId = `${id}-listbox`;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function show(index = selected) {
    if (disabled || !options.length) return;
    searchRef.current = { text: "", at: 0 };
    setActive(index);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (disabled || !option) return;
    if (option.value !== value) onChange(option.value);
    setOpen(false);
  }

  useEffect(() => {
    if (!expanded) return;
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const useAbove = below < 260 && above > below;
      setPlacement({
        above: useAbove,
        height: Math.max(80, Math.min(320, useAbove ? above : below)),
      });
    };
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    position();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    // Scroll only the option list, never the document underneath it.
    const option = optionRefs.current[active];
    const list = option?.parentElement;
    if (!option || !list) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (
      option.offsetTop + option.offsetHeight >
      list.scrollTop + list.clientHeight
    ) {
      list.scrollTop =
        option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [active, expanded, placement.height]);

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || !options.length) return;
    const last = options.length - 1;
    if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    } else if (event.key === "Tab") {
      if (expanded) choose(active);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(active);
      else show();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.altKey && event.key === "ArrowUp" && expanded) {
        choose(active);
        return;
      }
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : expanded
              ? Math.max(
                  0,
                  Math.min(last, active + (event.key === "ArrowDown" ? 1 : -1)),
                )
              : selected;
      if (expanded) setActive(index);
      else show(index);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now();
      const search =
        now - searchRef.current.at < 700
          ? searchRef.current.text + event.key
          : event.key;
      searchRef.current = { text: search, at: now };
      const repeated = search
        .split("")
        .every((letter) => letter.toLowerCase() === search[0].toLowerCase());
      const query = (repeated ? search[0] : search).toLowerCase();
      const start = repeated
        ? (expanded ? active : selected) + 1
        : expanded
          ? active
          : selected;
      const index = Array.from(
        { length: options.length },
        (_, offset) => (start + offset) % options.length,
      ).find((i) => options[i].label.toLowerCase().startsWith(query));
      if (index !== undefined) {
        if (!expanded) setOpen(true);
        setActive(index);
      }
    }
  }

  return (
    <div
      className="select-field"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-labelledby={`${labelId} ${id}-value`}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={expanded ? `${id}-option-${active}` : undefined}
        disabled={disabled || !options.length}
        onClick={() => (expanded ? setOpen(false) : show())}
        onKeyDown={handleKey}
      >
        <span id={`${id}-value`}>
          {options[selected]?.label || "No options available"}
        </span>
        <svg
          className="select-chevron"
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m5 8 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {expanded && (
        <div
          className={`select-popover${placement.above ? " select-popover-above" : ""}`}
          style={{ maxHeight: placement.height }}
        >
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            className="select-options"
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`select-option${active === index ? " is-active" : ""}`}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  choose(index);
                  triggerRef.current?.focus({ preventScroll: true });
                }}
              >
                <span>
                  <span className="select-option-label">{option.label}</span>
                  {option.description && (
                    <span className="select-option-description">
                      {option.description}
                    </span>
                  )}
                </span>
                {option.value === value && (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m4 10 4 4 8-8"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </li>
            ))}
          </ul>
          {hint && <p className="select-hint">{hint}</p>}
        </div>
      )}
    </div>
  );
}
