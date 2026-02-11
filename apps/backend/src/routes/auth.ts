import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import {
  verifyTelegramAuth,
  type TelegramUser,
} from "../services/telegram-auth";
import { signToken } from "../services/jwt";

const auth = new Hono();

const IS_DEV = process.env.NODE_ENV !== "production";

const telegramAuthSchema = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

auth.post("/telegram", async (c) => {
  const body = await c.req.json();
  const parsed = telegramAuthSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request data" }, 400);
  }

  const telegramData = parsed.data as TelegramUser;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  // Dev bypass: skip HMAC verification if hash is "dev_bypass" and we're in dev mode
  const isDevBypass = IS_DEV && telegramData.hash === "dev_bypass";

  if (!isDevBypass) {
    if (!botToken) {
      return c.json({ error: "Server misconfigured: no bot token" }, 500);
    }
    if (!verifyTelegramAuth(telegramData, botToken)) {
      return c.json({ error: "Invalid Telegram authentication" }, 401);
    }
  }

  const telegramId = String(telegramData.id);

  // Upsert: find existing user or create new one
  let user = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
  });

  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        telegramId,
        username: telegramData.username,
        firstName: telegramData.first_name,
      })
      .returning();
    user = created;
  }

  // Generate JWT token
  const token = await signToken({
    userId: user.id,
    telegramId: user.telegramId,
  });

  return c.json({
    user: {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
    },
    token,
  });
});

export default auth;
