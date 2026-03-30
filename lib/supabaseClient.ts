import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// createClient() throws if url/key are empty. During `next build` on CI (e.g. Vercel)
// without env vars, we use placeholders so static generation can finish. A working
// deploy still requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
// in the host's environment so they are inlined at build time.
const BUILD_PLACEHOLDER_URL = "https://placeholder.local.supabase.co";
const BUILD_PLACEHOLDER_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJwbGFjZWhvbGRlciIsInJvbGUiOiJhbm9uIn0.placeholder";

const url = supabaseUrl || BUILD_PLACEHOLDER_URL;
const key = supabaseAnonKey || BUILD_PLACEHOLDER_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (in .env.local locally, or Vercel → Project → Settings → Environment Variables for production)."
  );
}

export const supabase = createClient(url, key);

