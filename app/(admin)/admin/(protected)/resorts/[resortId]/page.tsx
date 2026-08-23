import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resortUrl } from "@/lib/qr/generate";
import { ResortSettingsForm } from "@/components/admin/resort-settings-form";
import { QrPanel } from "@/components/admin/qr-panel";
import { PlanOverlayPanel } from "@/components/admin/plan-overlay-panel";
import { describePlanOverlay } from "@/lib/masterplan/remote-draft";
import { fetchPublishedOverlayStatus } from "@/lib/masterplan/published-overlay";
import { updateResort, deleteResort } from "../actions";
import { publishPlanOverlay, unpublishPlanOverlay } from "./plan-overlay/actions";

export default async function ResortDetailPage({
  params,
}: {
  params: Promise<{ resortId: string }>;
}) {
  const { resortId } = await params;
  const supabase = await createClient();

  const { data: resort } = await supabase
    .from("resorts")
    .select(
      "id, name, slug, is_published, default_zoom, total_homes, center_lat, center_lng, map_bearing_deg"
    )
    .eq("id", resortId)
    .single();

  if (!resort) notFound();

  const [{ count: siteCount }, planDraft, publishedOverlay] = await Promise.all([
    supabase
      .from("sites")
      .select("id", { count: "exact", head: true })
      .eq("resort_id", resortId),
    describePlanOverlay(supabase, resortId),
    fetchPublishedOverlayStatus(supabase, resortId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin/resorts" className="text-sm text-neutral-500 hover:underline">
          ← All resorts
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{resort.name}</h1>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/admin/resorts/${resort.id}/sites`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Sites ({siteCount ?? 0}
          {resort.total_homes ? ` / ${resort.total_homes}` : ""})
        </Link>
        <Link
          href={`/admin/resorts/${resort.id}/import-masterplan`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Import from master plan
        </Link>
        <Link
          href={`/admin/resorts/${resort.id}/network`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Road network
        </Link>
        <Link
          href={`/admin/resorts/${resort.id}/capture-map`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Capture sites (Satellite map)
        </Link>
        <Link
          href={`/admin/resorts/${resort.id}/capture-sites`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Capture sites (GPS)
        </Link>
        <Link
          href={`/admin/resorts/${resort.id}/import-sites`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Import sites (CSV)
        </Link>
      </div>

      <QrPanel resortId={resort.id} url={resortUrl(resort.slug)} slug={resort.slug} />

      <PlanOverlayPanel
        resortId={resort.id}
        resortIsPublished={resort.is_published}
        published={
          publishedOverlay.kind === "published" ? publishedOverlay.status : null
        }
        draftSavedAt={
          planDraft.kind === "ready"
            ? new Date(planDraft.summary.savedAt).toISOString()
            : null
        }
        // A missing overlay table stops publishing regardless of how
        // healthy the draft is, so it takes priority.
        planIssue={
          publishedOverlay.kind === "not-migrated"
            ? "not-migrated"
            : planDraft.kind === "ready"
              ? null
              : planDraft.kind
        }
        publishPlanOverlay={publishPlanOverlay}
        unpublishPlanOverlay={unpublishPlanOverlay}
      />

      <div>
        <h2 className="mb-3 text-sm font-semibold">Settings</h2>
        <ResortSettingsForm
          resortId={resort.id}
          defaultName={resort.name}
          defaultSlug={resort.slug}
          defaultIsPublished={resort.is_published}
          defaultZoom={resort.default_zoom}
          totalHomes={resort.total_homes}
          mapBearingDeg={resort.map_bearing_deg}
          centerLat={resort.center_lat}
          centerLng={resort.center_lng}
          updateResort={updateResort}
          siteCount={siteCount ?? 0}
          deleteResort={deleteResort}
        />
      </div>
    </div>
  );
}
