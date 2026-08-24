import Link from "next/link";

// The first thing a new resort needs, and the thing that blocks
// everything else until it's there.
//
// The master plan import, the road network and the boundary all convert
// between the plan and the real world, and every one of them needs a
// known point to measure from. Each used to say so and stop there,
// which reads as "this page has nothing on it" rather than "do this one
// thing first" - especially on a new resort, where it's the very first
// screen you open.
export function NeedsReferencePoint({
  resortId,
  /** What can't happen yet, in the middle of a sentence. */
  blockedTask,
}: {
  resortId: string;
  blockedTask: string;
}) {
  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p>
        <strong>Set the resort&apos;s reference point first.</strong> {blockedTask}{" "}
        needs a known point to measure from — everything on the plan is worked
        out relative to it.
      </p>
      <p>
        Open{" "}
        <Link
          href={`/admin/resorts/${resortId}#settings`}
          className="font-medium underline"
        >
          this resort&apos;s Settings
        </Link>{" "}
        and click the map roughly at the resort&apos;s entrance or centre, then
        Save changes. It takes a moment, and you only do it once.
      </p>
    </div>
  );
}
