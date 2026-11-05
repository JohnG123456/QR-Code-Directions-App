import Link from "next/link";
import type { ReactNode } from "react";
import guide from "@/lib/guides/new-resort-setup.json";

// The written procedure for taking a resort from nothing to a printed QR
// code. It lives inside the admin area so it can't drift off into a
// folder somewhere and be lost: the person learning the job finds it
// next to the screens it describes. The words are kept in
// lib/guides/new-resort-setup.json, which the Word version is generated
// from too, so the two say the same thing.

// The guide marks on-screen labels with **double asterisks**. Render
// those as bold and everything else as plain text - no other markup.
function withBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-neutral-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

export default function SetupGuidePage() {
  return (
    <article className="flex max-w-3xl flex-col gap-8">
      <div>
        <Link href="/admin/resorts" className="text-sm text-neutral-500 hover:underline">
          ← All resorts
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{guide.title}</h1>
        <p className="mt-2 text-sm text-neutral-600">{withBold(guide.summary)}</p>
        <p className="mt-1 text-xs text-neutral-500">Last reviewed {guide.lastReviewed}</p>
      </div>

      <nav aria-label="Steps" className="rounded-md border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold">Steps at a glance</h2>
        <ol className="mt-2 list-decimal gap-x-8 pl-5 text-sm sm:columns-2 [&>li]:mb-1">
          {guide.steps.map((step) => (
            <li key={step.id}>
              <a href={`#${step.id}`} className="text-neutral-700 underline-offset-2 hover:underline">
                {step.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section className="rounded-md bg-neutral-50 p-4">
        <h2 className="text-sm font-semibold">{guide.before.title}</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-neutral-700">
          {guide.before.items.map((item, i) => (
            <li key={i}>{withBold(item)}</li>
          ))}
        </ul>
      </section>

      <ol className="flex flex-col gap-6">
        {guide.steps.map((step, index) => (
          <li
            key={step.id}
            id={step.id}
            className="scroll-mt-4 rounded-md border border-neutral-200 p-4"
          >
            <h2 className="flex items-baseline gap-2 text-base font-semibold">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">
                {index + 1}
              </span>
              {step.title}
            </h2>
            <p className="mt-1 text-xs text-neutral-500">Where: {step.where}</p>
            <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-neutral-700">
              {step.do.map((line, i) => (
                <li key={i}>{withBold(line)}</li>
              ))}
            </ol>
            {"checks" in step && step.checks && (
              <div className="mt-4 rounded-md bg-neutral-50 p-3">
                <h3 className="text-sm font-semibold">{step.checks.title}</h3>
                <p className="mt-1 text-sm text-neutral-700">{withBold(step.checks.intro)}</p>
                <pre className="mt-2 overflow-x-auto rounded-md border border-neutral-200 bg-white p-3 text-xs leading-relaxed text-neutral-800">
                  <code>{step.checks.query}</code>
                </pre>
                <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-neutral-700">
                  {step.checks.items.map((item, i) => (
                    <li key={i}>{withBold(item)}</li>
                  ))}
                </ul>
              </div>
            )}
            {"watch" in step && step.watch && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>Watch out:</strong> {withBold(step.watch)}
              </p>
            )}
          </li>
        ))}
      </ol>

      <section className="rounded-md border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold">{guide.later.title}</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-neutral-700">
          {guide.later.items.map((item, i) => (
            <li key={i}>{withBold(item)}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
