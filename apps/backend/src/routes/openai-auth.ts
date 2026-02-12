/**
 * OpenAI Codex OAuth — PKCE Flow
 *
 * auth.openai.com has Cloudflare bot protection that blocks server-side
 * requests to the authorize endpoint. So the flow is split:
 *
 *   1. Frontend generates PKCE verifier/challenge, opens authorize URL in browser
 *   2. User authorizes, gets redirected to 127.0.0.1:1455/auth/callback (fails to load)
 *   3. User pastes the callback URL back into our app
 *   4. Frontend extracts `code` param, sends { code, codeVerifier } to backend
 *   5. Backend exchanges code for tokens at auth.openai.com/oauth/token (works server-side)
 *   6. Backend stores encrypted tokens, restarts container
 *
 * Endpoints:
 *   POST /api/openai-auth/exchange       — exchange auth code + PKCE verifier for tokens
 *   GET  /api/openai-auth/status         — get current provider status
 *   POST /api/openai-auth/disconnect     — revert to OpenRouter
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { instances, users } from "../db/schema";
import { encrypt, decrypt } from "../services/crypto";
import * as docker from "../services/docker";

type Variables = { userId: number };
const openaiAuthRoutes = new Hono<{ Variables: Variables }>();

// ── Constants ──────────────────────────────────────────────────────
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://127.0.0.1:1455/auth/callback";

// In-memory store for completed auth tokens (keyed by userId)
// Used when auth completes before an instance exists (deploy wizard flow).
// Consumed by createInstance when llmProvider is "openai-codex".
export const completedTokens = new Map<
  number,
  {
    accessToken: string;
    refreshToken?: string;
    accountId: string | null;
    expiresAt: number;
  }
>();

/** Extract account ID from an OpenAI JWT access token */
function extractAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length >= 2) {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString()
      );
      return (
        payload.account_id ||
        payload.sub ||
        payload["https://api.openai.com/auth"]?.account_id ||
        null
      );
    }
  } catch {
    // JWT parsing failed
  }
  return null;
}

/** Store tokens for a user — either in DB (if instance exists) or in memory */
async function storeTokens(
  userId: number,
  accessToken: string,
  refreshToken: string | undefined,
  accountId: string | null,
  expiresAt: number,
) {
  const instance = await db.query.instances.findFirst({
    where: eq(instances.userId, userId),
  });

  if (instance) {
    // Store encrypted tokens in DB
    await db
      .update(instances)
      .set({
        llmProvider: "openai-codex",
        openaiAccessToken: encrypt(accessToken),
        openaiRefreshToken: refreshToken ? encrypt(refreshToken) : null,
        openaiAccountId: accountId,
        openaiTokenExpires: expiresAt,
        model: "openai-codex/o4-mini",
      })
      .where(eq(instances.id, instance.id));

    // Restart container with new auth if running
    if (instance.containerId) {
      try {
        const user = await db.query.users.findFirst({
          where: eq(users.id, userId),
        });
        if (user) {
          const updated = await db.query.instances.findFirst({
            where: eq(instances.id, instance.id),
          });
          if (updated) {
            await docker.deleteInstance(instance.containerId);
            const newContainerId = await docker.createInstance({
              instanceId: updated.id,
              userId: user.id,
              telegramOwnerId: user.telegramId,
              telegramBotToken: decrypt(updated.telegramBotToken),
              openrouterApiKey: decrypt(updated.openrouterApiKey),
              model: updated.model,
              llmProvider: "openai-codex",
              openaiAccessToken: accessToken,
              openaiRefreshToken: refreshToken || undefined,
              openaiAccountId: accountId || undefined,
            });
            await db
              .update(instances)
              .set({ containerId: newContainerId, status: "pending", startedAt: new Date() })
              .where(eq(instances.id, instance.id));
          }
        }
      } catch (err) {
        console.error("[openai-auth] Failed to restart container:", err);
      }
    }
  } else {
    // No instance yet (deploy wizard) — store in memory for createInstance
    completedTokens.set(userId, { accessToken, refreshToken, accountId, expiresAt });
  }
}

// ── Exchange auth code for tokens (PKCE) ───────────────────────────
openaiAuthRoutes.post("/exchange", async (c) => {
  const userId = c.get("userId");

  const body = (await c.req.json()) as {
    code?: string;
    codeVerifier?: string;
  };

  if (!body.code || !body.codeVerifier) {
    return c.json({ error: "code and codeVerifier are required" }, 400);
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: OPENAI_CLIENT_ID,
        grant_type: "authorization_code",
        code: body.code,
        code_verifier: body.codeVerifier,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (data.error || !data.access_token) {
      console.error(`[openai-auth] Token exchange failed: ${data.error} - ${data.error_description}`);
      return c.json(
        { error: data.error_description || data.error || "Token exchange failed" },
        400,
      );
    }

    const accountId = extractAccountId(data.access_token);
    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : Date.now() + 30 * 24 * 60 * 60 * 1000;

    await storeTokens(userId, data.access_token, data.refresh_token, accountId, expiresAt);

    return c.json({
      status: "authorized",
      accountId,
      expiresAt,
      model: "openai-codex/o4-mini",
    });
  } catch (err) {
    console.error("[openai-auth] Exchange error:", err);
    return c.json({ error: "Failed to exchange code with OpenAI" }, 502);
  }
});

// ── Get current OpenAI auth status ─────────────────────────────────
openaiAuthRoutes.get("/status", async (c) => {
  const userId = c.get("userId");

  const instance = await db.query.instances.findFirst({
    where: eq(instances.userId, userId),
  });

  if (!instance) {
    const pending = completedTokens.has(userId);
    return c.json({
      connected: pending,
      provider: pending ? "openai-codex" : null,
      accountId: pending ? completedTokens.get(userId)!.accountId : null,
      tokenExpires: null,
      expired: false,
    });
  }

  return c.json({
    connected: instance.llmProvider === "openai-codex" && !!instance.openaiAccessToken,
    provider: instance.llmProvider,
    accountId: instance.openaiAccountId,
    tokenExpires: instance.openaiTokenExpires,
    expired: instance.openaiTokenExpires
      ? Date.now() > instance.openaiTokenExpires
      : false,
  });
});

// ── Disconnect OpenAI (revert to OpenRouter) ───────────────────────
openaiAuthRoutes.post("/disconnect", async (c) => {
  const userId = c.get("userId");

  const instance = await db.query.instances.findFirst({
    where: eq(instances.userId, userId),
  });

  if (!instance) {
    completedTokens.delete(userId);
    return c.json({ status: "disconnected" });
  }

  await db
    .update(instances)
    .set({
      llmProvider: "openrouter",
      openaiAccessToken: null,
      openaiRefreshToken: null,
      openaiAccountId: null,
      openaiTokenExpires: null,
      model: "openrouter/moonshotai/kimi-k2.5",
    })
    .where(eq(instances.id, instance.id));

  completedTokens.delete(userId);

  return c.json({ status: "disconnected" });
});

export default openaiAuthRoutes;
