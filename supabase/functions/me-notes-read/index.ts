// Edge Function : POST /me/notes/:id/read
// L'équipier acquitte une remarque qu'il a reçue ("J'ai lu et compris").
//
// Body : aucun (le note_id est dans l'URL)
// Réponse OK : { ok: true, read_at: "..." }
//
// Sécurité : on vérifie que la note appartient bien au staff connecté
// avant d'updater. Idempotent : si déjà lu, on ne touche pas read_at.

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });

  // Le note_id est passé en query param (?id=N) — Supabase Edge Functions ne
  // routent pas par segments d'URL natifs, on simule en query param.
  const url = new URL(req.url);
  const idStr = url.searchParams.get("id");
  if (!idStr || !/^\d+$/.test(idStr)) {
    return jsonResponse(400, { error: "?id=<note_id> required" });
  }
  const noteId = parseInt(idStr, 10);

  // Update conditionnel : read_at NULL ET note appartient au staff
  const nowIso = new Date().toISOString();
  const { data, error } = await adminClient
    .from("staff_notes")
    .update({ read_at: nowIso })
    .eq("id", noteId)
    .eq("staff_id", staff.id)
    .is("read_at", null)
    .select("id, read_at")
    .single();

  if (error) {
    // Si déjà lue OU note pas à lui, l'update ne match aucune row → not single
    // On retourne 200 quand même pour idempotence (l'équipier n'a pas à savoir
    // si la note était déjà lue)
    return jsonResponse(200, { ok: true, already_read: true });
  }

  return jsonResponse(200, { ok: true, read_at: data?.read_at, note_id: data?.id });
});
