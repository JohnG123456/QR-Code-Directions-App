"use client";

import { useRef, useState } from "react";

// The box you type a site number into.
//
// Almost every site number is digits, and hundreds get typed in a
// sitting, so the number pad is what this asks for: bigger keys, no
// hunting, no shift. A handful of duplex blocks carry a letter - 087A -
// and a number pad has no letters on it, so there's a button to swap to
// the full keyboard for those.
//
// Swapping needs a blur and a refocus. A phone decides which keyboard to
// show when a field is focused and won't change it underneath you, so
// changing inputMode alone does nothing until the field is left and
// come back to - which looks exactly like a button that doesn't work.

export function SiteNumberInput({
  value,
  onChange,
  onEnter,
  onEscape,
  autoFocus,
  placeholder,
  ariaLabel,
  className = "w-32",
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Sticks for the rest of this entry, so typing 087A then 087B doesn't
  // mean pressing the button twice.
  const [letters, setLetters] = useState(false);

  function swapKeyboard() {
    const next = !letters;
    setLetters(next);
    const input = inputRef.current;
    if (!input) return;
    // Let the new inputMode land before asking for the keyboard again.
    input.blur();
    requestAnimationFrame(() => {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
          if (e.key === "Escape") onEscape?.();
        }}
        inputMode={letters ? "text" : "numeric"}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`${className} rounded border border-neutral-300 bg-white px-2 py-1 text-base text-neutral-900`}
      />
      <button
        type="button"
        onClick={swapKeyboard}
        aria-pressed={letters}
        title={
          letters
            ? "Back to the number pad"
            : "Show letters, for a duplex like 087A"
        }
        className={
          letters
            ? "shrink-0 rounded border border-[#702890] bg-[#702890] px-2 py-1 text-xs font-semibold text-white"
            : "shrink-0 rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-600"
        }
      >
        {letters ? "123" : "ABC"}
      </button>
    </span>
  );
}
