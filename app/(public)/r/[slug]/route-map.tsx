"use client";

import { useMemo, useState } from "react";
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

interface RouteResult {
  distanceM: number;
  points: [number, number][];
}

// react-leaflet touches `window`/`document` at import time, so the map
// itself must be excluded from the server render.
const LeafletRouteView = dynamic(
  () => import("./leaflet-route-view").then((m) => m.LeafletRouteView),
  { ssr: false, loading: () => <div className="h-96 w-full animate-pulse bg-neutral-100" /> }
);

export function RouteMap({
  resort,
  sites,
}: {
  resort: PublicResort;
  sites: PublicSite[];
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeState, setRouteState] = useState<"idle" | "loading" | "done">("idle");

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return sites
      .filter(
        (s) =>
          s.site_number.toLowerCase().includes(q) ||
          s.label?.toLowerCase().includes(q)
      )
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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-200 px-4 py-4">
        <h1 className="text-lg font-semibold">{resort.name}</h1>
        <p className="text-sm text-neutral-500">Find your site</p>
      </header>

      <div className="relative px-4 py-3">
        <input
          type="text"
          inputMode="search"
          placeholder="Enter your site number..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedId(null);
            setRoute(null);
            setRouteState("idle");
          }}
          autoFocus
          className="w-full rounded-md border border-neutral-300 px-4 py-3 text-base"
        />
        {matches.length > 0 && !selectedSite && (
          <ul className="absolute inset-x-4 top-full z-10 mt-1 rounded-md border border-neutral-200 bg-white shadow-lg">
            {matches.map((site) => (
              <li key={site.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(site.id);
                    setQuery(site.site_number);
                    void loadRoute(site.id);
                  }}
                  className="flex w-full justify-between px-4 py-3 text-left hover:bg-neutral-50"
                >
                  <span className="font-medium">Site {site.site_number}</span>
                  {site.label && (
                    <span className="text-sm text-neutral-500">{site.label}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedSite && hasEntrance && (
        <>
          <div className="px-4 pb-3">
            {route ? (
              <p className="text-sm text-neutral-700">
                Site {selectedSite.site_number} is a{" "}
                <strong>{formatDistance(route.distanceM)}</strong> walk from the
                entrance, about{" "}
                {formatWalkTime(estimatedWalkSeconds(route.distanceM))}. Follow
                the blue line.
              </p>
            ) : (
              summary && (
                <p className="text-sm text-neutral-700">
                  Site {selectedSite.site_number} is approximately{" "}
                  <strong>{summary.distance}</strong> {summary.compass} of the
                  entrance (~{summary.walkTime} walk, straight-line).
                  {routeState === "loading" && " Finding the walking route…"}
                </p>
              )
            )}
          </div>
          <div className="flex-1">
            <LeafletRouteView
              entrance={{ lat: resort.entrance_lat!, lng: resort.entrance_lng! }}
              site={{ lat: selectedSite.lat!, lng: selectedSite.lng! }}
              zoom={resort.default_zoom}
              routePoints={route?.points ?? null}
              siteLabel={`Site ${selectedSite.site_number}`}
            />
          </div>
        </>
      )}

      {selectedSite && !hasEntrance && (
        <p className="px-4 text-sm text-amber-600">
          This resort hasn&apos;t set an entrance/reference point yet, so we
          can&apos;t show directions.
        </p>
      )}

      {!selectedSite && (
        <p className="px-4 text-sm text-neutral-400">
          Start typing your site number above to see directions.
        </p>
      )}
    </div>
  );
}
