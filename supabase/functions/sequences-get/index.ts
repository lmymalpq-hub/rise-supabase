// Edge Function : GET /sequences?pdv=X&category=Y
// Réponse : { sequence: {...}, steps: [...] } ou { sequence: null, steps: [] }
//
// Si la combinaison pdv+category a une séquence active, retourne la séquence
// + ses étapes ordonnées. Sinon, l'app continue en mode libre (juste prendre
// une photo simple).

import { adminClient, UPLOADS_BUCKET } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

const SIGNED_URL_TTL = 3600;

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "GET") return jsonResponse(405, { error: "Method Not Allowed" });

  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });

  const url = new URL(req.url);
  const pdv = url.searchParams.get("pdv");
  const category = url.searchParams.get("category");
  if (!pdv || !category) {
    return jsonResponse(400, { error: "?pdv=...&category=... required" });
  }

  const { data: seq, error: seqErr } = await adminClient
    .from("category_sequences")
    .select("id, pdv, category, title, active, created_at, updated_at")
    .eq("pdv", pdv)
    .eq("category", category)
    .eq("active", true)
    .maybeSingle();

  if (seqErr || !seq) {
    return jsonResponse(200, { sequence: null, steps: [] });
  }

  const { data: stepsRaw } = await adminClient
    .from("category_steps")
    .select("id, sequence_id, order_idx, name, hint, model_photo_path, model_annotations, optional, active")
    .eq("sequence_id", seq.id)
    .eq("active", true)
    .order("order_idx");

  // Sign URLs pour les photos modèles (stockées dans rise-uploads ou ailleurs ?)
  // Pour l'instant on suppose qu'elles sont dans le bucket privé rise-uploads.
  const steps = [];
  for (const s of stepsRaw || []) {
    let modelUrl: string | null = null;
    if (s.model_photo_path) {
      const { data: signed } = await adminClient.storage
        .from(UPLOADS_BUCKET)
        .createSignedUrl(s.model_photo_path, SIGNED_URL_TTL);
      modelUrl = signed?.signedUrl ?? null;
    }
    steps.push({ ...s, model_signed_url: modelUrl });
  }

  return jsonResponse(200, { sequence: seq, steps });
});
