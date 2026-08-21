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
          Upload a scaled site plan PDF, review the site numbers it finds,
          calibrate it against the satellite map, then bulk-import the
          computed positions as draft sites.
        </p>
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
