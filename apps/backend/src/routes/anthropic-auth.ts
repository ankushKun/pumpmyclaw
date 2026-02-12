/**
 * Anthropic (Claude) Setup-Token Auth
 *
 * Unlike OpenAI's OAuth PKCE flow, Anthropic uses a "setup-token" that users
 * generate by running `claude setup-token` on their machine. The token is then
 * pasted into our app.
 *
 * Endpoints:
 *   POST /api/anthropic-auth/paste-token  — store a setup-token
 *   GET  /api/anthropic-auth/status       — get current Anthropic auth status
 *   POST /api/anthropic-auth/disconnect   — revert to OpenRouter
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { instances, users } from "../db/schema";
import { encrypt, decrypt } from "../services/crypto";
import * as docker from "../services/docker";

type Variables = { userId: number };
const anthropicAuthRoutes = new Hono<{ Variables: Variables }>();

// In-memory store for tokens when auth completes before instance exists
// (deploy wizard flow). Consumed by createInstance when llmProvider is "anthropic".
export const completedAnthropicTokens = new Map<
  number,
  { setupToken: string }
>();

// ── Paste setup-token ──────────────────────────────────────────────
anthropicAuthRoutes.post("/paste-token", async (c) => {
  const userId = c.get("userId");

  const body = (await c.req.json()) as { setupToken?: string };

  if (!body.setupToken) {
    return c.json({ error: "setupToken is required" }, 400);
  }

  // Basic format validation for setup-token
  // Setup tokens from `claude setup-token` typically start with "sk-ant-oat" 
  // and are quite long (100+ chars)
  const setupToken = body.setupToken.trim();
  
  if (setupToken.length < 50) {
    return c.json({ error: "Invalid setup-token: token is too short" }, 400);
  }
  
  if (!setupToken.startsWith("sk-ant-")) {
    return c.json({ 
      error: "Invalid setup-token format. Token should start with 'sk-ant-'. Make sure you ran 'claude setup-token' and copied the full token." 
    }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: eq(instances.userId, userId),
  });

  if (instance) {
    // Store encrypted token in DB
    await db
      .update(instances)
      .set({
        llmProvider: "anthropic",
        anthropicSetupToken: encrypt(setupToken),
        model: "anthropic/claude-sonnet-4-20250514",
        // Clear OpenAI tokens since we're switching providers
        openaiAccessToken: null,
        openaiRefreshToken: null,
        openaiAccountId: null,
        openaiTokenExpires: null,
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
              llmProvider: "anthropic",
              anthropicSetupToken: setupToken,
            });
            await db
              .update(instances)
              .set({ containerId: newContainerId, status: "pending", startedAt: new Date() })
              .where(eq(instances.id, instance.id));
          }
        }
      } catch (err) {
        console.error("[anthropic-auth] Failed to restart container:", err);
      }
    }

    return c.json({
      status: "authorized",
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4-20250514",
    });
  } else {
    // No instance yet (deploy wizard) — store in memory for createInstance
    completedAnthropicTokens.set(userId, { setupToken });
    return c.json({
      status: "authorized",
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4-20250514",
    });
  }
});

// ── Get current Anthropic auth status ──────────────────────────────
anthropicAuthRoutes.get("/status", async (c) => {
  const userId = c.get("userId");

  const instance = await db.query.instances.findFirst({
    where: eq(instances.userId, userId),
  });

  if (!instance) {
    const pending = completedAnthropicTokens.has(userId);
    return c.json({
      connected: pending,
      provider: pending ? "anthropic" : null,
    });
  }

  return c.json({
    connected: instance.llmProvider === "anthropic" && !!instance.anthropicSetupToken,
    provider: instance.llmProvider,
  });
});

// ── Disconnect Anthropic (revert to OpenRouter) ────────────────────
anthropicAuthRoutes.post("/disconnect", async (c) => {
  const userId = c.get("userId");

  const instance = await db.query.instances.findFirst({
    where: eq(instances.userId, userId),
  });

  if (!instance) {
    completedAnthropicTokens.delete(userId);
    return c.json({ status: "disconnected" });
  }

  await db
    .update(instances)
    .set({
      llmProvider: "openrouter",
      anthropicSetupToken: null,
      model: "openrouter/moonshotai/kimi-k2.5",
    })
    .where(eq(instances.id, instance.id));

  completedAnthropicTokens.delete(userId);

  // Restart container if running
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
            llmProvider: "openrouter",
          });
          await db
            .update(instances)
            .set({ containerId: newContainerId, status: "pending", startedAt: new Date() })
            .where(eq(instances.id, instance.id));
        }
      }
    } catch (err) {
      console.error("[anthropic-auth] Failed to restart container:", err);
    }
  }

  return c.json({ status: "disconnected" });
});

export default anthropicAuthRoutes;
