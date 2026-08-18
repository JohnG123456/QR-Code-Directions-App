import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addSite } from "../sites/actions";
import { GpsCaptureTool } from "@/components/admin/site-capture/gps-capture-tool";

export default async function CaptureSitesPage({
  params,
}: {
  params: Promise<{ resortId: string }>;
}) {
  const { resortId } = await params;
  const supabase = await createClient();
  const { data: resort } = await supabase
    .from("resorts")
    .select("id, name")
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
        <h1 className="mt-1 text-xl font-semibold">Capture sites by GPS</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Walk to each site, get a location fix, and save it. Sites save as
          drafts — mark them active from the{" "}
          <Link href={`/admin/resorts/${resortId}/sites`} className="underline">
            sites list
          </Link>{" "}
          once you&apos;ve checked them.
        </p>
      </div>

      <GpsCaptureTool resortId={resortId} addSite={addSite} />
    </div>
  );
}
