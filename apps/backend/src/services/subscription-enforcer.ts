/**
 * Subscription Enforcer
 *
 * Runs periodically and stops containers for users whose subscription
 * is no longer active AND whose paid period has ended.
 *
 * Rules:
 * - Only stops containers, NEVER deletes them.
 * - A subscription with status "active" is always allowed.
 * - A non-active subscription (on_hold, cancelled, failed, expired) is allowed
 *   to keep running until current_period_end passes.
 * - If current_period_end is NULL on a non-active subscription, the container
 *   is stopped immediately (we have no proof of remaining paid time).
 */

import { db } from "../db";
import { subscriptions, instances } from "../db/schema";
import { sql, eq, and } from "drizzle-orm";
import { stopInstance, getStatus } from "./docker";

const CHECK_INTERVAL_MS = 60_000; // every 1 minute

/**
 * Find subscriptions that are non-active and past their paid period,
 * then stop the associated containers.
 */
async function enforceExpiredSubscriptions(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Find subscriptions where:
  // 1. status is NOT 'active'
  // 2. current_period_end IS NULL or current_period_end < now
  const expired = await db
    .select({
      subId: subscriptions.id,
      userId: subscriptions.userId,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      dodoSubscriptionId: subscriptions.dodoSubscriptionId,
    })
    .from(subscriptions)
    .where(
      and(
        sql`${subscriptions.status} NOT IN ('active', 'pending')`,
        sql`(${subscriptions.currentPeriodEnd} IS NULL OR ${subscriptions.currentPeriodEnd} < ${now})`
      )
    );

  if (expired.length === 0) return;

  for (const sub of expired) {
    // Find running instances for this user
    const userInstances = await db
      .select({
        id: instances.id,
        containerId: instances.containerId,
        status: instances.status,
      })
      .from(instances)
      .where(
        and(
          eq(instances.userId, sub.userId),
          sql`${instances.status} IN ('running', 'pending')`
        )
      );

    for (const inst of userInstances) {
      if (!inst.containerId) continue;

      // Verify the container is actually running before trying to stop
      try {
        const containerStatus = await getStatus(inst.containerId);
        if (containerStatus !== "running" && containerStatus !== "restarting") {
          // Already stopped — just update DB status
          await db
            .update(instances)
            .set({ status: "stopped", stoppedAt: new Date() })
            .where(eq(instances.id, inst.id));
          continue;
        }

        console.log(
          `[enforcer] Stopping container for user ${sub.userId} — subscription ${sub.dodoSubscriptionId} is ${sub.status}, period ended ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd as any).toISOString() : "unknown"}`
        );

        await stopInstance(inst.containerId);

        // Update instance status in DB
        await db
          .update(instances)
          .set({ status: "stopped", stoppedAt: new Date() })
          .where(eq(instances.id, inst.id));

        console.log(
          `[enforcer] Stopped instance ${inst.id} (container ${inst.containerId.slice(0, 12)}) for user ${sub.userId}`
        );
      } catch (err) {
        console.error(
          `[enforcer] Failed to stop instance ${inst.id} for user ${sub.userId}:`,
          err
        );
      }
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic subscription enforcer.
 * Safe to call multiple times — only starts once.
 */
export function startSubscriptionEnforcer(): void {
  if (intervalHandle) return;

  console.log(
    `[enforcer] Starting subscription enforcer (checking every ${CHECK_INTERVAL_MS / 1000}s)`
  );

  // Run once immediately on startup
  enforceExpiredSubscriptions().catch((err) => {
    console.error("[enforcer] Error on initial check:", err);
  });

  intervalHandle = setInterval(() => {
    enforceExpiredSubscriptions().catch((err) => {
      console.error("[enforcer] Error during periodic check:", err);
    });
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the periodic subscription enforcer.
 */
export function stopSubscriptionEnforcer(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[enforcer] Stopped subscription enforcer");
  }
}
