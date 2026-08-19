import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// middleware.ts already redirects unauthenticated visitors to /admin/login.
// This layout does the second check: the signed-in user must have a
// staff_profiles row (created by a super-admin) to use the admin area at
// all - there is no public self-signup path.
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: staffProfile } = await supabase
    .from("staff_profiles")
    .select("id, display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (!staffProfile) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4 text-center">
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="text-sm text-neutral-500">
          Your account ({user.email}) doesn&apos;t have admin access yet. Ask
          an administrator to add you.
        </p>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            Sign out
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
        <Link href="/admin/resorts" className="font-semibold">
          Resort Directions Admin
        </Link>
        <div className="flex items-center gap-4 text-sm text-neutral-500">
          <span>{staffProfile.display_name ?? staffProfile.email}</span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="hover:text-neutral-900">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
