// Edge Function : GET /me/notes/unread-count
// Réponse : { unread: N }
//
// Utilisé par le banner "X nouvelles remarques" sur la home équipier.

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });

  const { count, error } = await adminClient
    .from("staff_notes")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", staff.id)
    .is("read_at", null);

  if (error) {
    return jsonResponse(500, { error: `DB query failed: ${error.message}` });
  }

  return jsonResponse(200, { unread: count || 0 });
});
