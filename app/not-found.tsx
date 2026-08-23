"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

// A page of our own for an address that matches no route at all, and it
// names the address it was given.
//
// Without this, Next's default 404 answered two very different questions
// with the same screen: "there is no such page" and "there is no resort
// at this address". Chasing a QR code that didn't work, that ambiguity
// cost an evening - the database was fine the whole time. Showing the
// address closes the last gap: a wrong host, a stray path segment or a
// typo are all invisible in a phone's address bar, which shows only the
// domain.
export default function NotFound() {
  // Read through useSyncExternalStore rather than an effect: the address
  // doesn't exist during the server render, and this is the shape that
  // says so honestly - null on the server, the real value on the client -
  // without a state write on mount.
  const address = useSyncExternalStore(
    () => () => {},
    () => window.location.pathname + window.location.search,
    () => null
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">
        This address doesn&apos;t exist
      </h1>
      <p className="text-sm text-neutral-600">
        Nothing is published at this web address. A resort&apos;s directions
        live at an address like <code>/r/resort-name</code> — check for a typo,
        or scan the QR code again.
      </p>
      {address && (
        <p className="break-all rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
          Address tried: <strong>{address}</strong>
        </p>
      )}
      <p className="text-xs text-neutral-500">
        If you reached this by scanning a sign, please let reception know.
      </p>
      <Link href="/admin/resorts" className="text-sm text-neutral-600 underline">
        Staff sign-in
      </Link>
    </div>
  );
}
