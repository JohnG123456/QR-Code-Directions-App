"use client";

import { useState } from "react";
import { slugify } from "@/lib/slugify";

// Name input auto-fills the slug field until the user edits the slug
// directly, at which point it stops overwriting their edits.
export function NameSlugFields({
  defaultName = "",
  defaultSlug = "",
}: {
  defaultName?: string;
  defaultSlug?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(defaultSlug);
  const [slugTouched, setSlugTouched] = useState(Boolean(defaultSlug));

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Resort name
        <input
          name="name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        URL slug (used in the QR code link)
        <input
          name="slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          className="rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
        />
        <span className="text-xs text-neutral-500">
          /r/{slug || "your-resort"}
        </span>
      </label>
    </>
  );
}
