import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bulkUpsertSites } from "../sites/actions";
import { MasterplanClient } from "./masterplan-client";

export default async function ImportMasterplanPage({
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/admin/resorts/${resortId}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {resort.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Import sites from master plan</h1>
        <p className="mt-1 text-sm text-neutral-500">
          A one-off starting point: a scaled site plan PDF is scanned for
          site numbers, matched to the satellite map, and the resulting
          positions are written in as draft sites.
        </p>
        <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          <p>
            <strong>Use this once per plan revision.</strong> Everything
            afterwards - correcting a misread number, moving a pin, adding one
            the scan missed, deleting one that isn&apos;t a site - belongs in{" "}
            <Link
              href={`/admin/resorts/${resortId}/capture-map`}
              className="font-medium text-neutral-900 underline"
            >
              Capture sites from satellite imagery
            </Link>
            , which edits the real positions directly, over the same master
            plan.
          </p>
          <p className="mt-2">
            Importing again re-adds <em>every</em> number in the reviewed list
            above, including ones you have since deleted on the map. That is
            what you want for a new revision of the plan, and not what you want
            for a fix.
          </p>
        </div>
      </div>

      <MasterplanClient
        resortId={resort.id}
        centerLat={resort.center_lat}
        centerLng={resort.center_lng}
        defaultZoom={resort.default_zoom}
        bulkUpsertSites={bulkUpsertSites}
      />
    </div>
  );
}
