"use client";

import { useMemo, useState } from "react";
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

const PLAN_VIEW_LABELS: Record<PlanView, string> = {
  plan: "Site plan",
  both: "Both",
  satellite: "Satellite",
};

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

  function reset() {
    setQuery("");
    setSelectedId(null);
    setRoute(null);
    setRouteState("idle");
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
            setQuery(e.target.value);
            setSelectedId(null);
            setRoute(null);
            setRouteState("idle");
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
                    setSelectedId(site.id);
                    setQuery(site.site_number);
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
        <>
          <div className="shrink-0 px-4 pt-3">
            {route ? (
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
          </div>

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
              routePoints={route?.points ?? null}
              siteLabel={`Site ${selectedSite.site_number}`}
              plan={plan}
              planImageUrl={planImageUrl}
              planOpacity={PLAN_VIEWS[planView]}
              bearingDeg={bearingDeg}
              boundary={boundary}
            />
          </div>
        </>
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
            Find your way around
          </p>
        </div>
      </div>
    </header>
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
