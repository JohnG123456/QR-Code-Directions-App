import { createClient } from "@/lib/supabase/server";
import { BackupRestoreTool } from "@/components/admin/backup-restore-tool";
import { restoreBackup } from "./actions";

export default async function BackupPage() {
  const supabase = await createClient();

  const [{ count: resortCount }, { count: siteCount }, { data: latest }] = await Promise.all([
    supabase.from("resorts").select("id", { count: "exact", head: true }),
    supabase.from("sites").select("id", { count: "exact", head: true }),
    supabase
      .from("sites")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Backup &amp; restore</h1>
        <p className="mt-1 text-sm text-neutral-500">
          The site coordinates are the part of this system that can&apos;t be
          recreated quickly. Download a copy every so often and keep it
          somewhere that isn&apos;t Supabase.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4">
        <div>
          <h2 className="text-sm font-semibold">Download a backup</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {resortCount ?? 0} resorts, {siteCount ?? 0} sites
            {latest?.updated_at
              ? `, last changed ${new Date(latest.updated_at).toLocaleDateString()}`
              : ""}
            .
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <a
            href="/api/backup?format=sites-csv"
            className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            Download sites (CSV)
          </a>
          <p className="text-xs text-neutral-500">
            One row per site with its resort, number, status and coordinates.
            Opens directly in Excel or Google Sheets.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <a
            href="/api/backup?format=resorts-csv"
            className="w-fit rounded-md border border-neutral-300 px-4 py-2 text-sm"
          >
            Download resorts (CSV)
          </a>
          <p className="text-xs text-neutral-500">
            One row per resort: settings, reference point and how many sites
            have been captured so far.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <a
            href="/api/backup?format=json"
            className="w-fit rounded-md border border-neutral-300 px-4 py-2 text-sm"
          >
            Download full backup (JSON)
          </a>
          <p className="text-xs text-neutral-500">
            The one to keep. A spreadsheet is easy to read, but this is the
            file that can rebuild the database — restore it below.
          </p>
        </div>
      </section>

      <BackupRestoreTool restoreBackup={restoreBackup} />

      <section className="flex flex-col gap-2 rounded-md bg-neutral-50 p-4 text-sm text-neutral-600">
        <h2 className="text-sm font-semibold text-neutral-900">
          If the Supabase project disappears
        </h2>
        <p>
          Free Supabase projects pause after about a week with no activity, and
          a project left paused long enough can be removed. Pausing is
          reversible from the Supabase dashboard — removal isn&apos;t.
        </p>
        <ol className="list-decimal pl-5">
          <li>Create a new Supabase project.</li>
          <li>
            Run the SQL in <code>supabase/migrations/</code> in order, in the
            SQL editor.
          </li>
          <li>Point the app&apos;s environment variables at the new project.</li>
          <li>Sign in and restore the JSON backup above.</li>
        </ol>
        <p>
          The app also pings the database once a day on its own, which is
          normally enough to stop it ever pausing.
        </p>
      </section>
    </div>
  );
}
