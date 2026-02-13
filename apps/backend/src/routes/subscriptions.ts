import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { subscriptions, users } from "../db/schema";
import * as nowpayments from "../services/nowpayments";

const TOTAL_SLOTS = 10;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

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
 * POST /api/checkout — Authenticated. Creates a NOWPayments invoice + subscription.
 * Expects JSON body: { email: string }
 * Returns { checkoutUrl } for frontend to redirect to.
 */
subscriptionRoutes.post("/checkout", async (c) => {
  const userId = c.get("userId");

  const body = await c.req.json().catch(() => null);
  const email = body?.email?.trim();
  if (!email || !email.includes("@")) {
    return c.json({ error: "A valid email address is required for crypto payment notifications" }, 400);
  }

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

  // Get user info
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Save email to user record
  await db
    .update(users)
    .set({ email })
    .where(eq(users.id, userId));

  try {
    // Create a NOWPayments invoice for immediate checkout redirect
    const orderId = `pmc_${userId}_${Date.now()}`;
    const invoice = await nowpayments.createInvoice({
      priceAmount: 19.99,
      priceCurrency: "usd",
      orderId,
      orderDescription: "PumpMyClaw Early Access — $19.99/mo",
      ipnCallbackUrl: `${BACKEND_URL}/api/webhooks/nowpayments`,
      successUrl: `${FRONTEND_URL}/checkout/success`,
      cancelUrl: FRONTEND_URL,
      isFixedRate: true,
      isFeePaidByUser: false,
    });

    // Create a pending subscription record in our DB
    const slotNumber = takenCount + 1;
    await db.insert(subscriptions).values({
      userId,
      nowpaymentsSubscriptionId: `inv_${invoice.id}`,
      nowpaymentsPaymentId: invoice.id?.toString() || null,
      status: "pending",
      slotNumber: Math.min(slotNumber, TOTAL_SLOTS),
    });

    console.log(`[checkout] Created invoice ${invoice.id} for user ${userId}, order ${orderId}`);

    return c.json({ checkoutUrl: invoice.invoice_url });
  } catch (err) {
    console.error("[checkout] Failed to create checkout:", err);
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
      nowpaymentsSubscriptionId: sub.nowpaymentsSubscriptionId,
      nowpaymentsPaymentId: sub.nowpaymentsPaymentId,
      currentPeriodEnd: sub.currentPeriodEnd,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    },
  });
});

// ── Webhook handler (no auth — uses signature verification) ──────

const webhookRoutes = new Hono();

/**
 * POST /api/webhooks/nowpayments — NOWPayments IPN callback.
 *
 * NOWPayments sends POST requests when payment status changes.
 * We verify the HMAC-SHA512 signature and update subscription status.
 */
webhookRoutes.post("/nowpayments", async (c) => {
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!ipnSecret) {
    console.error("[webhook] NOWPAYMENTS_IPN_SECRET not configured");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("x-nowpayments-sig") || "";

  // Parse body
  let body: Record<string, any>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("[webhook] Failed to parse body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Verify webhook signature
  if (!nowpayments.verifyWebhookSignature(body, signature)) {
    console.error("[webhook] Signature verification failed");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const paymentStatus = body.payment_status as string;
  const paymentId = body.payment_id;
  const orderId = body.order_id as string;
  const actuallyPaid = body.actually_paid;
  const invoiceId = body.invoice_id;

  console.log(
    `[webhook] Received: payment_id=${paymentId}, status=${paymentStatus}, order_id=${orderId}, actually_paid=${actuallyPaid}`
  );

  try {
    switch (paymentStatus) {
      case "finished": {
        await handlePaymentFinished(body);
        break;
      }
      case "confirmed":
      case "sending": {
        // Payment confirmed on blockchain, being processed
        console.log(`[webhook] Payment ${paymentId} is ${paymentStatus} — awaiting completion`);
        break;
      }
      case "waiting":
      case "confirming": {
        // Still waiting for payment / confirming on blockchain
        console.log(`[webhook] Payment ${paymentId} is ${paymentStatus}`);
        break;
      }
      case "partially_paid": {
        console.log(`[webhook] Payment ${paymentId} partially paid: ${actuallyPaid}`);
        await handlePaymentPartiallyPaid(body);
        break;
      }
      case "failed": {
        console.log(`[webhook] Payment ${paymentId} failed`);
        await handlePaymentFailed(body);
        break;
      }
      case "expired": {
        console.log(`[webhook] Payment ${paymentId} expired`);
        await handlePaymentExpired(body);
        break;
      }
      case "refunded": {
        console.log(`[webhook] Payment ${paymentId} refunded`);
        await handlePaymentRefunded(body);
        break;
      }
      default:
        console.log(`[webhook] Unhandled payment status: ${paymentStatus}`);
    }
  } catch (err) {
    console.error(`[webhook] Error handling ${paymentStatus}:`, err);
  }

  // Always return 200 to acknowledge receipt
  return c.json({ received: true });
});

// ── Webhook event handlers ───────────────────────────────────────

/**
 * Extract userId from orderId format: pmc_{userId}_{timestamp}
 */
function parseOrderId(orderId: string): number | null {
  if (!orderId || !orderId.startsWith("pmc_")) return null;
  const parts = orderId.split("_");
  if (parts.length < 2) return null;
  const id = parseInt(parts[1]);
  return isNaN(id) ? null : id;
}

/**
 * Payment finished — subscription becomes active.
 * Set currentPeriodEnd to 30 days from now.
 */
async function handlePaymentFinished(data: any) {
  const orderId = data.order_id as string;
  const paymentId = String(data.payment_id);
  const userId = parseOrderId(orderId);

  if (!userId) {
    console.error(`[webhook] Cannot parse userId from order_id: ${orderId}`);
    return;
  }

  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days

  // Try to find existing subscription for this user
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  if (existing) {
    // Update to active
    await db
      .update(subscriptions)
      .set({
        status: "active",
        nowpaymentsPaymentId: paymentId,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));

    console.log(
      `[webhook] Activated subscription for user ${userId}, periodEnd: ${periodEnd.toISOString()}`
    );
  } else {
    // Create new subscription (payment came before checkout record)
    const taken = await db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(sql`${subscriptions.status} IN ('active', 'pending')`);
    const slotNumber = (taken[0]?.count ?? 0) + 1;

    await db.insert(subscriptions).values({
      userId,
      nowpaymentsSubscriptionId: `payment_${paymentId}`,
      nowpaymentsPaymentId: paymentId,
      status: "active",
      currentPeriodEnd: periodEnd,
      slotNumber: Math.min(slotNumber, TOTAL_SLOTS),
    });

    console.log(
      `[webhook] Created new subscription for user ${userId}, slot #${slotNumber}`
    );
  }
}

/**
 * Payment partially paid — keep pending, log the partial amount.
 */
async function handlePaymentPartiallyPaid(data: any) {
  const orderId = data.order_id as string;
  const userId = parseOrderId(orderId);
  if (!userId) return;

  console.log(
    `[webhook] Partial payment for user ${userId}: paid ${data.actually_paid} of ${data.pay_amount} ${data.pay_currency}`
  );
  // Keep status as pending — don't activate until fully paid
}

/**
 * Payment failed — mark subscription as failed if it exists.
 */
async function handlePaymentFailed(data: any) {
  const orderId = data.order_id as string;
  const userId = parseOrderId(orderId);
  if (!userId) return;

  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, "pending")
    ),
  });

  if (existing) {
    await db
      .update(subscriptions)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(subscriptions.id, existing.id));
  }
}

/**
 * Payment expired — mark subscription as expired if still pending.
 */
async function handlePaymentExpired(data: any) {
  const orderId = data.order_id as string;
  const userId = parseOrderId(orderId);
  if (!userId) return;

  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, "pending")
    ),
  });

  if (existing) {
    await db
      .update(subscriptions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(subscriptions.id, existing.id));
  }
}

/**
 * Payment refunded — mark subscription as cancelled.
 */
async function handlePaymentRefunded(data: any) {
  const orderId = data.order_id as string;
  const userId = parseOrderId(orderId);
  if (!userId) return;

  await db
    .update(subscriptions)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId));
}

export { subscriptionRoutes, webhookRoutes };
