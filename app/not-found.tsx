import Link from "next/link";

// A page of our own for an address that matches no route at all.
//
// Without this, Next's default 404 answered two very different questions
// with the same screen: "there's no such page" and "there's no resort at
// this address". Chasing a QR code that didn't work, that ambiguity cost
// an evening - the database was fine the whole time and there was no way
// to see it from the outside. The visitor page now handles the second
// case itself, and this one says plainly that the address itself is wrong.
export default function NotFound() {
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
      <p className="text-xs text-neutral-400">
        If you reached this by scanning a sign, please let reception know.
      </p>
      <Link href="/admin/resorts" className="text-sm text-neutral-500 underline">
        Staff sign-in
      </Link>
    </div>
  );
}
