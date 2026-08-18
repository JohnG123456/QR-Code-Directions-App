"use client";

import type { SiteStatus } from "@/lib/types";

export function StatusSelectForm({
  siteId,
  resortId,
  status,
  action,
}: {
  siteId: string;
  resortId: string;
  status: SiteStatus;
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="resortId" value={resortId} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
      >
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </form>
  );
}
