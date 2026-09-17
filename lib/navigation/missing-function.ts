/**
 * Postgres and PostgREST for "that function isn't there".
 *
 * Both are needed. Postgres raises `42883` for an undefined function,
 * but PostgREST answers `PGRST202` when the function is absent from the
 * schema cache it keeps - which is what a client actually sees when a
 * migration hasn't been applied, and for a while after one has, until
 * that cache is reloaded. Checking only the first leaves a missing
 * migration looking like a server fault.
 */
export const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);
