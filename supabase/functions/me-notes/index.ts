// Edge Function : GET /me/notes
// Query params (optionnels) : ?from=YYYY-MM-DD&to=YYYY-MM-DD&only_unread=1
// Réponse : { notes: [...], count: N }
//
// Pour chaque note, retourne :
//   - id, pdv, category, note_date, note_date_display, mood, score, remark
//   - read_at (null si non lue)
//   - checkin_id (si la note est liée à une photo annotée)
//   - checkin_photo_path + signed_url (URL signée 1h pour la photo)
//   - checkin_annotations (JSONB des shapes dessinées par admin)

import { adminClient, UPLOADS_BUCKET } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

const SIGNED_URL_TTL = 3600; // 1h

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const onlyUnread = url.searchParams.get("only_unread") === "1";

  // Query staff_notes JOIN checkins (LEFT) pour récupérer photo + annotations
  let query = adminClient
    .from("staff_notes")
    .select(`
      id, pdv, category, note_date, score, mood, remark, read_at, checkin_id,
      checkin:checkin_id(photo_path, annotations)
    `)
    .eq("staff_id", staff.id);

  if (from) query = query.gte("note_date", from);
  if (to) query = query.lte("note_date", to + "￿"); // include suffix '#cN'
  if (onlyUnread) query = query.is("read_at", null);

  query = query.order("note_date", { ascending: false }).order("id", { ascending: false });

  const { data: rows, error } = await query;
  if (error) {
    return jsonResponse(500, { error: `DB query failed: ${error.message}` });
  }

  // Enrichi : note_date_display + signed URL pour les photos linked
  const out: unknown[] = [];
  for (const r of rows || []) {
    const nd = r.note_date as string || "";
    const note_date_display = nd.includes("#") ? nd.split("#")[0] : nd;

    // deno-lint-ignore no-explicit-any
    const ck = (r as any).checkin;
    let signed_url: string | null = null;
    let photo_path: string | null = null;
    let annotations: unknown[] = [];

    if (ck && ck.photo_path) {
      photo_path = ck.photo_path;
      try {
        annotations = ck.annotations || [];
      } catch {
        annotations = [];
      }
      // Avec supabase-js@2.46+ pinné, transform fonctionne nativement
      const { data: signed } = await adminClient.storage
        .from(UPLOADS_BUCKET)
        .createSignedUrl(ck.photo_path, SIGNED_URL_TTL, {
          transform: { width: 800, quality: 80, resize: "contain" },
        });
      signed_url = signed?.signedUrl || null;
    }

    out.push({
      id: r.id,
      pdv: r.pdv,
      category: r.category,
      note_date: r.note_date,
      note_date_display,
      score: r.score,
      mood: r.mood,
      remark: r.remark,
      read_at: r.read_at,
      checkin_id: r.checkin_id,
      checkin_photo_path: photo_path,
      checkin_annotations: annotations,
      checkin_signed_url: signed_url,
    });
  }

  return jsonResponse(200, { notes: out, count: out.length });
});
