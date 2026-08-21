"use client";

import { useState } from "react";
import type { ConnectResult } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/network/actions";

// Sites only become routable once they're attached to the road network.
// It's a deliberate step rather than something that happens on save: it
// edits the road graph (splitting roads to make junctions), and doing
// that quietly under a staff member mid-trace would be unnerving.
export function ConnectSitesPanel({
  resortId,
  totalSites,
  connectedSites,
  hasRoads,
  connectSitesToNetwork,
}: {
  resortId: string;
  totalSites: number;
  connectedSites: number;
  hasRoads: boolean;
  connectSitesToNetwork: (resortId: string, reconnectAll: boolean) => Promise<ConnectResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);

  const outstanding = totalSites - connectedSites;

  async function run(reconnectAll: boolean) {
    if (
      reconnectAll &&
      !window.confirm(
        "This re-attaches every site to the roads from scratch. Use it after moving sites or re-tracing roads. Continue?"
      )
    ) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      setResult(await connectSitesToNetwork(resortId, reconnectAll));
    } catch {
      setResult({ connected: 0, error: "That didn't run — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <div>
        <h2 className="text-sm font-semibold">Connect sites to the roads</h2>
        <p className="mt-1 text-sm text-neutral-600">
          {connectedSites} of {totalSites} sites are attached to the network.
          {outstanding > 0
            ? " Until a site is attached, visitors get a straight line to it instead of a walking route."
            : " Every site has a walking route."}
        </p>
      </div>

      {!hasRoads && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Trace some roads first — there&apos;s nothing to attach sites to yet.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !hasRoads || outstanding === 0}
          onClick={() => run(false)}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Connecting…" : `Connect ${outstanding} site${outstanding === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          disabled={busy || !hasRoads || totalSites === 0}
          onClick={() => run(true)}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          Reconnect all
        </button>
      </div>

      {result && (
        <p className={`text-sm ${result.error ? "text-red-600" : "text-green-700"}`}>
          {result.error ?? `Connected ${result.connected} sites. Reload to see the connectors on the map.`}
        </p>
      )}
    </section>
  );
}
