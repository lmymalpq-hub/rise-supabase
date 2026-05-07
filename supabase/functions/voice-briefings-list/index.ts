// Edge Function : GET /voice-briefings-list (admin/superviseur)
// Query : ?pdv=&zone=&from=&to=&limit=
// Réponse : { briefings: [...], count }

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
  const pdv = url.searchParams.get("pdv");
  const zone = url.searchParams.get("zone");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));

  let q = adminClient
    .from("voice_briefings")
    .select("id, pdv, zone, service_date, service_slot, supervisor_staff_id, supervisor_name, status, raw_transcription, synthesis, synthesis_meta, created_at, finished_at, error_msg")
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (pdv)  q = q.eq("pdv", pdv);
  if (zone) q = q.eq("zone", zone);
  if (from) q = q.gte("service_date", from);
  if (to)   q = q.lte("service_date", to);

  const { data, error } = await q;
  if (error) return jsonResponse(500, { error: error.message });
  return jsonResponse(200, { briefings: data || [], count: (data || []).length });
});
