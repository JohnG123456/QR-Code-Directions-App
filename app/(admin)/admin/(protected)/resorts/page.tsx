import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createResort } from "./actions";
import { NameSlugFields } from "@/components/admin/name-slug-fields";

export default async function ResortsPage() {
  const supabase = await createClient();
  const { data: resorts } = await supabase
    .from("resorts")
    .select("id, name, slug, is_published, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Resorts</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Each resort gets its own QR code, entrance point, and set of
          sites.
        </p>
      </div>

      <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
        {resorts && resorts.length > 0 ? (
          resorts.map((resort) => (
            <li key={resort.id}>
              <Link
                href={`/admin/resorts/${resort.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50"
              >
                <span className="font-medium">{resort.name}</span>
                <span className="flex items-center gap-3 text-sm text-neutral-500">
                  /r/{resort.slug}
                  <span
                    className={
                      resort.is_published
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800"
                        : "rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                    }
                  >
                    {resort.is_published ? "Published" : "Draft"}
                  </span>
                </span>
              </Link>
            </li>
          ))
        ) : (
          <li className="px-4 py-6 text-sm text-neutral-500">
            No resorts yet — add your first one below.
          </li>
        )}
      </ul>

      <form
        action={createResort}
        className="flex max-w-md flex-col gap-3 rounded-md border border-neutral-200 p-4"
      >
        <h2 className="text-sm font-semibold">Add a resort</h2>
        <NameSlugFields />
        <button
          type="submit"
          className="mt-1 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
        >
          Create resort
        </button>
      </form>
    </div>
  );
}
