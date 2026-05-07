// Edge Function : POST /push-send  (interne — appelée par checkins-annotate)
// Body : { staff_id, payload: { title, body, tag?, url?, ... } }
// Réponse : { sent, failed, errors }
//
// Récupère toutes les push_subscriptions actives pour ce staff_id et envoie
// la notif Web Push VAPID à chacune. Si une subscription échoue avec 410 Gone
// ou 404 Not Found, elle est supprimée de la DB.
//
// Cette fonction n'est PAS exposée publiquement aux clients équipiers ;
// l'Authorization Bearer doit être un staff valide (admin idéalement).

import webpush from "https://esm.sh/web-push@3.6.7";
import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

// ----------------------------------------------------------------------------
// Setup VAPID — fait au cold start, partagé pour toute la fonction
// ----------------------------------------------------------------------------
const VAPID_PUBLIC = Deno.env.get("RISE_VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("RISE_VAPID_PRIVATE_RAW") || "";
const VAPID_SUBJECT = Deno.env.get("RISE_VAPID_SUBJECT") || "mailto:noreply@example.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  // Auth requis (any staff). Note : en dur on autorise tout staff connecté
  // pour appeler ce endpoint depuis checkins-annotate.
  const caller = await currentStaff(req);
  if (!caller) return jsonResponse(401, { error: "Not authenticated" });

  let body: { staff_id?: number; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const staffId = body.staff_id;
  const payload = body.payload || {};
  if (!staffId || typeof staffId !== "number") {
    return jsonResponse(400, { error: "staff_id (int) required" });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return jsonResponse(500, { error: "VAPID keys not configured" });
  }

  const { data: subs, error } = await adminClient
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("staff_id", staffId);

  if (error) return jsonResponse(500, { error: error.message });
  if (!subs || subs.length === 0) {
    return jsonResponse(200, { sent: 0, failed: 0, note: "no subscriptions" });
  }

  let sent = 0, failed = 0;
  const errors: string[] = [];

  for (const sub of subs as SubRow[]) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
      );
      sent++;
      // Touch last_used_at (best-effort)
      await adminClient
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", sub.id);
    } catch (e: unknown) {
      failed++;
      // deno-lint-ignore no-explicit-any
      const err = e as any;
      const status = err?.statusCode || 0;
      errors.push(`sub#${sub.id}: ${status} ${err?.body || err?.message || ""}`);
      // Cleanup expired subs
      if (status === 404 || status === 410) {
        await adminClient.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }

  return jsonResponse(200, { sent, failed, errors });
});
