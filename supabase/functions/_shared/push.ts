// Helper Web Push VAPID partagé entre push-send et checkins-annotate.

import webpush from "https://esm.sh/web-push@3.6.7";
import { adminClient } from "./db.ts";

const VAPID_PUBLIC = Deno.env.get("RISE_VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("RISE_VAPID_PRIVATE_RAW") || "";
const VAPID_SUBJECT = Deno.env.get("RISE_VAPID_SUBJECT") || "mailto:noreply@example.com";

let configured = false;
function ensureVapid() {
  if (!configured && VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    configured = true;
  }
  return configured;
}

export async function pushToStaff(
  staffId: number,
  payload: Record<string, unknown>,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  if (!ensureVapid()) {
    return { sent: 0, failed: 0, errors: ["VAPID not configured"] };
  }

  const { data: subs, error } = await adminClient
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("staff_id", staffId);

  if (error || !subs || subs.length === 0) {
    return { sent: 0, failed: 0, errors: error ? [error.message] : [] };
  }

  let sent = 0, failed = 0;
  const errors: string[] = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
        },
        JSON.stringify(payload),
      );
      sent++;
      await adminClient
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", sub.id);
    } catch (e: unknown) {
      failed++;
      // deno-lint-ignore no-explicit-any
      const err = e as any;
      const status = err?.statusCode || 0;
      errors.push(`sub#${sub.id}: ${status}`);
      if (status === 404 || status === 410) {
        await adminClient.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }

  return { sent, failed, errors };
}
