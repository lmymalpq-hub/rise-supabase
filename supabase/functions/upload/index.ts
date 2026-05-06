// Edge Function : POST /upload
// Body : multipart/form-data avec :
//   - photo : File (le binaire JPEG/PNG)
//   - pdv : "vh" | "marais"
//   - category : "terrasse" | "comptoir" | ...
//   - note : string (optionnel)
// Réponse OK : { ok: true, checkin_id, photo_path }
//
// Auth : Authorization: Bearer <token> (récupéré via /auth)
//
// Pipeline :
//   1. Vérifie le token et récupère le staff
//   2. Lit le multipart, valide le PdV/catégorie
//   3. Construit le path : <pdv>/<YYYY-MM-DD>/<HHMMSS>-<random6>_<category>.jpg
//   4. Upload vers Storage bucket "rise-uploads"
//   5. Insert checkin Postgres

import { adminClient, UPLOADS_BUCKET } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

const ALLOWED_PDVS = new Set(["vh", "marais"]);
const ALLOWED_CATS = new Set([
  "terrasse",
  "comptoir",
  "pertes-comptoir",
  "nettoyage-comptoir",
  "fermeture-comptoir",
  "pertes-cuisine",
  "nettoyage-cuisine",
  "fermeture-cuisine",
  "fermeture-salle",
]);
const MAX_PHOTO_BYTES = 12 * 1024 * 1024; // 12 MB safety net

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildPhotoPath(pdv: string, category: string): string {
  const now = new Date();
  const ymd =
    now.getFullYear() +
    "-" +
    pad2(now.getMonth() + 1) +
    "-" +
    pad2(now.getDate());
  const hms = pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
  // 6 chars random pour éviter les collisions multi-uploads simultanés
  const rand = crypto
    .getRandomValues(new Uint8Array(3))
    .reduce((acc, b) => acc + b.toString(16).padStart(2, "0"), "");
  return `${pdv}/${ymd}/${hms}-${rand}_${category}.jpg`;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  // Auth
  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });

  // Parse multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse(400, { error: "Invalid multipart body" });
  }

  const pdv = (form.get("pdv") as string | null)?.trim() || "";
  const category = (form.get("category") as string | null)?.trim() || "";
  const note = (form.get("note") as string | null)?.trim() || null;
  const photo = form.get("photo");

  if (!ALLOWED_PDVS.has(pdv)) {
    return jsonResponse(400, { error: `pdv invalide (autorisés : ${[...ALLOWED_PDVS].join(", ")})` });
  }
  if (!ALLOWED_CATS.has(category)) {
    return jsonResponse(400, { error: `category invalide` });
  }
  if (!(photo instanceof File)) {
    return jsonResponse(400, { error: "Champ 'photo' (File) requis" });
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return jsonResponse(413, { error: `Photo > ${MAX_PHOTO_BYTES} octets` });
  }

  // Path + upload Storage
  const photoPath = buildPhotoPath(pdv, category);
  const photoBytes = photo.size;

  const { error: upErr } = await adminClient.storage
    .from(UPLOADS_BUCKET)
    .upload(photoPath, photo, {
      contentType: photo.type || "image/jpeg",
      upsert: false,
    });

  if (upErr) {
    return jsonResponse(500, { error: `Storage upload failed: ${upErr.message}` });
  }

  // Insert checkin
  const { data: row, error: insErr } = await adminClient
    .from("checkins")
    .insert({
      pdv,
      category,
      photo_path: photoPath,
      photo_bytes: photoBytes,
      note,
      staff_id: staff.id,
      user_label: staff.name,
      status: "ok",
    })
    .select("id, created_at")
    .single();

  if (insErr || !row) {
    // Best-effort cleanup : tente de supprimer le fichier qu'on vient d'uploader
    await adminClient.storage.from(UPLOADS_BUCKET).remove([photoPath]);
    return jsonResponse(500, { error: `DB insert failed: ${insErr?.message || "unknown"}` });
  }

  return jsonResponse(201, {
    ok: true,
    checkin_id: row.id,
    photo_path: photoPath,
    created_at: row.created_at,
  });
});
