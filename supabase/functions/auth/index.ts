// Edge Function : POST /auth
// Body : { pin: "1234" }
// Réponse OK : { token, staff_id, name, is_supervisor }
// Réponse KO : { error: "..." }
//
// Compatible avec les PINs créés par la version Python — même algorithme
// PBKDF2-SHA256 200k iter + pepper HMAC pour les prefix hashes.
//
// Anti brute-force : delay 600ms à chaque échec (comme la version Python).

import { adminClient } from "../_shared/db.ts";
import {
  verifyPin,
  genTokenUrlSafe,
  newSessionExpiry,
} from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

const FAIL_DELAY_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const pin = (body.pin || "").trim();
  if (!/^\d{4,6}$/.test(pin)) {
    await sleep(FAIL_DELAY_MS);
    return jsonResponse(400, { error: "PIN doit être 4 à 6 chiffres" });
  }

  // Vérifie le PIN
  const staff = await verifyPin(pin);
  if (!staff) {
    await sleep(FAIL_DELAY_MS);
    return jsonResponse(401, { error: "PIN incorrect" });
  }

  // Crée la session
  const token = genTokenUrlSafe();
  const expiresAt = newSessionExpiry();

  const { error: sessErr } = await adminClient.from("sessions").insert({
    token,
    staff_id: staff.id,
    expires_at: expiresAt,
  });
  if (sessErr) {
    return jsonResponse(500, { error: "Could not create session" });
  }

  // Update last_login + récupère is_supervisor
  const { data: full } = await adminClient
    .from("staff")
    .select("id, name, is_supervisor")
    .eq("id", staff.id)
    .single();

  await adminClient
    .from("staff")
    .update({ last_login: new Date().toISOString() })
    .eq("id", staff.id);

  return jsonResponse(200, {
    ok: true,
    token,
    staff_id: staff.id,
    name: staff.name,
    is_supervisor: !!full?.is_supervisor,
    expires_at: expiresAt,
  });
});
