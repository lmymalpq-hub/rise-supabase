// Edge Function : GET /me/dopamine-stats
// Réponse : {
//   bons_points_total: N,
//   streak_days: N,
//   record_streak: N,
//   this_week: N,
//   last_week: N
// }
//
// Bons points = mood IN ('thumb_up', 'excellent') OU (legacy) score >= 7.
// Excellence = 2 bons points (vs 1 pour thumb_up).
// Streak = jours consécutifs récents avec ≥1 bon point ET aucun thumb_down.
// Reset au 1er thumb_down.

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

interface NoteRow {
  note_date: string;
  mood: string | null;
  score: number | null;
}

function isGood(n: NoteRow): { good: boolean; excellent: boolean } {
  const isExcellent = n.mood === "excellent";
  const isGoodMood = n.mood === "thumb_up" || isExcellent;
  const isLegacyGood = n.mood == null && n.score != null && n.score >= 7;
  return { good: isGoodMood || isLegacyGood, excellent: isExcellent };
}

function dayKey(noteDate: string): string {
  // note_date peut être "YYYY-MM-DD" ou "YYYY-MM-DD#cN" → on prend les 10 premiers chars
  return (noteDate || "").slice(0, 10);
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });

  const { data: rows, error } = await adminClient
    .from("staff_notes")
    .select("note_date, mood, score")
    .eq("staff_id", staff.id)
    .order("note_date");

  if (error) {
    return jsonResponse(500, { error: `DB query failed: ${error.message}` });
  }

  // Aggregate par jour
  const byDay: Record<string, { good: number; bad: boolean }> = {};
  let bonsPoints = 0;

  for (const r of (rows || []) as NoteRow[]) {
    const d = dayKey(r.note_date);
    if (!d) continue;
    const { good, excellent } = isGood(r);
    const bad = r.mood === "thumb_down";
    if (good) bonsPoints += excellent ? 2 : 1;
    if (!byDay[d]) byDay[d] = { good: 0, bad: false };
    if (good) byDay[d].good += 1;
    if (bad) byDay[d].bad = true;
  }

  // Streak actuel : on remonte de aujourd'hui jour par jour
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fmt = (d: Date) =>
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0");

  let streakDays = 0;
  const cur = new Date(today);
  for (let i = 0; i < 365; i++) {
    const ds = fmt(cur);
    if (byDay[ds]) {
      if (byDay[ds].bad) break;
      if (byDay[ds].good > 0) streakDays += 1;
    } else if (i > 0) {
      // Jour vide après aujourd'hui → fin de streak
      break;
    }
    cur.setDate(cur.getDate() - 1);
  }

  // Record : la plus longue suite jamais atteinte
  let record = 0;
  let curRun = 0;
  let prev: Date | null = null;
  const sortedDates = Object.keys(byDay).sort();
  for (const ds of sortedDates) {
    const dObj = new Date(ds + "T00:00:00");
    if (prev !== null) {
      const diff = Math.round((dObj.getTime() - prev.getTime()) / 86400000);
      if (diff !== 1) curRun = 0;
    }
    if (byDay[ds].bad) {
      curRun = 0;
    } else if (byDay[ds].good > 0) {
      curRun += 1;
    }
    if (curRun > record) record = curRun;
    prev = dObj;
  }

  // This week / last week (lundi-dimanche)
  function weekStart(d: Date): Date {
    const r = new Date(d);
    const dow = (r.getDay() + 6) % 7; // lundi = 0
    r.setDate(r.getDate() - dow);
    r.setHours(0, 0, 0, 0);
    return r;
  }
  const wsNow = weekStart(today);
  const wsPrev = new Date(wsNow);
  wsPrev.setDate(wsPrev.getDate() - 7);

  function countGoodBetween(start: Date, endExcl: Date): number {
    let n = 0;
    for (const ds of Object.keys(byDay)) {
      const dObj = new Date(ds + "T00:00:00");
      if (dObj >= start && dObj < endExcl) {
        n += byDay[ds].good;
      }
    }
    return n;
  }
  const thisWeek = countGoodBetween(wsNow, new Date(wsNow.getTime() + 7 * 86400000));
  const lastWeek = countGoodBetween(wsPrev, wsNow);

  return jsonResponse(200, {
    bons_points_total: bonsPoints,
    streak_days: streakDays,
    record_streak: Math.max(record, streakDays),
    this_week: thisWeek,
    last_week: lastWeek,
  });
});
