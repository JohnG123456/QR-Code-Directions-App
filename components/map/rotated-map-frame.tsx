"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Turns the map so that walking into the resort is up the page.
//
// Leaflet has no rotation of its own, so the whole map is rotated with a
// CSS transform. Two consequences have to be handled rather than hoped
// away.
//
// The rotated square has to be big enough that its corners still cover
// the visible box - a square of side hypot(w, h) always does, at any
// angle - and it's centred, so the middle of the map stays the middle of
// the frame however far it's turned.
//
// And Leaflet's own dragging reads pointer positions straight out of the
// container's bounding box, which for a rotated element is the enclosing
// upright rectangle, not the rotated one. Panning would drift off at an
// angle. So Leaflet's dragging is switched off by the map itself and
// replaced here: the pointer movement is rotated back into the map's
// frame before being handed over, which makes a drag follow the finger
// exactly. Zooming is set to zoom about the centre for the same reason -
// zoom-to-cursor would need the same correction and the centre is what a
// visitor wants anyway.

export interface PanTarget {
  panBy(dx: number, dy: number): void;
}

export function RotatedMapFrame({
  bearingDeg,
  panTarget,
  children,
  className,
}: {
  /** Compass bearing to draw straight up. 0 leaves the map north-up. */
  bearingDeg: number;
  /** The map to pan when a drag happens; null while it's still mounting. */
  panTarget: PanTarget | null;
  /** Given the visible frame's size, so the map inside can work out how
   *  much of its own square is actually on screen. */
  children: (frame: { width: number; height: number; safeInset: number }) => ReactNode;
  className?: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // The inner square is measured from the frame, so it has to be watched
  // rather than read once: phones rotate, and the address bar changes
  // the height on scroll.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setSize({ w: frame.clientWidth, h: frame.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Drag, corrected for the rotation.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !panTarget) return;

    let pointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const radians = (bearingDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    function onPointerDown(event: PointerEvent) {
      // Only a plain drag: a second finger is a pinch, which Leaflet
      // handles itself.
      if (pointerId !== null || !event.isPrimary) return;
      pointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId || !panTarget) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      // Screen movement, turned back into the map's own frame. Negated
      // because dragging the map right moves the view left.
      panTarget.panBy(-(dx * cos - dy * sin), -(dx * sin + dy * cos));
    }

    function onPointerUp(event: PointerEvent) {
      if (event.pointerId === pointerId) pointerId = null;
    }

    frame.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      frame.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [panTarget, bearingDeg]);

  // Side of the square that covers the frame at every angle.
  const side = size ? Math.ceil(Math.hypot(size.w, size.h)) : 0;

  // How much of that square is off-screen, whatever the angle.
  //
  // The visible area is the frame rectangle sitting at an angle inside
  // the square, so the only region guaranteed to be on screen at every
  // rotation is the circle of diameter min(width, height) about the
  // centre. Anything fitted to the square's full extent would put the
  // ends of the walk out of sight - which is how a route map quietly
  // stops showing you where you're going.
  const safeInset = size ? Math.max(0, (side - Math.min(size.w, size.h)) / 2) : 0;

  return (
    <div ref={frameRef} className={`relative overflow-hidden ${className ?? ""}`}>
      {size && (
        <div
          style={{
            position: "absolute",
            width: side,
            height: side,
            left: (size.w - side) / 2,
            top: (size.h - side) / 2,
            transform: `rotate(${-bearingDeg}deg)`,
            transformOrigin: "50% 50%",
          }}
        >
          {children({ width: size.w, height: size.h, safeInset })}
        </div>
      )}
    </div>
  );
}
