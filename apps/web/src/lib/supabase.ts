import { createClient } from "@supabase/supabase-js";

// Single browser-side Supabase client. The anon key is publishable; row-level
// security in the database is what actually keeps data safe.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Supabase credentials missing — copy .env.example to apps/web/.env.local and fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
