// Edge Function : GET /frameworks?zone=salle|cuisine
// Réponse : { framework: { zone, title, content, updated_at } } ou null

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "GET") return jsonResponse(405, { error: "Method Not Allowed" });

  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });

  const url = new URL(req.url);
  const zone = url.searchParams.get("zone");
  if (!zone) return jsonResponse(400, { error: "?zone=salle|cuisine required" });

  const { data, error } = await adminClient
    .from("frameworks")
    .select("zone, title, content, updated_at")
    .eq("zone", zone)
    .maybeSingle();
  if (error) return jsonResponse(500, { error: error.message });

  return jsonResponse(200, { framework: data || null });
});
