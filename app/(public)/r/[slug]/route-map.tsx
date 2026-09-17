"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  bearingDegrees,
  bearingToCompass,
  distanceMeters,
  estimatedWalkSeconds,
  formatDistance,
  formatWalkTime,
} from "@/lib/geo/distance";
import type { PublicResort, PublicSite } from "@/lib/types";
import type { PlanOverlayPlacement } from "@/lib/masterplan/published-overlay";
import type { BoundaryRings } from "@/components/map/outside-mask";
import { compareSiteNumbers, normaliseSiteNumber } from "@/lib/sites/site-number";
import {
  useLiveDirections,
  type LiveDirections,
} from "@/lib/navigation/use-live-directions";
import type { LiveFix } from "@/lib/navigation/use-live-position";

interface RouteResult {
  distanceM: number;
  points: [number, number][];
}

// How much of the plan drawing is shown, per view.
//
// The plan at full strength is the default. It is the drawing that
// carries the site numbers and the street names, and it is what the
// resort's own signage and paperwork look like - so it is what a guest
// is most likely to recognise. The imagery underneath is still one tap
// away for anyone who wants to see what the place actually looks like.
const PLAN_VIEWS = {
  plan: 1,
  both: 0.75,
  satellite: 0,
} as const;

type PlanView = keyof typeof PLAN_VIEWS;

// How long the page will hold the finished map back while it waits for
// the plan drawing and the walking route.
//
// Showing the map the moment it can be shown meant a guest watched it
// assemble itself: satellite imagery, then a straight line to the site,
// then the drawing on top, then the line snapping onto the roads. Every
// one of those is the page working correctly, and all of them together
// read as something broken. So the pieces are gathered behind a plain
// screen and arrive at once.
//
// Capped, though, because a held screen with nothing behind it is worse
// than a plain one. If the route or the drawing is slow, the map appears
// as it used to and finishes assembling in the open - the same behaviour
// as before, just rarer.
const REVEAL_TIMEOUT_MS = 6000;

const PLAN_VIEW_LABELS: Record<PlanView, string> = {
  plan: "Site plan",
  both: "Both",
  satellite: "Satellite",
};

// The position simulator, and only where it has been switched on.
//
// NEXT_PUBLIC_ variables are fixed at build time, so a deployment either
// has the panel or it cannot have it: the value cannot be changed from a
// browser, a URL or a request header. In a build without it the constant
// below is false, the dynamic import is never called, and the panel's
// chunk - which is still emitted - is never requested by anything. Set
// it on Vercel's Preview environment and nowhere else; see "Testing live
// directions" in the README.
const POSITION_SIM_ENABLED = process.env.NEXT_PUBLIC_POSITION_SIM === "1";

const PositionSimulator = POSITION_SIM_ENABLED
  ? dynamic(() => import("./position-simulator").then((m) => m.PositionSimulator), {
      ssr: false,
    })
  : null;

// react-leaflet touches `window`/`document` at import time, so the map
// itself must be excluded from the server render.
const LeafletRouteView = dynamic(
  () => import("./leaflet-route-view").then((m) => m.LeafletRouteView),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-neutral-100" /> }
);

export function RouteMap({
  resort,
  sites,
  plan,
  planImageUrl,
  bearingDeg,
  boundary,
}: {
  resort: PublicResort;
  sites: PublicSite[];
  /** The published master plan, when this resort has one. */
  plan: PlanOverlayPlacement | null;
  planImageUrl: string | null;
  /** Compass bearing drawn straight up, so walking in is up the page. */
  bearingDeg: number;
  /** The resort's outline; everything outside it is greyed out. */
  boundary: BoundaryRings;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeState, setRouteState] = useState<"idle" | "loading" | "done">("idle");
  const [planView, setPlanView] = useState<PlanView>("plan");
  // A resort with no published plan has nothing to wait for.
  const [planImageReady, setPlanImageReady] = useState(planImageUrl === null);
  const [revealTimedOut, setRevealTimedOut] = useState(false);

  // Fetched on arrival rather than when a site is picked, so it is
  // usually already in the browser's cache by the time anyone has
  // finished typing a number. `window.Image` because `Image` in this
  // file is next/image.
  useEffect(() => {
    if (!planImageUrl) return;
    const image = new window.Image();
    // Loaded or failed, the wait is over either way: a drawing that
    // won't load is a reason to show the satellite view, not a reason to
    // hold a guest at a blank screen.
    image.onload = () => setPlanImageReady(true);
    image.onerror = () => setPlanImageReady(true);
    image.src = planImageUrl;
  }, [planImageUrl]);

  // Gives up on its own, once per site looked up.
  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => setRevealTimedOut(true), REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [selectedId]);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    // Site numbers are written with their leading zeros, but nobody
    // types them: someone looking for 13 wants 013, and wants it at the
    // top rather than below 130 and 131.
    const exact = normaliseSiteNumber(query)?.toLowerCase() ?? null;

    return sites
      .filter(
        (s) =>
          s.site_number.toLowerCase().includes(q) ||
          s.label?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const aExact = exact !== null && a.site_number.toLowerCase() === exact;
        const bExact = exact !== null && b.site_number.toLowerCase() === exact;
        if (aExact !== bExact) return aExact ? -1 : 1;
        return compareSiteNumbers(a.site_number, b.site_number);
      })
      .slice(0, 8);
  }, [query, sites]);

  const selectedSite = sites.find((s) => s.id === selectedId) ?? null;

  // Live directions: off until the visitor asks for them, because they
  // cost a location permission and keep the screen awake, and most
  // guests scanning at the gate just want to see the map.
  //
  // With the simulator switched on, the fake fix is handed over in place
  // of the receiver's - which also stops the page ever asking for a
  // location permission it is not going to use.
  const [simFix, setSimFix] = useState<LiveFix | null>(null);
  const live = useLiveDirections(
    selectedId,
    selectedSite && selectedSite.lat !== null && selectedSite.lng !== null
      ? { lat: selectedSite.lat, lng: selectedSite.lng }
      : null,
    POSITION_SIM_ENABLED ? { fix: simFix } : null
  );

  // Ask for a route along the actual roads. Until it comes back - and if
  // it never does, because this resort's network hasn't been traced or
  // doesn't reach this site - the straight line still shows, which is
  // rough but genuinely usable at resort scale.
  async function loadRoute(siteId: string) {
    if (!resort.is_routable) {
      setRouteState("done");
      return;
    }
    setRoute(null);
    setRouteState("loading");
    try {
      const response = await fetch(`/api/route?site=${encodeURIComponent(siteId)}`);
      const data = (await response.json()) as { route?: RouteResult | null };
      setRoute(response.ok ? data.route ?? null : null);
    } catch {
      setRoute(null);
    } finally {
      setRouteState("done");
    }
  }

  const hasEntrance = resort.entrance_lat !== null && resort.entrance_lng !== null;
  const summary =
    selectedSite && hasEntrance
      ? (() => {
          const from = { lat: resort.entrance_lat!, lng: resort.entrance_lng! };
          const to = { lat: selectedSite.lat!, lng: selectedSite.lng! };
          const meters = distanceMeters(from, to);
          const bearing = bearingDegrees(from, to);
          return {
            distance: formatDistance(meters),
            walkTime: formatWalkTime(estimatedWalkSeconds(meters)),
            compass: bearingToCompass(bearing),
          };
        })()
      : null;

  // Everything the finished map needs is either here or it isn't coming.
  const preparing =
    selectedSite !== null &&
    hasEntrance &&
    !revealTimedOut &&
    (routeState !== "done" || !planImageReady);

  function reset() {
    live.stop();
    setQuery("");
    setSelectedId(null);
    setRoute(null);
    setRouteState("idle");
    setRevealTimedOut(false);
  }

  return (
    // Fixed to the viewport height, not a minimum, so the map fills what
    // is left rather than sizing itself and leaving white space below.
    // dvh rather than vh accounts for the browser's own address bar.
    <div className="flex h-dvh flex-col overflow-hidden bg-white">
      <Header resortName={resort.name} />

      <div className="relative shrink-0 px-4 pt-3">
        <label htmlFor="site-search" className="sr-only">
          Your site number
        </label>
        <input
          id="site-search"
          type="text"
          inputMode="numeric"
          placeholder="Enter your site number"
          value={query}
          onChange={(e) => {
            // Typing here clears the chosen site, so it also ends any
            // trip in progress: following someone to a destination they
            // have just abandoned is worse than not following them.
            live.stop();
            setQuery(e.target.value);
            setSelectedId(null);
            setRoute(null);
            setRouteState("idle");
            setRevealTimedOut(false);
          }}
          autoFocus
          className="w-full rounded-lg border-2 border-[#702890]/25 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-[#702890] focus:outline-none"
        />
        {matches.length > 0 && !selectedSite && (
          <ul className="absolute inset-x-4 top-full z-[1000] mt-1 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
            {matches.map((site) => (
              <li key={site.id}>
                <button
                  type="button"
                  onClick={() => {
                    live.stop();
                    setSelectedId(site.id);
                    setQuery(site.site_number);
                    setRevealTimedOut(false);
                    void loadRoute(site.id);
                  }}
                  className="flex w-full justify-between px-4 py-3 text-left text-neutral-900 hover:bg-[#702890]/5"
                >
                  <span className="font-semibold">Site {site.site_number}</span>
                  {site.label && (
                    <span className="text-sm text-neutral-500">{site.label}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() !== "" && matches.length === 0 && !selectedSite && (
          <p className="mt-2 text-sm text-neutral-500">
            No site {query.trim()} here. Check the number you were given, or ask
            at reception.
          </p>
        )}
      </div>

      {!selectedSite && <Instructions />}

      {selectedSite && hasEntrance && (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pt-3">
            {live.active && live.arrived ? (
              <p className="text-[15px] font-semibold text-[#15803d]">
                You&apos;ve arrived at Site {selectedSite.site_number}.
              </p>
            ) : live.active && live.remainingM !== null ? (
              <p className="text-[15px] text-neutral-800">
                <strong className="text-[#702890]">
                  {formatDistance(live.remainingM)}
                </strong>{" "}
                to go to Site {selectedSite.site_number}. Follow the purple
                line.
              </p>
            ) : live.active ? (
              <p className="text-[15px] text-neutral-800">
                Finding your position…
              </p>
            ) : route ? (
              <p className="text-[15px] text-neutral-800">
                Site {selectedSite.site_number} is a{" "}
                <strong className="text-[#702890]">
                  {formatDistance(route.distanceM)}
                </strong>{" "}
                walk from the entrance, about{" "}
                {formatWalkTime(estimatedWalkSeconds(route.distanceM))}. Follow
                the purple line.
              </p>
            ) : (
              summary && (
                <p className="text-[15px] text-neutral-800">
                  Site {selectedSite.site_number} is about{" "}
                  <strong className="text-[#702890]">{summary.distance}</strong>{" "}
                  {summary.compass} of the entrance (~{summary.walkTime} walk, in
                  a straight line).
                  {routeState === "loading" && " Finding the walking route…"}
                </p>
              )
            )}
            <LiveNotice live={live} />
          </div>

          {/* Offered only where there is a road network to follow: on a
              resort without one the route is a straight line, and a dot
              creeping along a line that ignores the roads would be a
              worse thing to drive by than the map on its own. */}
          {resort.is_routable && !live.unsupportedByServer && (
            <div className="shrink-0 px-4 pt-2">
              <button
                type="button"
                onClick={live.active ? live.stop : live.start}
                aria-pressed={live.active}
                className={
                  live.active
                    ? "w-full rounded-lg border-2 border-[#702890] px-4 py-2.5 text-[15px] font-medium text-[#702890]"
                    : "w-full rounded-lg bg-[#702890] px-4 py-2.5 text-[15px] font-medium text-white"
                }
              >
                {live.active ? "Stop following me" : "Follow me as I go"}
              </button>
              {/* Said before they start, not after. The whole point of
                  this feature is that it is used in a moving car, and
                  the resort's own roads have residents walking on them. */}
              <p className="mt-1.5 text-[13px] leading-snug text-neutral-500">
                {live.active
                  ? "Keep this page open — your phone stops tracking if you lock the screen or switch apps."
                  : "Start this before you set off, and let a passenger watch it if you can. Please don't read it at the wheel."}
              </p>
            </div>
          )}

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 py-2">
            {plan &&
              (Object.keys(PLAN_VIEWS) as PlanView[]).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setPlanView(view)}
                  aria-pressed={planView === view}
                  className={
                    planView === view
                      ? "rounded-full bg-[#702890] px-3.5 py-1.5 text-sm font-medium text-white"
                      : "rounded-full border border-neutral-300 px-3.5 py-1.5 text-sm text-neutral-700"
                  }
                >
                  {PLAN_VIEW_LABELS[view]}
                </button>
              ))}
            <button
              type="button"
              onClick={reset}
              className="ml-auto rounded-full border border-neutral-300 px-3.5 py-1.5 text-sm text-neutral-700"
            >
              Another site
            </button>
          </div>

          <div className="min-h-0 flex-1">
            <LeafletRouteView
              entrance={{ lat: resort.entrance_lat!, lng: resort.entrance_lng! }}
              site={{ lat: selectedSite.lat!, lng: selectedSite.lng! }}
              zoom={resort.default_zoom}
              // The live route when there is one, and the route from the
              // entrance until then - so turning following on never
              // takes the line away while the first fix is coming in.
              routePoints={
                (live.active ? live.route?.points : null) ?? route?.points ?? null
              }
              siteLabel={`Site ${selectedSite.site_number}`}
              plan={plan}
              planImageUrl={planImageUrl}
              planOpacity={PLAN_VIEWS[planView]}
              bearingDeg={bearingDeg}
              boundary={boundary}
              livePosition={live.active ? live.fix?.position ?? null : null}
              liveAccuracyM={live.active ? live.fix?.accuracyM ?? null : null}
              liveHeadingDeg={live.active ? live.fix?.headingDeg ?? null : null}
              // Kept on through arrival. Handing the map back to the
              // fit-the-whole-route framing at the moment someone pulls
              // up would zoom out to show the journey they have just
              // finished, which is the opposite of settling; a stopped
              // car stops moving the map by itself.
              followLive={live.active}
            />
          </div>

          {/* Walks along the route from the entrance rather than the
              live one: the live route is being recomputed underneath,
              and a test rig that moves its subject because its subject
              moved proves nothing. */}
          {PositionSimulator && (
            <PositionSimulator
              routePoints={
                route?.points ?? [
                  [resort.entrance_lat!, resort.entrance_lng!],
                  [selectedSite.lat!, selectedSite.lng!],
                ]
              }
              onFix={setSimFix}
              running={live.active}
            />
          )}

          {/* Over the map and the line above it, under the search
              results, which stay usable throughout. */}
          {preparing && <Preparing siteNumber={selectedSite.site_number} />}
        </div>
      )}

      {selectedSite && !hasEntrance && (
        <p className="px-4 py-3 text-sm text-amber-700">
          This resort hasn&apos;t set an entrance point yet, so we can&apos;t
          show directions. Please ask at reception.
        </p>
      )}
    </div>
  );
}

// What live directions have to say for themselves, when that is
// anything.
//
// Every one of these is a case where the dot on the map would otherwise
// be silently wrong or silently missing, and a guest driving through a
// resort looking for a house has no way to tell those apart from the map
// simply being slow. Each says what happened and what is being shown
// instead.
function LiveNotice({ live }: { live: LiveDirections }) {
  if (!live.active && live.message === null) return null;

  const notice = (() => {
    // Refused, or never answered. The watch is already stopped.
    if (live.message !== null) return live.message;

    if (!live.active) return null;

    if (live.coarse) {
      return "Your phone is only giving a rough position, so we can't tell which road you're on. Turn on precise location (Android: Settings → Location → Google Location Accuracy) or follow the route from the entrance.";
    }
    if (live.unplaced) {
      return "We can't place you on a road at this resort just now, so this is the route from the entrance.";
    }
    if (live.fix?.grade === "fair") {
      return "GPS accuracy is poor here — the blue dot may be a house or two out.";
    }
    return null;
  })();

  if (notice === null) return null;

  return (
    <p role="status" aria-live="polite" className="mt-1.5 text-[13px] leading-snug text-amber-700">
      {notice}
    </p>
  );
}

// The resorts are named for their suburb in the admin - "Piara Waters" -
// but they trade as "<name> Lifestyle Resort", and that's the name on
// the signage a guest has just scanned. Built here rather than stored,
// so it's right for all six without anyone retyping it; the trim is for
// a resort whose name already carries the words, so nothing ends up
// reading "Piara Waters Resort Lifestyle Resort".
export function visitorTitle(resortName: string): string {
  const trimmed = resortName
    .trim()
    .replace(/\s+(lifestyle\s+)?resort$/i, "")
    .trim();
  return `${trimmed || resortName.trim()} Lifestyle Resort`;
}

function Header({ resortName }: { resortName: string }) {
  return (
    <header className="shrink-0 border-b-[3px] border-[#702890] px-4 pb-2.5 pt-3">
      <div className="flex items-center gap-3">
        <Image
          src="/brand/providence-lifestyle.png"
          alt="Providence Lifestyle"
          width={578}
          height={289}
          priority
          className="h-11 w-auto"
        />
        <div className="min-w-0">
          <p className="truncate font-serif text-[19px] leading-tight text-[#702890]">
            {visitorTitle(resortName)}
          </p>
          <p className="text-[12px] leading-tight text-neutral-500">
            Enter a site number below to get directions
          </p>
        </div>
      </div>
    </header>
  );
}

// The screen a guest sees while the map is being put together.
//
// Deliberately the same furniture as the header they are already looking
// at - the resort's own mark, the same purple - so it reads as the page
// still being the page, rather than a gap in it.
function Preparing({ siteNumber }: { siteNumber: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-[900] flex flex-col items-center justify-center gap-6 bg-white px-6 text-center"
    >
      <Image
        src="/brand/providence-lifestyle.png"
        alt=""
        width={578}
        height={289}
        className="h-16 w-auto"
      />
      <svg
        viewBox="0 0 48 48"
        className="h-9 w-9 animate-spin text-[#702890] motion-reduce:animate-none"
        aria-hidden="true"
      >
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="5"
        />
        <path
          d="M24 4a20 20 0 0 1 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
      <p className="text-[15px] leading-snug text-neutral-700">
        Finding the way to Site {siteNumber}…
      </p>
    </div>
  );
}

// What the page is, and how to use it - shown until a site is picked, so
// it's there when a guest first scans and out of the way afterwards.
function Instructions() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <p className="text-[15px] text-neutral-700">
        Welcome. This page shows you the way from the entrance to any site in
        the resort.
      </p>
      <ol className="mt-4 flex flex-col gap-3">
        {[
          "Type the site number you're looking for in the box above.",
          "Tap it in the list that appears.",
          "Follow the purple line on the map from the entrance to the site.",
        ].map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#702890] text-[13px] font-semibold text-white">
              {i + 1}
            </span>
            <span className="text-[15px] leading-snug text-neutral-700">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[13px] leading-snug text-neutral-500">
        The map is turned so that walking into the resort is straight up the
        screen — the way you&apos;re facing at the entrance.
      </p>
    </div>
  );
}
