import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { describePlanOverlay } from "@/lib/masterplan/remote-draft";
import { boundaryToRings } from "@/lib/geo/resort-boundary";
import { BoundaryEditorClient } from "./boundary-editor-client";
import { saveResortBoundary, clearResortBoundary } from "./actions";
import { NeedsReferencePoint } from "@/components/admin/needs-reference-point";

export default async function BoundaryPage({
  params,
}: {
  params: Promise<{ resortId: string }>;
}) {
  const { resortId } = await params;
  const supabase = await createClient();

  const { data: resort } = await supabase
    .from("resorts")
    .select("id, name, default_zoom, center_lat, center_lng")
    .eq("id", resortId)
    .single();

  if (!resort) notFound();

  // The drawn boundary if there is one; otherwise the shape worked out
  // from the homes, so there's something to adjust rather than a blank
  // map to start from scratch on.
  const [{ data: drawn }, { data: sites }, planOverlay] = await Promise.all([
    supabase.rpc("resort_boundary_geojson", { p_resort_id: resortId }).single(),
    supabase
      .from("sites")
      .select("id, lat, lng, status")
      .eq("resort_id", resortId)
      .order("site_number"),
    describePlanOverlay(supabase, resortId),
  ]);

  if (resort.center_lat === null || resort.center_lng === null) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href={`/admin/resorts/${resortId}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {resort.name}
        </Link>
        <NeedsReferencePoint resortId={resortId} blockedTask="Tracing the boundary" />
      </div>
    );
  }

  const result = drawn as { boundary: unknown; is_drawn: boolean } | null;
  const rings = boundaryToRings(result?.boundary);
  // GeoJSON rings repeat the first point at the end to close them; the
  // editor works in open points and closes the shape itself.
  const outer = rings[0] ?? [];
  const open = outer.length > 1 ? outer.slice(0, -1) : outer;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={`/admin/resorts/${resortId}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {resort.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Resort boundary</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Trace the resort&apos;s perimeter. Everything outside it is greyed out
          on the visitor&apos;s map, so this is what decides whether the
          neighbours show and whether your own facilities are cut off.
        </p>
      </div>

      <BoundaryEditorClient
        resortId={resort.id}
        centerLat={resort.center_lat}
        centerLng={resort.center_lng}
        defaultZoom={resort.default_zoom}
        initialPoints={open.map(([lng, lat]) => ({ lat, lng }))}
        hasDrawnBoundary={result?.is_drawn ?? false}
        sites={(sites ?? []).filter(
          (s): s is typeof s & { lat: number; lng: number } =>
            s.lat !== null && s.lng !== null
        )}
        planCalibration={
          planOverlay.kind === "ready"
            ? {
                pairs: planOverlay.summary.pairs,
                imageWidth: planOverlay.summary.imageWidth,
                imageHeight: planOverlay.summary.imageHeight,
                fileName: planOverlay.summary.fileName,
              }
            : null
        }
        planUnavailable={planOverlay.kind === "ready" ? null : planOverlay.kind}
        saveResortBoundary={saveResortBoundary}
        clearResortBoundary={clearResortBoundary}
      />
    </div>
  );
}
