// Edge Function : POST /checkins/:id/annotate (admin)
// Body : {
//   annotations: [{ type: "circle"|"arrow"|"line", ...coords }],
//   note: string | null   // null = ne touche pas, "" = effacer, "txt" = écrire
// }
// Réponse OK : { ok: true, count, annotations, note_id?, push? }
//
// Pipeline (équivalent du Sprint 5 Python) :
//   1. Update checkins.annotations + note
//   2. Si admin_note non vide ET le checkin a un staff_id :
//      → upsert staff_note liée (suffix '#cN' sur note_date pour unicité)
//      → push notif Web VAPID au staff
//   3. Si admin_note vide : delete la staff_note liée
//
// ⚠️ Cet endpoint est admin-only. Aujourd'hui pas d'auth admin distinct
// (le PIN admin = un staff is_supervisor=true côté Python). À durcir
// quand le SPA admin sera en place.

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

const ALLOWED_SHAPE_TYPES = new Set(["circle", "arrow", "line"]);

// deno-lint-ignore no-explicit-any
function cleanShape(s: any): unknown | null {
  if (!s || typeof s !== "object") return null;
  if (!ALLOWED_SHAPE_TYPES.has(s.type)) return null;
  if (s.type === "circle") {
    const cx = Number(s.cx), cy = Number(s.cy), r = Number(s.r);
    if ([cx, cy, r].some((v) => Number.isNaN(v))) return null;
    return { type: "circle", cx, cy, r: Math.max(1, r) };
  }
  // line / arrow
  const x1 = Number(s.x1), y1 = Number(s.y1), x2 = Number(s.x2), y2 = Number(s.y2);
  if ([x1, y1, x2, y2].some((v) => Number.isNaN(v))) return null;
  return { type: s.type, x1, y1, x2, y2 };
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  // Auth admin (TODO : durcir avec un check is_supervisor)
  const admin = await currentStaff(req);
  if (!admin) return jsonResponse(401, { error: "Not authenticated" });

  // checkin_id en query param
  const url = new URL(req.url);
  const idStr = url.searchParams.get("id");
  if (!idStr || !/^\d+$/.test(idStr)) {
    return jsonResponse(400, { error: "?id=<checkin_id> required" });
  }
  const checkinId = parseInt(idStr, 10);

  // Body
  let body: { annotations?: unknown[]; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const rawShapes = Array.isArray(body.annotations) ? body.annotations : [];
  const cleaned = rawShapes
    .map(cleanShape)
    .filter((s): s is unknown => s !== null);

  // null = ne touche pas, "" = effacer, "txt" = écrire
  const adminNoteRaw = body.note;
  const adminNote =
    adminNoteRaw === null || adminNoteRaw === undefined
      ? null
      : String(adminNoteRaw).trim();

  // 1. Update checkins
  const updatePayload: Record<string, unknown> = {
    annotations: cleaned.length > 0 ? cleaned : null,
  };
  if (adminNote !== null) {
    updatePayload.note = adminNote === "" ? null : adminNote;
  }

  const { data: ck, error: upErr } = await adminClient
    .from("checkins")
    .update(updatePayload)
    .eq("id", checkinId)
    .select("id, pdv, category, staff_id, created_at")
    .single();

  if (upErr || !ck) {
    return jsonResponse(404, { error: "Checkin not found or update failed" });
  }

  // 2. Bridge annotation → staff_note (Sprint 5 Python parity)
  let noteId: number | null = null;
  let pushInfo: { sent: number; failed: number } | null = null;

  if (adminNote !== null && ck.staff_id) {
    const baseDate = (ck.created_at as string || "").slice(0, 10);
    const uniqueDate = `${baseDate}#c${checkinId}`;

    if (adminNote) {
      // Upsert : check existing first (lookup par checkin_id)
      const { data: existing } = await adminClient
        .from("staff_notes")
        .select("id")
        .eq("checkin_id", checkinId)
        .maybeSingle();

      if (existing) {
        // Update : reset read_at
        const { data: upd } = await adminClient
          .from("staff_notes")
          .update({ remark: adminNote, updated_at: new Date().toISOString(), read_at: null })
          .eq("id", existing.id)
          .select("id")
          .single();
        noteId = upd?.id ?? null;
      } else {
        // Insert
        const { data: ins } = await adminClient
          .from("staff_notes")
          .insert({
            staff_id: ck.staff_id,
            pdv: ck.pdv,
            category: ck.category,
            note_date: uniqueDate,
            remark: adminNote,
            checkin_id: checkinId,
          })
          .select("id")
          .single();
        noteId = ins?.id ?? null;
      }

      // 3. Push notif Web VAPID — TODO : implémenter dans Edge Function dédiée
      // Pour l'instant on retourne juste un placeholder. La logique VAPID
      // sera ajoutée dans une fonction `push-send` séparée appelée d'ici.
      pushInfo = { sent: 0, failed: 0 };
    } else {
      // adminNote === "" → delete la staff_note liée
      await adminClient.from("staff_notes").delete().eq("checkin_id", checkinId);
    }
  }

  return jsonResponse(200, {
    ok: true,
    count: cleaned.length,
    annotations: cleaned,
    note_id: noteId,
    push: pushInfo,
  });
});
