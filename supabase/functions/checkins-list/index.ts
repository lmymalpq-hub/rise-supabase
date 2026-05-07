// Edge Function : GET /checkins (admin)
// Query params optionnels :
//   pdv, category, user (label), staff_id, status (ok|archived),
//   from (YYYY-MM-DD), to (YYYY-MM-DD), limit (default 200)
// Réponse : { checkins: [...], count }
//
// Pour chaque checkin retourné :
//   id, pdv, category, photo_path, photo_bytes, note, staff_id, user_label,
//   created_at, status, annotations, photo_signed_url (TTL 1h pour bucket privé)

import { adminClient, UPLOADS_BUCKET } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

const SIGNED_URL_TTL = 3600;

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "GET") return jsonResponse(405, { error: "Method Not Allowed" });

  const admin = await currentStaff(req);
  if (!admin) return jsonResponse(401, { error: "Not authenticated" });

  const url = new URL(req.url);
  const pdv = url.searchParams.get("pdv") || null;
  const category = url.searchParams.get("category") || null;
  const userLabel = url.searchParams.get("user") || null;
  const staffId = url.searchParams.get("staff_id") || null;
  const status = url.searchParams.get("status") || null;
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  const limit = Math.min(500, parseInt(url.searchParams.get("limit") || "200", 10));

  let q = adminClient
    .from("checkins")
    .select("id, pdv, category, photo_path, photo_bytes, note, staff_id, user_label, created_at, status, annotations")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (pdv)       q = q.eq("pdv", pdv);
  if (category)  q = q.eq("category", category);
  if (userLabel) q = q.eq("user_label", userLabel);
  if (staffId)   q = q.eq("staff_id", parseInt(staffId, 10));
  if (status)    q = q.eq("status", status);
  if (from)      q = q.gte("created_at", from);
  if (to)        q = q.lte("created_at", to + "T23:59:59");

  const { data: rows, error } = await q;
  if (error) return jsonResponse(500, { error: `DB query failed: ${error.message}` });

  // Sign URLs for private bucket
  const out = [];
  for (const r of rows || []) {
    let signed: string | null = null;
    if (r.photo_path) {
      const { data: s } = await adminClient.storage.from(UPLOADS_BUCKET).createSignedUrl(r.photo_path, SIGNED_URL_TTL);
      signed = s?.signedUrl ?? null;
    }
    out.push({ ...r, photo_signed_url: signed });
  }

  return jsonResponse(200, { checkins: out, count: out.length });
});
