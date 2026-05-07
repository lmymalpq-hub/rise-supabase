// Edge Function : POST /voice-briefings-create
// multipart/form-data : { audio: File, pdv, zone, service_date, service_slot }
// Pipeline complet :
//   1. Upload audio dans bucket privé "voicenotes"
//   2. Insert voice_briefing en status 'transcribing'
//   3. Appel Gemini API pour transcrire l'audio (modèle gemini-2.0-flash)
//   4. Update voice_briefing avec raw_transcription + synthesis + status 'done'
//
// Réponse : { ok, briefing_id, raw_transcription, synthesis }
//
// ⚠️ Cette fonction peut prendre 30-60s pour la transcription Gemini.
// Edge Functions Supabase ont une limite de 60s pour les requêtes synchrones.
// Si la transcription est trop longue, faire le pipeline en async (à voir).

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

const GEMINI_API_KEY = Deno.env.get("RISE_GEMINI_API_KEY") || "";
const GEMINI_MODEL = "gemini-2.0-flash";

const ALLOWED_PDVS = new Set(["vh", "marais"]);
const ALLOWED_ZONES = new Set(["salle", "cuisine"]);
const ALLOWED_SLOTS = new Set(["morning", "afternoon", "full_day"]);
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

function pad2(n: number) { return String(n).padStart(2, "0"); }

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });
  // TODO durcir : vérifier is_supervisor=true

  if (!GEMINI_API_KEY) {
    return jsonResponse(500, { error: "RISE_GEMINI_API_KEY not configured" });
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return jsonResponse(400, { error: "Invalid multipart body" }); }

  const pdv = (form.get("pdv") as string | null)?.trim() || "";
  const zone = (form.get("zone") as string | null)?.trim() || "";
  const serviceDate = (form.get("service_date") as string | null)?.trim() || "";
  const serviceSlot = (form.get("service_slot") as string | null)?.trim() || "full_day";
  const audio = form.get("audio");

  if (!ALLOWED_PDVS.has(pdv))   return jsonResponse(400, { error: "pdv invalide" });
  if (!ALLOWED_ZONES.has(zone)) return jsonResponse(400, { error: "zone invalide" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return jsonResponse(400, { error: "service_date doit être YYYY-MM-DD" });
  if (!ALLOWED_SLOTS.has(serviceSlot)) return jsonResponse(400, { error: "service_slot invalide" });
  if (!(audio instanceof File)) return jsonResponse(400, { error: "audio (File) requis" });
  if (audio.size > MAX_AUDIO_BYTES) return jsonResponse(413, { error: "audio > 50MB" });

  // 1. Upload audio
  const now = new Date();
  const ts = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const ext = audio.type.includes("webm") ? "webm"
            : audio.type.includes("mp4")  ? "m4a"
            : audio.type.includes("mpeg") ? "mp3"
            : audio.type.includes("wav")  ? "wav"
            : "bin";
  const audioPath = `${pdv}/${serviceDate}/${zone}-${ts}-staff${staff.id}.${ext}`;

  const { error: upErr } = await adminClient.storage
    .from("voicenotes")
    .upload(audioPath, audio, {
      contentType: audio.type || "audio/webm",
      upsert: false,
    });
  if (upErr) return jsonResponse(500, { error: `Audio upload failed: ${upErr.message}` });

  // 2. Insert briefing en transcribing
  const { data: briefing, error: insErr } = await adminClient
    .from("voice_briefings")
    .insert({
      pdv, zone,
      service_date: serviceDate,
      service_slot: serviceSlot,
      supervisor_staff_id: staff.id,
      supervisor_name: staff.name,
      status: "transcribing",
      audio_files: [{
        filename: audioPath,
        size: audio.size,
        uploaded_at: new Date().toISOString(),
      }],
    })
    .select("id")
    .single();
  if (insErr || !briefing) {
    return jsonResponse(500, { error: `DB insert failed: ${insErr?.message || "unknown"}` });
  }

  const briefingId = briefing.id;

  // 3. Transcription Gemini
  // On télécharge l'audio depuis Storage (signed URL temporaire) et on l'envoie
  // en base64 inline à Gemini. Limite ~20MB pour l'inline ; au-delà il faut
  // utiliser File API, on n'y est pas pour l'instant.
  let rawTranscription = "";
  let synthesis = "";
  let synthesisMeta: Record<string, unknown> = {};
  let finalStatus = "done";
  let errorMsg: string | null = null;

  try {
    // Lire les bytes audio
    const audioBuf = await audio.arrayBuffer();
    const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuf)));

    // Récupérer le canevas (framework) pour cette zone
    const { data: framework } = await adminClient
      .from("frameworks")
      .select("content")
      .eq("zone", zone)
      .maybeSingle();

    const frameworkContent = framework?.content || "";

    const prompt = `Tu es l'assistant de Marwan, gérant des LPQ Victor Hugo et Marais.
Le superviseur du PdV vient d'enregistrer un briefing audio post-service ${serviceDate} ${serviceSlot} (zone ${zone}).
Transcris fidèlement l'audio en français, puis fais une synthèse structurée selon le canevas suivant :

${frameworkContent || "(pas de canevas configuré — fais une synthèse libre en bullets concises)"}

Format de réponse :
=== TRANSCRIPTION ===
<la transcription brute>

=== SYNTHESE ===
<la synthèse structurée>`;

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: audio.type || "audio/webm", data: audioBase64 } },
            ],
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
          },
        }),
      },
    );

    if (!geminiResp.ok) {
      const errBody = await geminiResp.text();
      throw new Error(`Gemini ${geminiResp.status}: ${errBody.slice(0, 200)}`);
    }

    const result = await geminiResp.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) throw new Error("Gemini returned empty text");

    // Split TRANSCRIPTION / SYNTHESE
    const m = text.match(/===\s*TRANSCRIPTION\s*===\s*([\s\S]*?)===\s*SYNTHESE\s*===\s*([\s\S]*)/i);
    if (m) {
      rawTranscription = m[1].trim();
      synthesis = m[2].trim();
    } else {
      rawTranscription = text;
      synthesis = "(pas de synthèse séparée extraite)";
    }
    synthesisMeta = {
      model: GEMINI_MODEL,
      tokens_in: result?.usageMetadata?.promptTokenCount || null,
      tokens_out: result?.usageMetadata?.candidatesTokenCount || null,
    };
  } catch (e: unknown) {
    finalStatus = "failed";
    errorMsg = (e instanceof Error) ? e.message : String(e);
  }

  // 4. Update briefing
  await adminClient
    .from("voice_briefings")
    .update({
      status: finalStatus,
      raw_transcription: rawTranscription || null,
      synthesis: synthesis || null,
      synthesis_meta: synthesisMeta,
      error_msg: errorMsg,
      finished_at: new Date().toISOString(),
    })
    .eq("id", briefingId);

  return jsonResponse(200, {
    ok: finalStatus === "done",
    briefing_id: briefingId,
    status: finalStatus,
    raw_transcription: rawTranscription,
    synthesis,
    error: errorMsg,
  });
});
