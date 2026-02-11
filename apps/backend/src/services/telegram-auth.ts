import { createHash, createHmac } from "crypto";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function verifyTelegramAuth(
  data: TelegramUser,
  botToken: string
): boolean {
  const { hash, ...rest } = data;

  // Build check string: alphabetically sorted key=value pairs, newline-separated
  const checkString = Object.keys(rest)
    .sort()
    .filter((k) => rest[k as keyof typeof rest] !== undefined)
    .map((k) => `${k}=${rest[k as keyof typeof rest]}`)
    .join("\n");

  // Secret = SHA-256 of bot token
  const secret = createHash("sha256").update(botToken).digest();

  // HMAC-SHA-256
  const computed = createHmac("sha256", secret)
    .update(checkString)
    .digest("hex");

  if (computed !== hash) return false;

  // Reject if auth_date is older than 24 hours
  const now = Math.floor(Date.now() / 1000);
  if (now - data.auth_date > 86400) return false;

  return true;
}
