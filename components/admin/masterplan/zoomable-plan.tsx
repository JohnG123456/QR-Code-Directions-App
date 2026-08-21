"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Pan/zoom viewer for the master plan image.
//
// A large-format architectural sheet squeezed to phone width is ~6x
// downscaled, which makes both jobs it's used for impossible without
// zoom: reading site numbers against the drawing underneath (review
// step), and clicking an exact reference point (calibration step).
//
// The image is CSS-transformed; overlay markers are positioned in
// container/screen coordinates instead of being nested inside the
// transform, so they keep a constant on-screen size at any zoom level
// rather than ballooning as you zoom in.

export interface PlanTransform {
  x: number;
  y: number;
  k: number;
}

export interface ZoomablePlanProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  className?: string;
  /** Fires only for taps/clicks, never at the end of a pan or pinch. */
  onPointClick?: (point: { x: number; y: number }) => void;
  /** Maps a point in image coordinates to container coordinates. */
  renderOverlay?: (toScreen: (p: { x: number; y: number }) => { x: number; y: number }) => React.ReactNode;
}

const MAX_ZOOM = 12;
const MIN_ZOOM_FACTOR = 0.8; // relative to the fit-to-width scale
const TAP_MOVE_TOLERANCE_PX = 6;

export function ZoomablePlan({
  imageUrl,
  imageWidth,
  imageHeight,
  className,
  onPointClick,
  renderOverlay,
}: ZoomablePlanProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<PlanTransform>({ x: 0, y: 0, k: 1 });
  const [fitScale, setFitScale] = useState(1);

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; k: number } | null>(null);
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);

  const fitToWidth = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const k = container.clientWidth / imageWidth;
    setFitScale(k);
    setTransform({ x: 0, y: (container.clientHeight - imageHeight * k) / 2, k });
  }, [imageWidth, imageHeight]);

  useEffect(() => {
    fitToWidth();
    window.addEventListener("resize", fitToWidth);
    return () => window.removeEventListener("resize", fitToWidth);
  }, [fitToWidth]);

  const clampZoom = useCallback(
    (k: number) => Math.min(MAX_ZOOM, Math.max(fitScale * MIN_ZOOM_FACTOR, k)),
    [fitScale]
  );

  // Zooms so the image point currently under `anchor` stays under it.
  const zoomAbout = useCallback(
    (anchor: { x: number; y: number }, nextK: number) => {
      setTransform((t) => {
        const k = clampZoom(nextK);
        return {
          k,
          x: anchor.x - ((anchor.x - t.x) / t.k) * k,
          y: anchor.y - ((anchor.y - t.y) / t.k) * k,
        };
      });
    },
    [clampZoom]
  );

  function containerPoint(e: { clientX: number; clientY: number }) {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = containerPoint(e);
    pointersRef.current.set(e.pointerId, point);
    if (pointersRef.current.size === 1) {
      movedRef.current = false;
      gestureStartRef.current = point;
    }
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: transform.k };
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;

    const previous = pointers.get(e.pointerId)!;
    const current = containerPoint(e);
    pointers.set(e.pointerId, current);

    // Compare against where the gesture started, not the previous frame:
    // a tap always carries a little finger wobble, and treating every
    // sub-pixel jitter as a drag would swallow taps entirely.
    const start = gestureStartRef.current;
    if (
      start &&
      Math.hypot(current.x - start.x, current.y - start.y) > TAP_MOVE_TOLERANCE_PX
    ) {
      movedRef.current = true;
    }

    if (pointers.size === 1) {
      setTransform((t) => ({
        ...t,
        x: t.x + (current.x - previous.x),
        y: t.y + (current.y - previous.y),
      }));
      return;
    }

    if (pointers.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAbout(midpoint, pinchRef.current.k * (dist / pinchRef.current.dist));
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const wasSinglePointer = pointersRef.current.size === 1;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;

    if (wasSinglePointer && !movedRef.current && onPointClick) {
      const p = containerPoint(e);
      onPointClick({
        x: (p.x - transform.x) / transform.k,
        y: (p.y - transform.y) / transform.k,
      });
    }
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    zoomAbout(containerPoint(e), transform.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }

  function zoomByButton(factor: number) {
    const container = containerRef.current;
    if (!container) return;
    zoomAbout(
      { x: container.clientWidth / 2, y: container.clientHeight / 2 },
      transform.k * factor
    );
  }

  const toScreen = (p: { x: number; y: number }) => ({
    x: p.x * transform.k + transform.x,
    y: p.y * transform.k + transform.y,
  });

  return (
    <div className="relative w-full min-w-0 max-w-full">
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        className={
          className ??
          "relative h-[70vh] w-full touch-none overflow-hidden rounded-md border border-neutral-300 bg-neutral-100"
        }
      >
        {/* Absolutely positioned so its full-resolution layout width (often
            2000px+) never contributes to ancestor sizing. In flow it blows
            the page out sideways: flex items default to min-width:auto, so
            flex-column ancestors refuse to shrink below it and the whole
            layout ends up far wider than a phone screen. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Master plan"
          draggable={false}
          style={{
            width: imageWidth,
            height: imageHeight,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
            transformOrigin: "0 0",
          }}
          className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
        />
        {renderOverlay?.(toScreen)}
      </div>

      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => zoomByButton(1.5)}
          className="h-8 w-8 rounded-md border border-neutral-300 bg-white text-lg leading-none shadow-sm"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomByButton(1 / 1.5)}
          className="h-8 w-8 rounded-md border border-neutral-300 bg-white text-lg leading-none shadow-sm"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={fitToWidth}
          className="h-8 w-8 rounded-md border border-neutral-300 bg-white text-[10px] leading-none shadow-sm"
          aria-label="Fit to width"
        >
          Fit
        </button>
      </div>
    </div>
  );
}
