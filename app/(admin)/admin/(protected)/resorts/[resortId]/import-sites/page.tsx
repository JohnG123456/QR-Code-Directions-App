import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bulkUpsertSites } from "../sites/actions";
import { CsvImportTool } from "@/components/admin/csv-import-tool";

export default async function ImportSitesPage({
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
        <h1 className="mt-1 text-xl font-semibold">Import sites from CSV</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Existing site numbers are updated in place; new ones are added as
          drafts.
        </p>
      </div>

      <CsvImportTool resortId={resortId} bulkUpsertSites={bulkUpsertSites} />
    </div>
  );
}
