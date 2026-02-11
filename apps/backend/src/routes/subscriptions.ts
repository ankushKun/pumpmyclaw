import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import DodoPayments from "dodopayments";
import { db } from "../db";
import { subscriptions, users } from "../db/schema";

const TOTAL_SLOTS = 10;
const PRODUCT_ID = process.env.DODO_PRODUCT_ID || "pdt_0NYFkACxHf3HDTstdAOtw";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const dodo = new DodoPayments({
  bearerToken: process.env.DODO_API_KEY!,
  environment: process.env.DODO_TEST_MODE === "true" ? "test_mode" : "live_mode",
});

// ── Public routes (no auth) ──────────────────────────────────────

type Variables = { userId: number };
const subscriptionRoutes = new Hono<{ Variables: Variables }>();

/**
 * GET /api/slots — Public endpoint for the landing page.
 * Returns total slots, taken count, and remaining.
 */
subscriptionRoutes.get("/slots", async (c) => {
  const taken = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(
      sql`${subscriptions.status} IN ('active', 'pending')`
    );
  const takenCount = taken[0]?.count ?? 0;

  return c.json({
    total: TOTAL_SLOTS,
    taken: takenCount,
    remaining: Math.max(0, TOTAL_SLOTS - takenCount),
    soldOut: takenCount >= TOTAL_SLOTS,
  });
});

/**
 * POST /api/checkout — Authenticated. Creates a Dodo checkout session.
 * Returns { checkoutUrl } for frontend to redirect to.
 */
subscriptionRoutes.post("/checkout", async (c) => {
  const userId = c.get("userId");

  // Check if user already has an active subscription
  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      sql`${subscriptions.status} IN ('active', 'pending')`
    ),
  });
  if (existing) {
    return c.json({ error: "You already have an active subscription" }, 400);
  }

  // Check if slots are available
  const taken = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(
      sql`${subscriptions.status} IN ('active', 'pending')`
    );
  const takenCount = taken[0]?.count ?? 0;
  if (takenCount >= TOTAL_SLOTS) {
    return c.json({ error: "All early access slots are taken" }, 400);
  }

  // Get user info for pre-filling checkout
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  try {
    const session = await dodo.checkoutSessions.create({
      product_cart: [
        {
          product_id: PRODUCT_ID,
          quantity: 1,
        },
      ],
      customer: {
        name: user.firstName || `User ${user.telegramId}`,
        email: `tg_${user.telegramId}@pumpmyclaw.com`,
      },
      return_url: `${FRONTEND_URL}/checkout/success`,
      metadata: {
        user_id: String(userId),
        telegram_id: user.telegramId,
      },
      customization: {
        theme: "dark",
      },
    });

    return c.json({ checkoutUrl: session.checkout_url });
  } catch (err) {
    console.error("[checkout] Failed to create session:", err);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

/**
 * GET /api/subscription — Authenticated. Returns user's subscription status.
 */
subscriptionRoutes.get("/subscription", async (c) => {
  const userId = c.get("userId");

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  if (!sub) {
    return c.json({ subscription: null });
  }

  return c.json({
    subscription: {
      id: sub.id,
      status: sub.status,
      slotNumber: sub.slotNumber,
      dodoSubscriptionId: sub.dodoSubscriptionId,
      createdAt: sub.createdAt,
    },
  });
});

// ── Webhook handler (no auth — uses signature verification) ──────

const webhookRoutes = new Hono();

webhookRoutes.post("/dodo", async (c) => {
  const webhookSecret = process.env.DODO_WEBHOOK_KEY;
  if (!webhookSecret) {
    console.error("[webhook] DODO_WEBHOOK_KEY not configured");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  const rawBody = await c.req.text();
  const headers = {
    "webhook-id": c.req.header("webhook-id") || "",
    "webhook-signature": c.req.header("webhook-signature") || "",
    "webhook-timestamp": c.req.header("webhook-timestamp") || "",
  };

  // Verify webhook signature
  try {
    const wh = new Webhook(webhookSecret);
    wh.verify(rawBody, headers);
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(rawBody);
  const eventType = event.type as string;
  const data = event.data;

  console.log(`[webhook] Received: ${eventType}`);

  try {
    switch (eventType) {
      case "subscription.active": {
        await handleSubscriptionActive(data);
        break;
      }
      case "subscription.renewed": {
        await handleSubscriptionRenewed(data);
        break;
      }
      case "subscription.on_hold": {
        await handleSubscriptionOnHold(data);
        break;
      }
      case "subscription.cancelled": {
        await handleSubscriptionCancelled(data);
        break;
      }
      case "subscription.failed": {
        await handleSubscriptionFailed(data);
        break;
      }
      case "subscription.expired": {
        await handleSubscriptionExpired(data);
        break;
      }
      case "payment.succeeded": {
        console.log(`[webhook] Payment succeeded: ${data.payment_id}`);
        break;
      }
      case "payment.failed": {
        console.log(`[webhook] Payment failed: ${data.payment_id}`);
        break;
      }
      default:
        console.log(`[webhook] Unhandled event type: ${eventType}`);
    }
  } catch (err) {
    console.error(`[webhook] Error handling ${eventType}:`, err);
  }

  // Always return 200 to acknowledge receipt
  return c.json({ received: true });
});

// ── Webhook event handlers ───────────────────────────────────────

/**
 * Parse Dodo's next_billing_date into a JS Date.
 * Dodo sends ISO 8601 strings like "2026-03-11T00:00:00Z".
 * Returns null if missing or unparseable.
 */
function parsePeriodEnd(data: any): Date | null {
  const raw = data.next_billing_date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

async function handleSubscriptionActive(data: any) {
  const subId = data.subscription_id;
  const customerId = data.customer?.customer_id;
  const metadata = data.metadata || {};
  const userId = metadata.user_id ? parseInt(metadata.user_id) : null;
  const periodEnd = parsePeriodEnd(data);

  console.log(
    `[webhook] Subscription active: ${subId}, userId: ${userId}, customerId: ${customerId}, periodEnd: ${periodEnd?.toISOString() ?? "unknown"}`
  );

  if (!userId) {
    console.error("[webhook] No user_id in metadata, cannot link subscription");
    return;
  }

  // Check if subscription already exists
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.dodoSubscriptionId, subId),
  });

  if (existing) {
    // Update status to active
    await db
      .update(subscriptions)
      .set({
        status: "active",
        dodoCustomerId: customerId,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.dodoSubscriptionId, subId));
    console.log(`[webhook] Updated existing subscription ${subId} to active`);
    return;
  }

  // Assign next slot number
  const taken = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(
      sql`${subscriptions.status} IN ('active', 'pending')`
    );
  const slotNumber = (taken[0]?.count ?? 0) + 1;

  if (slotNumber > TOTAL_SLOTS) {
    console.error(
      `[webhook] All ${TOTAL_SLOTS} slots taken, but subscription ${subId} activated. Allowing anyway.`
    );
  }

  // Insert new subscription
  await db.insert(subscriptions).values({
    userId,
    dodoSubscriptionId: subId,
    dodoCustomerId: customerId,
    status: "active",
    currentPeriodEnd: periodEnd,
    slotNumber: Math.min(slotNumber, TOTAL_SLOTS),
  });

  console.log(
    `[webhook] Created subscription for user ${userId}, slot #${slotNumber}`
  );
}

/**
 * Renewal succeeded — subscription continues for another period.
 * Update status back to active (in case it was on_hold) and bump period end.
 */
async function handleSubscriptionRenewed(data: any) {
  const subId = data.subscription_id;
  const periodEnd = parsePeriodEnd(data);
  console.log(
    `[webhook] Subscription renewed: ${subId}, new periodEnd: ${periodEnd?.toISOString() ?? "unknown"}`
  );

  await db
    .update(subscriptions)
    .set({
      status: "active",
      currentPeriodEnd: periodEnd,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.dodoSubscriptionId, subId));
}

/**
 * Renewal payment failed — Dodo puts subscription on hold.
 * Mark status but DO NOT stop the container — user paid through current_period_end.
 * The periodic enforcer will stop it once the period expires.
 */
async function handleSubscriptionOnHold(data: any) {
  const subId = data.subscription_id;
  console.log(`[webhook] Subscription on hold (payment failed): ${subId}`);

  await db
    .update(subscriptions)
    .set({ status: "on_hold", updatedAt: new Date() })
    .where(eq(subscriptions.dodoSubscriptionId, subId));
}

/**
 * User or merchant cancelled the subscription.
 * Mark status but DO NOT stop the container — user paid through current_period_end.
 * The periodic enforcer will stop it once the period expires.
 */
async function handleSubscriptionCancelled(data: any) {
  const subId = data.subscription_id;
  console.log(`[webhook] Subscription cancelled: ${subId}`);

  await db
    .update(subscriptions)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(subscriptions.dodoSubscriptionId, subId));
}

/**
 * Mandate creation failed — subscription never started.
 * No container should exist, but mark status for bookkeeping.
 */
async function handleSubscriptionFailed(data: any) {
  const subId = data.subscription_id;
  console.log(`[webhook] Subscription failed: ${subId}`);

  await db
    .update(subscriptions)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(subscriptions.dodoSubscriptionId, subId));
}

/**
 * Subscription reached end of term and expired.
 * Mark status — the periodic enforcer will stop the container.
 */
async function handleSubscriptionExpired(data: any) {
  const subId = data.subscription_id;
  console.log(`[webhook] Subscription expired: ${subId}`);

  await db
    .update(subscriptions)
    .set({ status: "expired", updatedAt: new Date() })
    .where(eq(subscriptions.dodoSubscriptionId, subId));
}

export { subscriptionRoutes, webhookRoutes };
