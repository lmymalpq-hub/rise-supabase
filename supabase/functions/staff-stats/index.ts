// Edge Function : GET /staff/:id/stats (admin)
// Query : ?id=N&window_days=30
// Réponse : {
//   identity: { id, name, pdvs, active, is_supervisor, created_at, last_login },
//   totals: { total_checkins, total_notes, unread_notes, ack_rate, median_ack_delay_minutes },
//   recidives: [{ pdv, category, n }],
//   timeline: [{ ...note, photo_path, annotations, ack_delay_minutes, note_date_display }]
// }
//
// Équivalent fonctionnel de db.staff_full_stats() côté Python (Sprint 5).
// Aujourd'hui pas d'auth admin distinct ; à durcir quand le SPA admin sera là.

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

function isoDateMinusDays(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function diffMinutes(t0: string | null, t1: string | null): number | null {
  if (!t0 || !t1) return null;
  try {
    const a = new Date(t0).getTime();
    const b = new Date(t1).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.max(0, Math.round((b - a) / 60000));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const admin = await currentStaff(req);
  if (!admin) return jsonResponse(401, { error: "Not authenticated" });

  const url = new URL(req.url);
  const idStr = url.searchParams.get("id");
  if (!idStr || !/^\d+$/.test(idStr)) {
    return jsonResponse(400, { error: "?id=<staff_id> required" });
  }
  const sid = parseInt(idStr, 10);
  const windowDays = parseInt(url.searchParams.get("window_days") || "30", 10);

  // Identity
  const { data: identity, error: idErr } = await adminClient
    .from("staff")
    .select("id, name, pdvs, active, is_supervisor, created_at, last_login, onboarded_at")
    .eq("id", sid)
    .single();

  if (idErr || !identity) {
    return jsonResponse(404, { error: "Staff not found" });
  }

  // Total checkins
  const { count: totalCheckins } = await adminClient
    .from("checkins")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", sid);

  // Total notes + unread + ack_rate
  const { count: totalNotes } = await adminClient
    .from("staff_notes")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", sid);

  const { count: unreadNotes } = await adminClient
    .from("staff_notes")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", sid)
    .is("read_at", null);

  const ackRate =
    totalNotes && totalNotes > 0
      ? Math.round((1000 * (totalNotes - (unreadNotes || 0))) / totalNotes) / 10
      : null;

  // Délai médian d'acquit — fetch les paires (updated_at, read_at) côté staff_notes
  // Note : updated_at n'est plus dans le SELECT public mais on en a besoin ici,
  // donc on fait une query dédiée
  const { data: ackDelays } = await adminClient
    .from("staff_notes")
    .select("updated_at, read_at")
    .eq("staff_id", sid)
    .not("read_at", "is", null);

  const delays: number[] = [];
  for (const r of (ackDelays || [])) {
    const d = diffMinutes(r.updated_at, r.read_at);
    if (d !== null) delays.push(d);
  }
  delays.sort((a, b) => a - b);
  const medianAckDelayMinutes = delays.length > 0 ? delays[Math.floor(delays.length / 2)] : null;

  // Récidives sur window_days : count par (pdv, category) HAVING > 1
  const sinceDate = isoDateMinusDays(windowDays);
  const { data: recidiveRows } = await adminClient
    .from("staff_notes")
    .select("pdv, category, note_date")
    .eq("staff_id", sid);

  const recCount: Record<string, { pdv: string; category: string; n: number }> = {};
  for (const r of (recidiveRows || [])) {
    const dateStr = (r.note_date as string || "").slice(0, 10);
    if (dateStr < sinceDate) continue;
    const key = `${r.pdv}|${r.category}`;
    if (!recCount[key]) recCount[key] = { pdv: r.pdv, category: r.category, n: 0 };
    recCount[key].n += 1;
  }
  const recidives = Object.values(recCount)
    .filter((x) => x.n > 1)
    .sort((a, b) => b.n - a.n);

  // Timeline 20 derniers feedbacks
  const { data: timelineRows } = await adminClient
    .from("staff_notes")
    .select(`
      id, pdv, category, note_date, score, mood, remark,
      created_at, updated_at, read_at, checkin_id,
      checkin:checkin_id(photo_path, annotations)
    `)
    .eq("staff_id", sid)
    .order("updated_at", { ascending: false })
    .limit(20);

  const timeline = (timelineRows || []).map((r) => {
    const nd = (r.note_date as string) || "";
    const note_date_display = nd.includes("#") ? nd.split("#")[0] : nd;
    // deno-lint-ignore no-explicit-any
    const ck = (r as any).checkin;
    return {
      id: r.id,
      pdv: r.pdv,
      category: r.category,
      note_date: r.note_date,
      note_date_display,
      score: r.score,
      mood: r.mood,
      remark: r.remark,
      created_at: r.created_at,
      updated_at: r.updated_at,
      read_at: r.read_at,
      checkin_id: r.checkin_id,
      photo_path: ck?.photo_path ?? null,
      annotations: ck?.annotations ?? [],
      ack_delay_minutes: diffMinutes(r.updated_at as string, r.read_at as string | null),
    };
  });

  return jsonResponse(200, {
    identity,
    totals: {
      total_checkins: totalCheckins || 0,
      total_notes: totalNotes || 0,
      unread_notes: unreadNotes || 0,
      ack_rate: ackRate,
      median_ack_delay_minutes: medianAckDelayMinutes,
    },
    recidives,
    timeline,
    window_days: windowDays,
  });
});
