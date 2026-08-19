import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for server-only privileged operations (e.g. inviting
// staff, bulk CSV upserts bypassing RLS). NEVER import this from a Client
// Component or expose SUPABASE_SERVICE_ROLE_KEY to the browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
