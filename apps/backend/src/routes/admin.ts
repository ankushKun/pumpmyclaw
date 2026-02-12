/**
 * Admin Dashboard Routes
 *
 * All routes require Bearer DB_PASS authentication.
 * Provides: system overview, container management, user management,
 * rolling updates, subscription grants, and a web dashboard UI.
 */

import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { users, instances, subscriptions } from "../db/schema";
import { decrypt } from "../services/crypto";
import * as docker from "../services/docker";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";

const admin = new Hono();

const INSTANCES_DATA_DIR =
  process.env.INSTANCES_DATA_DIR || "./data/instances";

// ── Auth middleware — every /admin/* route requires DB_PASS ────────
admin.use("*", async (c, next) => {
  // Skip auth for the dashboard page itself (it handles auth client-side)
  // and for the login endpoint
  const path = c.req.path;
  if (path === "/admin/dashboard" || path === "/admin/login") {
    return next();
  }

  const adminPass = process.env.DB_PASS;
  if (!adminPass) {
    return c.json({ error: "Admin not configured (set DB_PASS)" }, 503);
  }

  // Support both header auth and query param (for SSE streams)
  const authHeader = c.req.header("Authorization");
  const queryToken = c.req.query("token");

  if (authHeader !== `Bearer ${adminPass}` && queryToken !== adminPass) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

// ── Login check ────────────────────────────────────────────────────
admin.post("/login", async (c) => {
  const adminPass = process.env.DB_PASS;
  if (!adminPass) {
    return c.json({ error: "Admin not configured" }, 503);
  }
  const body = await c.req.json().catch(() => null);
  if (body?.password === adminPass) {
    return c.json({ ok: true, token: adminPass });
  }
  return c.json({ error: "Invalid password" }, 401);
});

// ── Dashboard HTML ─────────────────────────────────────────────────
admin.get("/dashboard", async (c) => {
  return c.html(getDashboardHTML());
});

// ── System Overview ────────────────────────────────────────────────
admin.get("/api/overview", async (c) => {
  const [dockerInfo, allUsers, allInstances, allSubs, containers] =
    await Promise.all([
      docker.getDockerInfo().catch(() => null),
      db.select({ count: sql<number>`count(*)` }).from(users),
      db.select({ count: sql<number>`count(*)` }).from(instances),
      db.select({ count: sql<number>`count(*)` }).from(subscriptions),
      docker.listManagedContainers().catch(() => []),
    ]);

  const activeSubs = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  const runningContainers = containers.filter((c) => c.state === "running");

  return c.json({
    users: allUsers[0]?.count ?? 0,
    instances: allInstances[0]?.count ?? 0,
    subscriptions: {
      total: allSubs[0]?.count ?? 0,
      active: activeSubs[0]?.count ?? 0,
    },
    containers: {
      total: containers.length,
      running: runningContainers.length,
      stopped: containers.length - runningContainers.length,
    },
    docker: dockerInfo,
    uptime: process.uptime(),
  });
});

// ── List all containers ────────────────────────────────────────────
admin.get("/api/containers", async (c) => {
  const containers = await docker.listManagedContainers();

  // Enrich with DB data
  const enriched = await Promise.all(
    containers.map(async (container) => {
      const instanceId = container.labels["pmc.instance.id"];
      let instance = null;
      let user = null;

      if (instanceId) {
        instance = await db.query.instances.findFirst({
          where: eq(instances.id, Number(instanceId)),
        });
        if (instance) {
          user = await db.query.users.findFirst({
            where: eq(users.id, instance.userId),
          });
        }
      }

      // If we couldn't find by label, try by containerId
      if (!instance) {
        instance = await db.query.instances.findFirst({
          where: eq(instances.containerId, container.id),
        });
        if (instance) {
          user = await db.query.users.findFirst({
            where: eq(users.id, instance.userId),
          });
        }
      }

      return {
        ...container,
        instanceId: instance?.id ?? null,
        user: user
          ? {
              id: user.id,
              telegramId: user.telegramId,
              username: user.username,
              firstName: user.firstName,
            }
          : null,
        model: instance?.model ?? null,
        dbStatus: instance?.status ?? null,
        startedAt: instance?.startedAt ?? null,
      };
    })
  );

  return c.json({ containers: enriched });
});

// ── Container stats ────────────────────────────────────────────────
admin.get("/api/containers/:id/stats", async (c) => {
  const containerId = c.req.param("id");
  try {
    const stats = await docker.getContainerStats(containerId);
    return c.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ── Container logs (snapshot) ──────────────────────────────────────
admin.get("/api/containers/:id/logs", async (c) => {
  const containerId = c.req.param("id");
  const tail = parseInt(c.req.query("tail") || "200");
  try {
    const logs = await docker.getLogs(containerId, tail);
    return c.json({ logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ── Container logs (SSE stream) ────────────────────────────────────
admin.get("/api/containers/:id/logs/stream", async (c) => {
  const containerId = c.req.param("id");

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let cleanup: (() => void) | null = null;
      let aborted = false;

      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Controller may be closed
        }
      };

      c.req.raw.signal.addEventListener("abort", () => {
        aborted = true;
        if (cleanup) cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      if (aborted) return;

      try {
        cleanup = await docker.streamLogs(
          containerId,
          (line) => send({ log: line }),
          (err) => {
            send({ error: err.message });
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          },
          () => {
            send({ done: true });
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        );
      } catch {
        send({ error: "Failed to start log stream" });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// ── Container actions ──────────────────────────────────────────────
admin.post("/api/containers/:id/stop", async (c) => {
  const containerId = c.req.param("id");
  try {
    await docker.stopInstance(containerId);
    // Update DB status
    await db
      .update(instances)
      .set({ status: "stopped", stoppedAt: new Date() })
      .where(eq(instances.containerId, containerId));
    return c.json({ ok: true, action: "stopped" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

admin.post("/api/containers/:id/start", async (c) => {
  const containerId = c.req.param("id");
  try {
    await docker.startInstance(containerId);
    await db
      .update(instances)
      .set({ status: "pending", startedAt: new Date() })
      .where(eq(instances.containerId, containerId));
    return c.json({ ok: true, action: "started" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

admin.post("/api/containers/:id/restart", async (c) => {
  const containerId = c.req.param("id");
  try {
    await docker.restartInstance(containerId);
    await db
      .update(instances)
      .set({ status: "pending", startedAt: new Date() })
      .where(eq(instances.containerId, containerId));
    return c.json({ ok: true, action: "restarted" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

admin.post("/api/containers/:id/delete", async (c) => {
  const containerId = c.req.param("id");
  try {
    await docker.deleteInstance(containerId);
    // Update DB — set containerId to null, status to stopped
    await db
      .update(instances)
      .set({ containerId: null, status: "stopped", stoppedAt: new Date() })
      .where(eq(instances.containerId, containerId));
    return c.json({ ok: true, action: "deleted" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ── Bulk container actions ─────────────────────────────────────────
admin.post("/api/containers/stop-all", async (c) => {
  const containers = await docker.listManagedContainers();
  const running = containers.filter((c) => c.state === "running");
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const container of running) {
    try {
      await docker.stopInstance(container.id);
      await db
        .update(instances)
        .set({ status: "stopped", stoppedAt: new Date() })
        .where(eq(instances.containerId, container.id));
      results.push({ name: container.name, ok: true });
    } catch (err) {
      results.push({
        name: container.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return c.json({
    stopped: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});

admin.post("/api/containers/start-all", async (c) => {
  const containers = await docker.listManagedContainers();
  const stopped = containers.filter(
    (c) => c.state === "exited" || c.state === "created"
  );
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const container of stopped) {
    try {
      await docker.startInstance(container.id);
      await db
        .update(instances)
        .set({ status: "pending", startedAt: new Date() })
        .where(eq(instances.containerId, container.id));
      results.push({ name: container.name, ok: true });
    } catch (err) {
      results.push({
        name: container.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return c.json({
    started: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});

admin.post("/api/containers/restart-all", async (c) => {
  const containers = await docker.listManagedContainers();
  const running = containers.filter((c) => c.state === "running");
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const container of running) {
    try {
      await docker.restartInstance(container.id);
      results.push({ name: container.name, ok: true });
    } catch (err) {
      results.push({
        name: container.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return c.json({
    restarted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});

// ── List all users ─────────────────────────────────────────────────
admin.get("/api/users", async (c) => {
  const allUsers = await db.query.users.findMany();

  const enriched = await Promise.all(
    allUsers.map(async (user) => {
      const instance = await db.query.instances.findFirst({
        where: eq(instances.userId, user.id),
      });

      const sub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, user.id),
      });

      // Check if wallet exists on disk
      const walletPath = resolve(
        INSTANCES_DATA_DIR,
        `user-${user.telegramId}`,
        ".wallet.json"
      );
      let walletAddress: string | null = null;
      try {
        if (existsSync(walletPath)) {
          const wallet = JSON.parse(readFileSync(walletPath, "utf-8"));
          walletAddress = wallet.publicKey || null;
        }
      } catch {
        /* ignore */
      }

      // Check data dir
      const dataDir = resolve(INSTANCES_DATA_DIR, `user-${user.telegramId}`);
      let dataDirExists = existsSync(dataDir);

      // Get live container status from Docker (not stale DB value)
      let liveStatus = instance?.status ?? null;
      if (instance?.containerId) {
        try {
          liveStatus = await docker.getStatus(instance.containerId);
        } catch {
          liveStatus = instance.status;
        }
      }

      return {
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        createdAt: user.createdAt,
        walletAddress,
        dataDirExists,
        instance: instance
          ? {
              id: instance.id,
              status: liveStatus,
              model: instance.model,
              containerId: instance.containerId?.slice(0, 12) ?? null,
              startedAt: instance.startedAt,
              stoppedAt: instance.stoppedAt,
            }
          : null,
        subscription: sub
          ? {
              id: sub.id,
              status: sub.status,
              slotNumber: sub.slotNumber,
              currentPeriodEnd: sub.currentPeriodEnd,
              dodoSubscriptionId: sub.dodoSubscriptionId,
            }
          : null,
      };
    })
  );

  return c.json({ users: enriched });
});

// ── User detail ────────────────────────────────────────────────────
admin.get("/api/users/:id", async (c) => {
  const userId = parseInt(c.req.param("id"));
  if (isNaN(userId)) return c.json({ error: "Invalid user ID" }, 400);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return c.json({ error: "User not found" }, 404);

  const instance = await db.query.instances.findFirst({
    where: eq(instances.userId, userId),
  });

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  // Wallet
  const walletPath = resolve(
    INSTANCES_DATA_DIR,
    `user-${user.telegramId}`,
    ".wallet.json"
  );
  let walletAddress: string | null = null;
  try {
    if (existsSync(walletPath)) {
      const wallet = JSON.parse(readFileSync(walletPath, "utf-8"));
      walletAddress = wallet.publicKey || null;
    }
  } catch {
    /* ignore */
  }

  // Read workspace files (TRADES.json, MY_TOKEN.md)
  const dataDir = resolve(INSTANCES_DATA_DIR, `user-${user.telegramId}`);
  let trades = null;
  let myToken = null;

  try {
    const tradesPath = resolve(dataDir, "workspace", "TRADES.json");
    if (existsSync(tradesPath)) {
      trades = JSON.parse(readFileSync(tradesPath, "utf-8"));
    }
  } catch {
    /* ignore */
  }

  try {
    const tokenPath = resolve(dataDir, "workspace", "MY_TOKEN.md");
    if (existsSync(tokenPath)) {
      myToken = readFileSync(tokenPath, "utf-8");
    }
  } catch {
    /* ignore */
  }

  // Container live status
  let containerStatus = null;
  if (instance?.containerId) {
    try {
      containerStatus = await docker.getDetailedStatus(instance.containerId);
    } catch {
      /* ignore */
    }
  }

  return c.json({
    user: {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      createdAt: user.createdAt,
    },
    walletAddress,
    instance: instance
      ? {
          id: instance.id,
          status: instance.status,
          model: instance.model,
          containerId: instance.containerId,
          startedAt: instance.startedAt,
          stoppedAt: instance.stoppedAt,
          createdAt: instance.createdAt,
          botUsername: instance.telegramBotUsername,
        }
      : null,
    containerStatus,
    subscription: sub,
    trades,
    myToken,
  });
});

// ── Grant subscription (moved from index.ts) ──────────────────────
admin.post("/api/grant-sub", async (c) => {
  const body = await c.req.json().catch(() => null);
  const identifier = body?.id || body?.telegramId;
  if (!identifier) {
    return c.json({ error: "Provide id or telegramId in body" }, 400);
  }

  let user = await db.query.users.findFirst({
    where: eq(users.id, Number(identifier)),
  });
  if (!user) {
    user = await db.query.users.findFirst({
      where: eq(users.telegramId, String(identifier)),
    });
  }
  if (!user) {
    return c.json({ error: `No user found matching "${identifier}"` }, 404);
  }

  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, user.id),
      eq(subscriptions.status, "active")
    ),
  });
  if (existing) {
    return c.json({
      message: `User ${user.id} (@${user.username || user.firstName}) already has an active subscription`,
      subscription: existing,
    });
  }

  const taken = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(sql`${subscriptions.status} IN ('active', 'pending')`);
  const slotNumber = (taken[0]?.count ?? 0) + 1;

  const now = new Date();
  const [sub] = await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      dodoSubscriptionId: `manual_grant_${user.id}_${Math.floor(now.getTime() / 1000)}`,
      status: "active",
      slotNumber: Math.min(slotNumber, 10),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return c.json({
    message: `Granted subscription to user ${user.id} (@${user.username || user.firstName}), slot #${slotNumber}`,
    subscription: sub,
  });
});

// ── Rolling update (moved from index.ts) ───────────────────────────
admin.post("/api/update-all", async (c) => {
  try {
    const results = await docker.rollingUpdateAll(
      async (containerId: string) => {
        const instance = await db.query.instances.findFirst({
          where: eq(instances.containerId, containerId),
        });
        if (!instance) return null;

        const user = await db.query.users.findFirst({
          where: eq(users.id, instance.userId),
        });
        if (!user) return null;

        const config: docker.InstanceConfig = {
          instanceId: instance.id,
          userId: user.id,
          telegramOwnerId: user.telegramId,
          telegramBotToken: decrypt(instance.telegramBotToken),
          openrouterApiKey: decrypt(instance.openrouterApiKey),
          model: instance.model || "openrouter/openrouter/auto",
          llmProvider: instance.llmProvider || "openrouter",
        };

        // Include OpenAI tokens if using Codex provider
        if (instance.llmProvider === "openai-codex" && instance.openaiAccessToken) {
          config.openaiAccessToken = decrypt(instance.openaiAccessToken);
          if (instance.openaiRefreshToken) {
            config.openaiRefreshToken = decrypt(instance.openaiRefreshToken);
          }
          config.openaiAccountId = instance.openaiAccountId || undefined;
          config.openaiTokenExpires = instance.openaiTokenExpires || undefined;
        }

        return config;
      }
    );

    // Update DB with new container IDs
    for (const r of results) {
      if (r.status === "updated" && r.instanceId && r.newContainerId) {
        await db
          .update(instances)
          .set({
            containerId: r.newContainerId,
            status: "pending",
            startedAt: new Date(),
          })
          .where(eq(instances.id, r.instanceId));
      }
    }

    return c.json({
      message: "Rolling update complete",
      results,
      summary: {
        total: results.length,
        updated: results.filter((r) => r.status === "updated").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin] Rolling update failed: ${msg}`);
    return c.json({ error: `Update failed: ${msg}` }, 500);
  }
});

// ── Rebuild instance image only ────────────────────────────────────
admin.post("/api/rebuild-image", async (c) => {
  try {
    await docker.forceRebuildInstanceImage();
    return c.json({
      ok: true,
      message: "Instance image rebuilt. Use update-all to deploy to containers.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ── Read workspace file for any user ───────────────────────────────
admin.get("/api/users/:id/workspace/:file", async (c) => {
  const userId = parseInt(c.req.param("id"));
  const fileName = c.req.param("file");
  if (isNaN(userId)) return c.json({ error: "Invalid user ID" }, 400);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return c.json({ error: "User not found" }, 404);

  // Sanitize filename to prevent path traversal
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "");
  const filePath = resolve(
    INSTANCES_DATA_DIR,
    `user-${user.telegramId}`,
    "workspace",
    safeName
  );

  if (!existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    // Try to parse as JSON
    try {
      return c.json({ file: safeName, content: JSON.parse(content) });
    } catch {
      return c.json({ file: safeName, content });
    }
  } catch (err) {
    return c.json({ error: "Failed to read file" }, 500);
  }
});

// ── List workspace files for a user ────────────────────────────────
admin.get("/api/users/:id/workspace", async (c) => {
  const userId = parseInt(c.req.param("id"));
  if (isNaN(userId)) return c.json({ error: "Invalid user ID" }, 400);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return c.json({ error: "User not found" }, 404);

  const workspaceDir = resolve(
    INSTANCES_DATA_DIR,
    `user-${user.telegramId}`,
    "workspace"
  );

  if (!existsSync(workspaceDir)) {
    return c.json({ files: [] });
  }

  try {
    const files = readdirSync(workspaceDir).map((name) => {
      const filePath = resolve(workspaceDir, name);
      const stat = statSync(filePath);
      return {
        name,
        size: stat.size,
        modified: stat.mtime,
        isDirectory: stat.isDirectory(),
      };
    });
    return c.json({ files });
  } catch {
    return c.json({ files: [] });
  }
});

// ── Legacy backward-compat routes (old CLI tools call /admin/grant-sub) ──
// These duplicate the /api/* handlers so old scripts keep working.
admin.post("/grant-sub", async (c) => {
  const body = await c.req.json().catch(() => null);
  const identifier = body?.id || body?.telegramId;
  if (!identifier) {
    return c.json({ error: "Provide id or telegramId in body" }, 400);
  }

  let user = await db.query.users.findFirst({
    where: eq(users.id, Number(identifier)),
  });
  if (!user) {
    user = await db.query.users.findFirst({
      where: eq(users.telegramId, String(identifier)),
    });
  }
  if (!user) {
    return c.json({ error: `No user found matching "${identifier}"` }, 404);
  }

  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, user.id),
      eq(subscriptions.status, "active")
    ),
  });
  if (existing) {
    return c.json({
      message: `User ${user.id} (@${user.username || user.firstName}) already has an active subscription`,
      subscription: existing,
    });
  }

  const taken = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(sql`${subscriptions.status} IN ('active', 'pending')`);
  const slotNumber = (taken[0]?.count ?? 0) + 1;

  const now = new Date();
  const [sub] = await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      dodoSubscriptionId: `manual_grant_${user.id}_${Math.floor(now.getTime() / 1000)}`,
      status: "active",
      slotNumber: Math.min(slotNumber, 10),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return c.json({
    message: `Granted subscription to user ${user.id} (@${user.username || user.firstName}), slot #${slotNumber}`,
    subscription: sub,
  });
});

admin.post("/update-all", async (c) => {
  try {
    const results = await docker.rollingUpdateAll(
      async (containerId: string) => {
        const instance = await db.query.instances.findFirst({
          where: eq(instances.containerId, containerId),
        });
        if (!instance) return null;

        const user = await db.query.users.findFirst({
          where: eq(users.id, instance.userId),
        });
        if (!user) return null;

        const config: docker.InstanceConfig = {
          instanceId: instance.id,
          userId: user.id,
          telegramOwnerId: user.telegramId,
          telegramBotToken: decrypt(instance.telegramBotToken),
          openrouterApiKey: decrypt(instance.openrouterApiKey),
          model: instance.model || "openrouter/openrouter/auto",
          llmProvider: instance.llmProvider || "openrouter",
        };

        if (instance.llmProvider === "openai-codex" && instance.openaiAccessToken) {
          config.openaiAccessToken = decrypt(instance.openaiAccessToken);
          if (instance.openaiRefreshToken) {
            config.openaiRefreshToken = decrypt(instance.openaiRefreshToken);
          }
          config.openaiAccountId = instance.openaiAccountId || undefined;
          config.openaiTokenExpires = instance.openaiTokenExpires || undefined;
        }

        return config;
      }
    );

    for (const r of results) {
      if (r.status === "updated" && r.instanceId && r.newContainerId) {
        await db
          .update(instances)
          .set({
            containerId: r.newContainerId,
            status: "pending",
            startedAt: new Date(),
          })
          .where(eq(instances.id, r.instanceId));
      }
    }

    return c.json({
      message: "Rolling update complete",
      results,
      summary: {
        total: results.length,
        updated: results.filter((r) => r.status === "updated").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin] Rolling update failed: ${msg}`);
    return c.json({ error: `Update failed: ${msg}` }, 500);
  }
});

export default admin;

// ── Dashboard HTML ─────────────────────────────────────────────────
function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PMC Admin Dashboard</title>
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #12121a;
    --surface2: #1a1a25;
    --border: #2a2a3a;
    --text: #e0e0e8;
    --text-dim: #8888a0;
    --accent: #6366f1;
    --accent-hover: #818cf8;
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #eab308;
    --orange: #f97316;
    --blue: #3b82f6;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }
  #login-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }
  #login-screen form {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 40px;
    width: 360px;
  }
  #login-screen h1 {
    font-size: 24px;
    margin-bottom: 8px;
    color: var(--accent);
  }
  #login-screen p { color: var(--text-dim); margin-bottom: 24px; font-size: 14px; }
  input[type="password"], input[type="text"] {
    width: 100%;
    padding: 10px 14px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 14px;
    margin-bottom: 16px;
    outline: none;
  }
  input:focus { border-color: var(--accent); }
  button, .btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s;
  }
  button:hover, .btn:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-danger { border-color: var(--red); color: var(--red); }
  .btn-danger:hover { background: var(--red); color: #fff; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  #app { display: none; }
  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  header h1 { font-size: 18px; color: var(--accent); }
  nav { display: flex; gap: 4px; }
  nav button {
    background: transparent;
    border: none;
    color: var(--text-dim);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
  }
  nav button:hover { background: var(--surface2); color: var(--text); }
  nav button.active { background: var(--accent); color: #fff; }
  .container { padding: 24px; max-width: 1400px; margin: 0 auto; }
  .grid { display: grid; gap: 16px; }
  .grid-4 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
  }
  .card h3 { font-size: 13px; color: var(--text-dim); font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .value { font-size: 32px; font-weight: 700; }
  .card .sub { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 2px solid var(--border);
    color: var(--text-dim);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  tr:hover td { background: var(--surface2); }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge-running { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-stopped, .badge-exited { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-pending, .badge-restarting, .badge-created { background: rgba(234,179,8,0.15); color: var(--yellow); }
  .badge-active { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-cancelled, .badge-failed, .badge-expired { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-error { background: rgba(239,68,68,0.15); color: var(--red); }
  .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
  .toolbar .spacer { flex: 1; }
  #log-modal {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,0.7);
    padding: 40px;
  }
  #log-modal .modal-content {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #log-modal .modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  #log-modal .modal-header h2 { font-size: 16px; }
  #log-output {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-dim);
  }
  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  .detail-grid { display: grid; grid-template-columns: 150px 1fr; gap: 8px 16px; font-size: 13px; }
  .detail-grid dt { color: var(--text-dim); font-weight: 500; }
  .detail-grid dd { word-break: break-all; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
  .loading { text-align: center; padding: 40px; color: var(--text-dim); }
  .error-text { color: var(--red); }
  .flash {
    animation: flash 0.3s;
  }
  @keyframes flash {
    0% { background: rgba(99,102,241,0.2); }
    100% { background: transparent; }
  }
</style>
</head>
<body>

<div id="login-screen">
  <form onsubmit="doLogin(event)">
    <h1>PMC Admin</h1>
    <p>Enter your admin password to continue.</p>
    <input type="password" id="login-pass" placeholder="DB_PASS" autofocus>
    <button type="submit" class="btn-primary" style="width:100%;padding:10px">Sign in</button>
    <p id="login-error" class="error-text" style="margin-top:12px;display:none"></p>
  </form>
</div>

<div id="app">
  <header>
    <h1>PumpMyClaw Admin</h1>
    <nav id="nav">
      <button onclick="showTab('overview')" data-tab="overview" class="active">Overview</button>
      <button onclick="showTab('containers')" data-tab="containers">Containers</button>
      <button onclick="showTab('users')" data-tab="users">Users</button>
      <button onclick="showTab('actions')" data-tab="actions">Actions</button>
    </nav>
    <button onclick="logout()" class="btn-sm">Logout</button>
  </header>

  <div class="container">
    <!-- Overview Tab -->
    <div id="tab-overview" class="tab-content active">
      <div class="loading" id="overview-loading">Loading...</div>
      <div id="overview-content" style="display:none">
        <div class="grid grid-4" id="stat-cards"></div>
        <div style="margin-top:24px">
          <div class="card">
            <h3>Docker Host</h3>
            <div id="docker-info" class="detail-grid"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Containers Tab -->
    <div id="tab-containers" class="tab-content">
      <div class="toolbar">
        <button onclick="loadContainers()" class="btn-sm">Refresh</button>
        <span class="spacer"></span>
        <button onclick="bulkAction('stop-all')" class="btn-sm btn-danger">Stop All</button>
        <button onclick="bulkAction('start-all')" class="btn-sm">Start All</button>
        <button onclick="bulkAction('restart-all')" class="btn-sm">Restart All</button>
      </div>
      <div class="card" style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Container</th>
              <th>User</th>
              <th>State</th>
              <th>Model</th>
              <th>Created</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="containers-tbody">
            <tr><td colspan="7" class="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Users Tab -->
    <div id="tab-users" class="tab-content">
      <div class="toolbar">
        <button onclick="loadUsers()" class="btn-sm">Refresh</button>
      </div>
      <div class="card" style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Telegram ID</th>
              <th>Subscription</th>
              <th>Instance</th>
              <th>Wallet</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="users-tbody">
            <tr><td colspan="8" class="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Actions Tab -->
    <div id="tab-actions" class="tab-content">
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));">
        <div class="card">
          <h3>Rolling Update</h3>
          <p style="font-size:13px;color:var(--text-dim);margin-bottom:16px">
            Rebuild instance image and recreate all running containers one at a time.
            Zero data loss — wallet, trades, token all preserved.
          </p>
          <button onclick="doAction('update-all', this)" class="btn-primary">Deploy Update</button>
          <pre id="update-result" class="mono" style="margin-top:12px;max-height:300px;overflow-y:auto;display:none"></pre>
        </div>
        <div class="card">
          <h3>Rebuild Image</h3>
          <p style="font-size:13px;color:var(--text-dim);margin-bottom:16px">
            Force rebuild the instance Docker image only. Does not affect running containers.
            Use "Deploy Update" to push changes to live containers.
          </p>
          <button onclick="doAction('rebuild-image', this)" class="btn">Rebuild Image</button>
          <pre id="rebuild-result" class="mono" style="margin-top:12px;display:none"></pre>
        </div>
        <div class="card">
          <h3>Grant Subscription</h3>
          <p style="font-size:13px;color:var(--text-dim);margin-bottom:16px">
            Manually grant an active subscription to a user by ID or Telegram ID.
          </p>
          <input type="text" id="grant-input" placeholder="User ID or Telegram ID" style="margin-bottom:8px">
          <button onclick="grantSub()" class="btn-primary">Grant</button>
          <pre id="grant-result" class="mono" style="margin-top:12px;display:none"></pre>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Log Modal -->
<div id="log-modal" onclick="if(event.target===this)closeLogModal()">
  <div class="modal-content">
    <div class="modal-header">
      <h2 id="log-modal-title">Container Logs</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:12px;color:var(--text-dim)"><input type="checkbox" id="log-autoscroll" checked> Auto-scroll</label>
        <button onclick="closeLogModal()" class="btn-sm">Close</button>
      </div>
    </div>
    <div id="log-output"></div>
  </div>
</div>

<script>
let TOKEN = localStorage.getItem('pmc_admin_token') || '';
let currentLogStream = null;
let refreshInterval = null;

// ── Auth ───────────────────────────────────────────────────────────
function doLogin(e) {
  e.preventDefault();
  const pass = document.getElementById('login-pass').value;
  fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pass })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        TOKEN = data.token;
        localStorage.setItem('pmc_admin_token', TOKEN);
        showApp();
      } else {
        document.getElementById('login-error').textContent = data.error || 'Invalid password';
        document.getElementById('login-error').style.display = 'block';
      }
    })
    .catch(() => {
      document.getElementById('login-error').textContent = 'Network error';
      document.getElementById('login-error').style.display = 'block';
    });
}

function logout() {
  TOKEN = '';
  localStorage.removeItem('pmc_admin_token');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  if (refreshInterval) clearInterval(refreshInterval);
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  loadOverview();
  refreshInterval = setInterval(() => {
    const activeTab = document.querySelector('nav button.active')?.dataset.tab;
    if (activeTab === 'overview') loadOverview();
    if (activeTab === 'containers') loadContainers();
  }, 15000);
}

// ── API helper ─────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const resp = await fetch('/admin' + path, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (resp.status === 401) { logout(); throw new Error('Unauthorized'); }
  return resp.json();
}

// ── Tabs ───────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector('[data-tab="' + name + '"]').classList.add('active');

  if (name === 'overview') loadOverview();
  if (name === 'containers') loadContainers();
  if (name === 'users') loadUsers();
}

// ── Overview ───────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const data = await api('/api/overview');
    document.getElementById('overview-loading').style.display = 'none';
    document.getElementById('overview-content').style.display = 'block';

    document.getElementById('stat-cards').innerHTML = [
      statCard('Users', data.users, ''),
      statCard('Instances', data.instances, ''),
      statCard('Subscriptions', data.subscriptions.active + ' active', 'of ' + data.subscriptions.total + ' total'),
      statCard('Containers', data.containers.running + ' running', data.containers.stopped + ' stopped'),
      statCard('Uptime', formatUptime(data.uptime), ''),
    ].join('');

    if (data.docker) {
      document.getElementById('docker-info').innerHTML =
        '<dt>Version</dt><dd>' + data.docker.serverVersion + '</dd>' +
        '<dt>CPUs</dt><dd>' + data.docker.cpus + '</dd>' +
        '<dt>Memory</dt><dd>' + data.docker.memoryTotalGB + ' GB</dd>' +
        '<dt>OS</dt><dd>' + data.docker.operatingSystem + '</dd>' +
        '<dt>Images</dt><dd>' + data.docker.images + '</dd>';
    }
  } catch (err) {
    console.error('Failed to load overview:', err);
  }
}

function statCard(title, value, sub) {
  return '<div class="card"><h3>' + title + '</h3><div class="value">' + value + '</div>' +
    (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
}

function formatUptime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  return h + 'h ' + m + 'm';
}

// ── Containers ─────────────────────────────────────────────────────
async function loadContainers() {
  try {
    const data = await api('/api/containers');
    const tbody = document.getElementById('containers-tbody');
    if (data.containers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim)">No managed containers</td></tr>';
      return;
    }
    tbody.innerHTML = data.containers.map(c => {
      const user = c.user ? ('@' + (c.user.username || c.user.firstName || c.user.telegramId)) : '-';
      const stateClass = c.state === 'running' ? 'running' : (c.state === 'exited' ? 'exited' : 'pending');
      return '<tr>' +
        '<td class="mono" title="' + c.id + '">' + c.name + '</td>' +
        '<td>' + user + '</td>' +
        '<td><span class="badge badge-' + stateClass + '">' + c.state + '</span></td>' +
        '<td class="mono" style="font-size:11px">' + (c.model || '-') + '</td>' +
        '<td style="font-size:12px">' + new Date(c.created * 1000).toLocaleDateString() + '</td>' +
        '<td style="font-size:12px;color:var(--text-dim)">' + c.status + '</td>' +
        '<td><div class="actions">' +
          (c.state === 'running'
            ? '<button class="btn-sm" onclick="containerAction(\\'stop\\',\\'' + c.id + '\\')">Stop</button>' +
              '<button class="btn-sm" onclick="containerAction(\\'restart\\',\\'' + c.id + '\\')">Restart</button>'
            : '<button class="btn-sm" onclick="containerAction(\\'start\\',\\'' + c.id + '\\')">Start</button>') +
          '<button class="btn-sm" onclick="viewLogs(\\'' + c.id + '\\', \\'' + c.name + '\\')">Logs</button>' +
          '<button class="btn-sm" onclick="viewStats(\\'' + c.id + '\\', \\'' + c.name + '\\')">Stats</button>' +
          '<button class="btn-sm btn-danger" onclick="containerAction(\\'delete\\',\\'' + c.id + '\\')">Delete</button>' +
        '</div></td></tr>';
    }).join('');
  } catch (err) {
    console.error('Failed to load containers:', err);
  }
}

async function containerAction(action, containerId) {
  if (action === 'delete' && !confirm('Delete this container? User data will be preserved.')) return;
  try {
    await api('/api/containers/' + containerId + '/' + action, { method: 'POST' });
    loadContainers();
  } catch (err) {
    alert('Action failed: ' + err.message);
  }
}

async function bulkAction(action) {
  const label = action.replace('-', ' ').replace('all', 'all containers');
  if (!confirm('Are you sure you want to ' + label + '?')) return;
  try {
    await api('/api/containers/' + action, { method: 'POST' });
    loadContainers();
  } catch (err) {
    alert('Bulk action failed: ' + err.message);
  }
}

// ── Logs Modal ─────────────────────────────────────────────────────
async function viewLogs(containerId, name) {
  document.getElementById('log-modal').style.display = 'block';
  document.getElementById('log-modal-title').textContent = 'Logs: ' + name;
  const output = document.getElementById('log-output');
  output.textContent = 'Loading...';

  // Close previous stream
  if (currentLogStream) { currentLogStream.close(); currentLogStream = null; }

  // Load initial logs
  try {
    const data = await api('/api/containers/' + containerId + '/logs?tail=500');
    output.textContent = data.logs || 'No logs available';
  } catch {
    output.textContent = 'Failed to load logs';
  }

  // Start SSE stream
  try {
    const es = new EventSource('/admin/api/containers/' + containerId + '/logs/stream?token=' + encodeURIComponent(TOKEN));
    currentLogStream = es;
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.log) {
          output.textContent += data.log + '\\n';
          if (document.getElementById('log-autoscroll').checked) {
            output.scrollTop = output.scrollHeight;
          }
        }
        if (data.done) es.close();
      } catch {}
    };
    es.onerror = () => es.close();
  } catch {}

  // Auto-scroll to bottom
  setTimeout(() => { output.scrollTop = output.scrollHeight; }, 100);
}

function closeLogModal() {
  document.getElementById('log-modal').style.display = 'none';
  if (currentLogStream) { currentLogStream.close(); currentLogStream = null; }
}

// ── Stats ──────────────────────────────────────────────────────────
async function viewStats(containerId, name) {
  try {
    const stats = await api('/api/containers/' + containerId + '/stats');
    alert(name + ' Stats:\\n\\n' +
      'CPU: ' + stats.cpuPercent + '%\\n' +
      'Memory: ' + stats.memoryUsageMB + ' MB / ' + stats.memoryLimitMB + ' MB (' + stats.memoryPercent + '%)\\n' +
      'Network RX: ' + stats.networkRxMB + ' MB\\n' +
      'Network TX: ' + stats.networkTxMB + ' MB\\n' +
      'PIDs: ' + stats.pids);
  } catch (err) {
    alert('Failed to get stats: ' + err.message);
  }
}

// ── Users ──────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const data = await api('/api/users');
    const tbody = document.getElementById('users-tbody');
    if (data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim)">No users</td></tr>';
      return;
    }
    tbody.innerHTML = data.users.map(u => {
      const subStatus = u.subscription ? u.subscription.status : 'none';
      const subClass = subStatus === 'active' ? 'active' : (subStatus === 'none' ? 'stopped' : subStatus);
      const instStatus = u.instance ? u.instance.status : 'none';
      const instClass = instStatus === 'running' ? 'running' : (instStatus === 'none' ? 'stopped' : 'pending');
      return '<tr>' +
        '<td>' + u.id + '</td>' +
        '<td>@' + (u.username || u.firstName || '-') + '</td>' +
        '<td class="mono">' + u.telegramId + '</td>' +
        '<td><span class="badge badge-' + subClass + '">' + subStatus + '</span>' +
          (u.subscription?.slotNumber ? ' #' + u.subscription.slotNumber : '') + '</td>' +
        '<td><span class="badge badge-' + instClass + '">' + instStatus + '</span>' +
          (u.instance?.containerId ? ' <span class="mono" style="font-size:10px">' + u.instance.containerId + '</span>' : '') + '</td>' +
        '<td class="mono" style="font-size:11px">' + (u.walletAddress ? u.walletAddress.slice(0,8) + '...' : '-') + '</td>' +
        '<td style="font-size:12px">' + (u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-') + '</td>' +
        '<td><div class="actions">' +
          '<button class="btn-sm" onclick="viewUserDetail(' + u.id + ')">Detail</button>' +
          (u.instance?.containerId ? '<button class="btn-sm" onclick="viewLogs(\\'' + (u.instance?.containerId || '') + '\\',\\'user-' + u.id + '\\')">Logs</button>' : '') +
        '</div></td></tr>';
    }).join('');
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

async function viewUserDetail(userId) {
  try {
    const data = await api('/api/users/' + userId);
    const parts = [];
    parts.push('=== User #' + data.user.id + ' ===');
    parts.push('Username: @' + (data.user.username || '-'));
    parts.push('Telegram: ' + data.user.telegramId);
    parts.push('Wallet: ' + (data.walletAddress || 'not created'));
    parts.push('');
    if (data.subscription) {
      parts.push('=== Subscription ===');
      parts.push('Status: ' + data.subscription.status);
      parts.push('Slot: #' + (data.subscription.slotNumber || '-'));
      if (data.subscription.currentPeriodEnd) {
        parts.push('Period End: ' + new Date(data.subscription.currentPeriodEnd).toISOString());
      }
      parts.push('');
    }
    if (data.instance) {
      parts.push('=== Instance ===');
      parts.push('Status: ' + data.instance.status);
      parts.push('Model: ' + data.instance.model);
      parts.push('Container: ' + (data.instance.containerId || 'none'));
      parts.push('Bot: @' + (data.instance.botUsername || '-'));
      parts.push('');
    }
    if (data.containerStatus) {
      parts.push('=== Container Live ===');
      parts.push('Status: ' + data.containerStatus.status);
      parts.push('Restarts: ' + data.containerStatus.restartCount);
      parts.push('Health: ' + (data.containerStatus.healthStatus || '-'));
      if (data.containerStatus.error) parts.push('Error: ' + data.containerStatus.error);
      parts.push('');
    }
    if (data.trades) {
      parts.push('=== Trades ===');
      parts.push(JSON.stringify(data.trades, null, 2).slice(0, 2000));
      parts.push('');
    }
    if (data.myToken) {
      parts.push('=== MY_TOKEN.md ===');
      parts.push(data.myToken.slice(0, 1000));
    }
    // Use the log modal for display
    document.getElementById('log-modal').style.display = 'block';
    document.getElementById('log-modal-title').textContent = 'User #' + userId + ' Detail';
    document.getElementById('log-output').textContent = parts.join('\\n');
  } catch (err) {
    alert('Failed to load user detail: ' + err.message);
  }
}

// ── Actions ────────────────────────────────────────────────────────
async function doAction(action, btn) {
  const resultId = action === 'update-all' ? 'update-result' : 'rebuild-result';
  const resultEl = document.getElementById(resultId);
  btn.disabled = true;
  btn.textContent = 'Working...';
  resultEl.style.display = 'block';
  resultEl.textContent = 'Starting...';

  try {
    const data = await api('/api/' + action, { method: 'POST' });
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = action === 'update-all' ? 'Deploy Update' : 'Rebuild Image';
  }
}

async function grantSub() {
  const input = document.getElementById('grant-input').value.trim();
  const resultEl = document.getElementById('grant-result');
  if (!input) return;
  resultEl.style.display = 'block';
  resultEl.textContent = 'Granting...';
  try {
    const isNum = /^\\d+$/.test(input);
    const body = isNum ? { id: input } : { telegramId: input };
    const data = await api('/api/grant-sub', { method: 'POST', body: JSON.stringify(body) });
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  }
}

// ── Init ───────────────────────────────────────────────────────────
if (TOKEN) {
  // Verify token is still valid
  fetch('/admin/api/overview', { headers: { 'Authorization': 'Bearer ' + TOKEN } })
    .then(r => { if (r.ok) showApp(); else logout(); })
    .catch(() => logout());
} else {
  document.getElementById('login-screen').style.display = 'flex';
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLogModal();
});
</script>
</body>
</html>`;
}
