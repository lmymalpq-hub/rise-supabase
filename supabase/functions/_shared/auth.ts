// Auth helpers partagés entre Edge Functions :
//   - hashPin / verifyPin : compatibles avec la version Python (PBKDF2-SHA256 200k iter)
//   - peppered prefix HMAC : pour anti brute-force PIN sans stocker le PIN en clair
//   - currentStaff : extrait le staff_id depuis le header Authorization Bearer <token>
//
// Compatibilité Python : on utilise EXACTEMENT les mêmes paramètres que server.py
// (200000 iterations, SHA-256, sortie hex) pour que les PINs créés côté Python
// fonctionnent côté TypeScript après migration des données.

import { adminClient } from "./db.ts";

const PBKDF2_ITERATIONS = 200_000;
const HASH_ALGO = "SHA-256";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const salt = hexToBytes(saltHex);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: HASH_ALGO },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hmacPepper(message: string): Promise<string> {
  const pepper = Deno.env.get("RISE_PIN_PEPPER");
  if (!pepper) {
    throw new Error("RISE_PIN_PEPPER not set in Edge Function env");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pepper),
    { name: "HMAC", hash: HASH_ALGO },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

export function genSaltHex(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function genTokenUrlSafe(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  // url-safe base64
  let b64 = btoa(String.fromCharCode(...buf));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Vérifie un PIN soumis par un équipier. Retourne le staff_id si OK, null sinon.
// Utilise la même logique d'unicité que la version Python : cherche les staff
// dont le prefix_hash_<len> match, puis vérifie le hash complet.
export async function verifyPin(pin: string): Promise<{ id: number; name: string } | null> {
  const len = pin.length;
  if (len < 4 || len > 6) return null;

  const prefixField = `prefix_hash_${len}`;
  const prefixHmac = await hmacPepper(pin);

  // 1. Trouver les candidats par prefix HMAC (rapide via index)
  const { data: candidates, error } = await adminClient
    .from("staff")
    .select("id, name, pin_hash, pin_salt, pin_length, active")
    .eq("active", true)
    .eq(prefixField, prefixHmac)
    .eq("pin_length", len);

  if (error || !candidates || candidates.length === 0) return null;

  // 2. Pour chaque candidat, recalcule le hash complet et compare en constant time
  for (const c of candidates) {
    const candidateHash = await hashPin(pin, c.pin_salt);
    if (constantTimeEqual(candidateHash, c.pin_hash)) {
      return { id: c.id, name: c.name };
    }
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Extrait le staff connecté depuis Authorization: Bearer <token>
// Met à jour last_used_at et étend la session.
export async function currentStaff(req: Request): Promise<{ id: number; name: string; token: string } | null> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const { data: session, error } = await adminClient
    .from("sessions")
    .select("staff_id, expires_at, staff:staff_id(id, name, active)")
    .eq("token", token)
    .single();

  if (error || !session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  // deno-lint-ignore no-explicit-any
  const staff = (session as any).staff;
  if (!staff || !staff.active) return null;

  // Touch session (best-effort, on ne bloque pas si ça échoue)
  await adminClient
    .from("sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token", token);

  return { id: staff.id, name: staff.name, token };
}

export function newSessionExpiry(): string {
  // 30 jours, comme la version Python
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}
