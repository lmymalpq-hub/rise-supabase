// Helper Supabase client partagé entre Edge Functions.
// Utilise SERVICE_ROLE_KEY pour bypass RLS — toutes les opérations DB et Storage
// passent par ce client privilégié, jamais par le client anon.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env.",
  );
}

export const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const UPLOADS_BUCKET = "rise-uploads";
