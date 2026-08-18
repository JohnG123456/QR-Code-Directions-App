import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setSiteStatus, deleteSite } from "./actions";
import { StatusSelectForm } from "@/components/admin/status-select-form";

export default async function SitesPage({
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

  const { data: sites } = await supabase
    .from("sites")
    .select("id, site_number, label, lat, lng, status, gps_accuracy_m")
    .eq("resort_id", resortId)
    .order("site_number");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/admin/resorts/${resortId}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {resort.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Sites</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Draft sites aren&apos;t shown to visitors until marked active.
        </p>
      </div>

      <div className="flex gap-3">
        <Link
          href={`/admin/resorts/${resortId}/capture-sites`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Capture sites (GPS)
        </Link>
        <Link
          href={`/admin/resorts/${resortId}/import-sites`}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          Import sites (CSV)
        </Link>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-neutral-500">
          <tr>
            <th className="py-2">Site #</th>
            <th className="py-2">Label</th>
            <th className="py-2">Location</th>
            <th className="py-2">GPS accuracy</th>
            <th className="py-2">Status</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {(sites ?? []).map((site) => (
            <tr key={site.id}>
              <td className="py-2 font-medium">{site.site_number}</td>
              <td className="py-2">{site.label ?? "—"}</td>
              <td className="py-2 font-mono text-xs text-neutral-500">
                {site.lat?.toFixed(6)}, {site.lng?.toFixed(6)}
              </td>
              <td className="py-2 text-neutral-500">
                {site.gps_accuracy_m ? `±${Math.round(site.gps_accuracy_m)} m` : "—"}
              </td>
              <td className="py-2">
                <StatusSelectForm
                  siteId={site.id}
                  resortId={resortId}
                  status={site.status}
                  action={setSiteStatus}
                />
              </td>
              <td className="py-2 text-right">
                <form action={deleteSite}>
                  <input type="hidden" name="siteId" value={site.id} />
                  <input type="hidden" name="resortId" value={resortId} />
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {(!sites || sites.length === 0) && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-neutral-500">
                No sites yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
