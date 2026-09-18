// What the admin shows while the next page is being built.
//
// Every one of those button-looking links at the top of a resort page is
// a whole page render against a database on shared compute, and until
// this existed the old page simply sat there through all of it. Tapping
// something and watching nothing change for a second and a half is what
// makes a tool feel broken, and it is why the same link gets tapped
// twice.
//
// Next swaps this in the moment a navigation starts, so the tap is
// answered immediately by the page itself rather than only by the thing
// that was tapped. It covers every route under (protected) at once,
// including ones added later.
export default function AdminLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#702890]/25 border-t-[#702890] motion-reduce:animate-none"
        />
        <span className="text-sm text-neutral-500">Loading…</span>
      </div>

      {/* A rough shape of the page that is coming, so the screen does not
          jump from a spinner to a full layout. Deliberately vague - it
          stands in for several different pages. */}
      <div aria-hidden="true" className="mt-6 flex flex-col gap-3">
        <div className="h-7 w-2/5 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            "w-32",
            "w-44",
            "w-36",
            "w-28",
          ].map((width, i) => (
            <div
              key={i}
              className={`h-10 ${width} animate-pulse rounded-md bg-neutral-100 motion-reduce:animate-none`}
            />
          ))}
        </div>
        <div className="mt-4 h-48 w-full animate-pulse rounded-lg bg-neutral-100 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
