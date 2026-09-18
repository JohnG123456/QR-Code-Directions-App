"use client";

import { useEffect } from "react";

// Makes a pressed button stay looking pressed.
//
// :active alone was not enough, and the reason is worth writing down. It
// only holds while the finger is down. Lift it and the button reverts -
// and the gap between lifting your finger and the server answering is
// precisely the gap where nothing on screen says the tap registered. That
// is where the second and third presses come from. A flash is not an
// acknowledgement; it is over before you have looked up.
//
// So the press latches: the button keeps a changed colour for a beat
// after release, whether or not anything else has happened yet. Long
// enough to bridge a slow response, short enough not to look stuck.
//
// One delegated listener rather than a change to each of the seventy-odd
// buttons - and it stays right for buttons added later, which a
// per-button prop would not.

/** How long a press stays visible after the finger comes up. Tuned for a
 *  slow connection: it has to outlast the silence, not the request. */
const HOLD_MS = 900;

export function PressFeedback() {
  useEffect(() => {
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

    function mark(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button, [role='button']");
      if (!button || button.matches(":disabled")) return;

      button.setAttribute("data-pressed", "");

      const existing = timers.get(button);
      if (existing) clearTimeout(existing);
      timers.set(
        button,
        setTimeout(() => {
          button.removeAttribute("data-pressed");
          timers.delete(button);
        }, HOLD_MS)
      );
    }

    // pointerdown rather than click: the point is to answer the finger
    // going down, not to wait for the browser to decide a click happened.
    document.addEventListener("pointerdown", mark, true);
    return () => document.removeEventListener("pointerdown", mark, true);
  }, []);

  return null;
}
