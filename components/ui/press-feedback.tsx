"use client";

import { useEffect } from "react";

// Makes a pressed button stay looking pressed until its work is done.
//
// :active only holds while the finger is down, and a fixed timeout only
// guesses. Both leave the same gap: the stretch between lifting a finger
// and a slow server answering, where nothing on screen says the tap
// landed. That gap is where the second and third presses come from.
//
// So the mark is held against the button's own busy state rather than a
// clock. Almost everything here disables itself while it works - that is
// what the pending labels added alongside this are attached to - so
// "still disabled" is a reliable stand-in for "still going", and it needs
// no cooperation from the seventy-odd buttons themselves.
//
// Three rules, in order:
//   - a minimum, so an instant action still visibly acknowledges the tap
//     rather than flickering;
//   - then held for as long as the button is disabled;
//   - and a backstop, because a button that latches forever because
//     something threw is worse than one that lets go early.

/** Even an instant action holds this long, so the press is seen. */
const MIN_HOLD_MS = 600;

/** Nothing stays marked past this, whatever the page is doing. */
const MAX_HOLD_MS = 20000;

const PRESSABLE = "button, [role='button'], a[data-press]";

function isBusy(button: Element): boolean {
  return button.matches(":disabled") || button.getAttribute("aria-disabled") === "true";
}

export function PressFeedback() {
  useEffect(() => {
    // One release function per button, so pressing the same button again
    // tears down the previous watch rather than leaving it running.
    const watching = new WeakMap<Element, () => void>();

    function mark(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Links marked data-press count too. The top of every admin page
      // is a row of things that look like buttons and are <Link>s, which
      // is why the first version of this appeared to do nothing there -
      // and they are the slowest taps in the app, because each one is a
      // whole page.
      const button = target.closest(PRESSABLE);
      if (!button || isBusy(button)) return;

      watching.get(button)?.();

      const pressedAt = Date.now();
      button.setAttribute("data-pressed", "");

      const release = () => {
        clearTimeout(minTimer);
        clearTimeout(backstop);
        observer.disconnect();
        watching.delete(button);
        button.removeAttribute("data-pressed");
      };

      const settle = () => {
        if (Date.now() - pressedAt < MIN_HOLD_MS) return;
        if (isBusy(button)) return;
        release();
      };

      // Watches the button go disabled and come back. Attributes only -
      // this must not be watching a subtree while someone is tapping
      // around a map.
      const observer = new MutationObserver(settle);
      observer.observe(button, {
        attributes: true,
        attributeFilter: ["disabled", "aria-disabled"],
      });

      const minTimer = setTimeout(settle, MIN_HOLD_MS);
      const backstop = setTimeout(release, MAX_HOLD_MS);

      watching.set(button, release);
    }

    // pointerdown, not click: this answers the finger going down rather
    // than waiting for the browser to decide a click happened.
    document.addEventListener("pointerdown", mark, true);
    return () => document.removeEventListener("pointerdown", mark, true);
  }, []);

  return null;
}
