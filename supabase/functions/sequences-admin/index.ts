// Edge Function : admin CRUD pour séquences guidées
//
// Méthodes :
//   GET  /sequences-admin           → liste toutes les séquences actives + step_count
//   POST /sequences-admin {op,...}  → multiplexe les opérations admin :
//     - { op: "create_sequence", pdv, category, title }
//     - { op: "update_sequence", id, title?, active? }
//     - { op: "delete_sequence", id }
//     - { op: "create_step",     sequence_id, name, hint?, optional?, order_idx? }
//     - { op: "update_step",     id, name?, hint?, optional?, order_idx? }
//     - { op: "delete_step",     id }
//     - { op: "reorder_steps",   sequence_id, step_ids: [id, id, ...] }
//
// Sécu : nécessite un staff authentifié (any). Granularité admin/superviseur
// gérable plus tard si besoin (la surface admin n'est pas exposée côté équipier).

import { adminClient } from "../_shared/db.ts";
import { currentStaff } from "../_shared/auth.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const staff = await currentStaff(req);
  if (!staff) return jsonResponse(401, { error: "Not authenticated" });

  if (req.method === "GET") {
    return await handleList();
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  switch (body?.op) {
    case "create_sequence": return await createSequence(body);
    case "update_sequence": return await updateSequence(body);
    case "delete_sequence": return await deleteSequence(body);
    case "create_step":     return await createStep(body);
    case "update_step":     return await updateStep(body);
    case "delete_step":     return await deleteStep(body);
    case "reorder_steps":   return await reorderSteps(body);
    default:
      return jsonResponse(400, { error: `Unknown op: ${body?.op}` });
  }
});

async function handleList() {
  // Liste séquences actives avec count d'étapes actives
  const { data: seqs, error } = await adminClient
    .from("category_sequences")
    .select("id, pdv, category, title, active, created_at, updated_at")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) return jsonResponse(500, { error: error.message });

  const ids = (seqs || []).map((s: any) => s.id);
  let counts: Record<number, number> = {};
  if (ids.length) {
    const { data: stepRows } = await adminClient
      .from("category_steps")
      .select("sequence_id")
      .in("sequence_id", ids)
      .eq("active", true);
    for (const r of (stepRows || []) as any[]) {
      counts[r.sequence_id] = (counts[r.sequence_id] || 0) + 1;
    }
  }
  const sequences = (seqs || []).map((s: any) => ({
    ...s,
    step_count: counts[s.id] || 0,
  }));
  return jsonResponse(200, { sequences });
}

async function createSequence(body: any) {
  const { pdv, category, title } = body;
  if (!pdv || !category || !title?.trim()) {
    return jsonResponse(400, { error: "pdv, category, title required" });
  }
  // Désactive toute ancienne séquence sur la même paire
  await adminClient
    .from("category_sequences")
    .update({ active: false })
    .eq("pdv", pdv).eq("category", category).eq("active", true);

  const { data, error } = await adminClient
    .from("category_sequences")
    .insert({ pdv, category, title: title.trim(), active: true })
    .select("id")
    .single();
  if (error) return jsonResponse(500, { error: error.message });
  return jsonResponse(200, { ok: true, id: data.id });
}

async function updateSequence(body: any) {
  const { id, title, active } = body;
  if (!id) return jsonResponse(400, { error: "id required" });
  const patch: any = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title = String(title).trim();
  if (active !== undefined) patch.active = !!active;
  const { error } = await adminClient
    .from("category_sequences")
    .update(patch)
    .eq("id", id);
  if (error) return jsonResponse(500, { error: error.message });
  return jsonResponse(200, { ok: true });
}

async function deleteSequence(body: any) {
  const { id } = body;
  if (!id) return jsonResponse(400, { error: "id required" });
  // Soft delete : juste active=false (préserve les checkins.step_id existants)
  const { error } = await adminClient
    .from("category_sequences")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return jsonResponse(500, { error: error.message });
  return jsonResponse(200, { ok: true });
}

async function createStep(body: any) {
  const { sequence_id, name, hint, optional } = body;
  if (!sequence_id || !name?.trim()) {
    return jsonResponse(400, { error: "sequence_id and name required" });
  }
  // Calcule order_idx = max + 1
  const { data: maxRow } = await adminClient
    .from("category_steps")
    .select("order_idx")
    .eq("sequence_id", sequence_id)
    .order("order_idx", { ascending: false })
    .limit(1);
  const nextOrder = ((maxRow?.[0]?.order_idx) ?? 0) + 1;

  const { data, error } = await adminClient
    .from("category_steps")
    .insert({
      sequence_id,
      order_idx: body.order_idx ?? nextOrder,
      name: name.trim(),
      hint: (hint ?? "").trim() || null,
      optional: !!optional,
      active: true,
    })
    .select("id, order_idx, name, hint, optional, active")
    .single();
  if (error) return jsonResponse(500, { error: error.message });
  return jsonResponse(200, { ok: true, step: data });
}

async function updateStep(body: any) {
  const { id, name, hint, optional, order_idx } = body;
  if (!id) return jsonResponse(400, { error: "id required" });
  const patch: any = {};
  if (name !== undefined) patch.name = String(name).trim();
  if (hint !== undefined) patch.hint = String(hint || "").trim() || null;
  if (optional !== undefined) patch.optional = !!optional;
  if (order_idx !== undefined) patch.order_idx = Number(order_idx);
  if (Object.keys(patch).length === 0) return jsonResponse(400, { error: "no field to update" });
  const { error } = await adminClient
    .from("category_steps")
    .update(patch)
    .eq("id", id);
  if (error) return jsonResponse(500, { error: error.message });
  return jsonResponse(200, { ok: true });
}

async function deleteStep(body: any) {
  const { id } = body;
  if (!id) return jsonResponse(400, { error: "id required" });
  // Soft delete : active=false (préserve les checkins existants)
  const { error } = await adminClient
    .from("category_steps")
    .update({ active: false })
    .eq("id", id);
  if (error) return jsonResponse(500, { error: error.message });
  return jsonResponse(200, { ok: true });
}

async function reorderSteps(body: any) {
  const { sequence_id, step_ids } = body;
  if (!sequence_id || !Array.isArray(step_ids)) {
    return jsonResponse(400, { error: "sequence_id and step_ids[] required" });
  }
  // Update order_idx en parallèle
  const ops = step_ids.map((id: number, idx: number) =>
    adminClient
      .from("category_steps")
      .update({ order_idx: idx + 1 })
      .eq("id", id)
      .eq("sequence_id", sequence_id),
  );
  const results = await Promise.all(ops);
  const err = results.find((r: any) => r.error)?.error;
  if (err) return jsonResponse(500, { error: err.message });
  return jsonResponse(200, { ok: true });
}
