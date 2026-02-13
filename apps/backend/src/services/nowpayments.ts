/**
 * NOWPayments API Client
 *
 * Thin wrapper around the NOWPayments REST API.
 * Uses invoice-based payments only (no JWT auth required).
 *
 * Docs: https://documenter.getpostman.com/view/7907941/2s93JusNJt
 */

import { createHmac } from "crypto";

const LIVE_BASE = "https://api.nowpayments.io";
const SANDBOX_BASE = "https://api-sandbox.nowpayments.io";

function getBaseUrl(): string {
  return process.env.NOWPAYMENTS_SANDBOX === "true" ? SANDBOX_BASE : LIVE_BASE;
}

function getApiKey(): string {
  return process.env.NOWPAYMENTS_API_KEY || "";
}

// ── API Status Check ───────────────────────────────────────────────

export async function checkStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl()}/v1/status`);
    const data = await res.json();
    return data.message === "OK";
  } catch {
    return false;
  }
}

// ── Invoice Creation (Hosted Checkout) ─────────────────────────────

export interface CreateInvoiceParams {
  /** Price in fiat (e.g., 19.99) */
  priceAmount: number;
  /** Fiat currency code (e.g., "usd") */
  priceCurrency: string;
  /** Your internal order ID for correlating payments */
  orderId: string;
  /** Description shown on the payment page */
  orderDescription?: string;
  /** Webhook URL for payment status updates */
  ipnCallbackUrl: string;
  /** URL to redirect after successful payment */
  successUrl: string;
  /** URL to redirect if payment is cancelled */
  cancelUrl: string;
  /** Lock the exchange rate at creation time */
  isFixedRate?: boolean;
  /** Whether the network fee is paid by the customer */
  isFeePaidByUser?: boolean;
}

export interface Invoice {
  id: string;
  order_id: string;
  order_description: string;
  price_amount: string;
  price_currency: string;
  invoice_url: string;
  success_url: string;
  cancel_url: string;
  created_at: string;
  updated_at: string;
}

export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  const res = await fetch(`${getBaseUrl()}/v1/invoice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getApiKey(),
    },
    body: JSON.stringify({
      price_amount: params.priceAmount,
      price_currency: params.priceCurrency,
      order_id: params.orderId,
      order_description: params.orderDescription || "",
      ipn_callback_url: params.ipnCallbackUrl,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      is_fixed_rate: params.isFixedRate ?? true,
      is_fee_paid_by_user: params.isFeePaidByUser ?? false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NOWPayments create invoice failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ── Payment Status ─────────────────────────────────────────────────

export interface PaymentStatus {
  payment_id: number;
  invoice_id: number | null;
  payment_status: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  actually_paid: number;
  pay_currency: string;
  order_id: string;
  order_description: string;
  purchase_id: string;
  outcome_amount: number;
  outcome_currency: string;
}

export async function getPaymentStatus(paymentId: string | number): Promise<PaymentStatus> {
  const res = await fetch(`${getBaseUrl()}/v1/payment/${paymentId}`, {
    headers: { "x-api-key": getApiKey() },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NOWPayments get payment failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ── Webhook Signature Verification ─────────────────────────────────

/**
 * Sort an object's keys recursively (required for NOWPayments signature).
 */
function sortObject(obj: any): any {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return obj;
  }
  return Object.keys(obj)
    .sort()
    .reduce((result: Record<string, any>, key) => {
      result[key] = sortObject(obj[key]);
      return result;
    }, {});
}

/**
 * Verify a NOWPayments IPN webhook signature.
 *
 * Algorithm:
 * 1. Sort the POST body by keys (recursively)
 * 2. JSON.stringify with sorted keys
 * 3. HMAC-SHA512 with IPN Secret Key
 * 4. Compare with x-nowpayments-sig header
 */
export function verifyWebhookSignature(
  body: Record<string, any>,
  signature: string
): boolean {
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!ipnSecret) {
    console.error("[nowpayments] NOWPAYMENTS_IPN_SECRET not configured");
    return false;
  }

  const sorted = sortObject(body);
  const stringified = JSON.stringify(sorted);
  const hmac = createHmac("sha512", ipnSecret);
  hmac.update(stringified);
  const expectedSignature = hmac.digest("hex");

  return expectedSignature === signature;
}
