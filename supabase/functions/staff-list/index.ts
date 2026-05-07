// Edge Function : GET /staff (admin)
// Query : ?include_inactive=1&with_counts=1
// Réponse : { staff: [...], count }
//
// Avec with_counts=1 : ajoute total_checkins + unread_notes par staff (pour
// la sidebar Équipe du dashboard).

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "GET") return jsonResponse(405, { error: "Method Not Allowed" });

  const admin = await currentStaff(req);
  if (!admin) return jsonResponse(401, { error: "Not authenticated" });

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("include_inactive") === "1";
  const withCounts = url.searchParams.get("with_counts") === "1";

  let q = adminClient
    .from("staff")
    .select("id, name, pdvs, active, is_supervisor, created_at, last_login")
    .order("active", { ascending: false })
    .order("name");
  if (!includeInactive) q = q.eq("active", true);

  const { data: staff, error } = await q;
  if (error) return jsonResponse(500, { error: `DB query failed: ${error.message}` });

  const out = [];
  for (const s of staff || []) {
    const item: Record<string, unknown> = { ...s };
    if (withCounts) {
      const { count: total } = await adminClient
        .from("checkins")
        .select("id", { count: "exact", head: true })
        .eq("staff_id", s.id);
      const { count: unread } = await adminClient
        .from("staff_notes")
        .select("id", { count: "exact", head: true })
        .eq("staff_id", s.id)
        .is("read_at", null);
      item.total_checkins = total || 0;
      item.unread_notes = unread || 0;
    }
    out.push(item);
  }

  return jsonResponse(200, { staff: out, count: out.length });
});
