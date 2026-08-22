import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { describePlanOverlay } from "@/lib/masterplan/remote-draft";
import {
  addSite,
  updateSiteLocation,
  updateSiteDetails,
  deleteSite,
  restoreSite,
  setSiteStatus,
} from "../sites/actions";
import { CaptureMapClient } from "./capture-map-client";

export default async function CaptureMapPage({
  params,
}: {
  params: Promise<{ resortId: string }>;
}) {
  const { resortId } = await params;
  const supabase = await createClient();

  const { data: resort } = await supabase
    .from("resorts")
    .select("id, name, total_homes, default_zoom, center_lat, center_lng")
    .eq("id", resortId)
    .single();

  if (!resort) notFound();

  const [{ data: sites }, planOverlay] = await Promise.all([
    supabase
      .from("sites")
      .select("id, site_number, label, lat, lng, status")
      .eq("resort_id", resortId)
      .order("site_number"),
    // Only the calibration is needed here; the plan image itself is
    // fetched by the tool if staff actually switch the overlay on.
    describePlanOverlay(supabase, resortId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={`/admin/resorts/${resortId}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {resort.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Capture sites from satellite imagery</h1>
      </div>

      <CaptureMapClient
        resortId={resort.id}
        initialSites={
          (sites ?? []).filter(
            (s): s is typeof s & { lat: number; lng: number } =>
              s.lat !== null && s.lng !== null
          )
        }
        totalHomes={resort.total_homes}
        centerLat={resort.center_lat}
        centerLng={resort.center_lng}
        defaultZoom={resort.default_zoom}
        planCalibration={
          planOverlay.kind === "ready"
            ? {
                pairs: planOverlay.summary.pairs,
                imageWidth: planOverlay.summary.imageWidth,
                imageHeight: planOverlay.summary.imageHeight,
              }
            : null
        }
        planUnavailable={planOverlay.kind === "ready" ? null : planOverlay.kind}
        addSite={addSite}
        updateSiteLocation={updateSiteLocation}
        updateSiteDetails={updateSiteDetails}
        deleteSite={deleteSite}
        restoreSite={restoreSite}
        setSiteStatus={setSiteStatus}
      />
    </div>
  );
}
