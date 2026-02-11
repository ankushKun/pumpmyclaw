/**
 * Grant a subscription to a user via the running backend's admin API.
 *
 * Usage:
 *   bun run grant-sub <id_or_telegram_id>
 *
 * Requires:
 *   - Backend running (default: http://localhost:8080)
 *   - DB_PASS set in .env (used as admin auth token)
 *
 * Examples:
 *   bun run grant-sub 1            # by user id
 *   bun run grant-sub 1165131649   # by telegram id
 */

export { }; // Module marker for top-level await

const input = process.argv[2];
if (!input) {
  console.error("Usage: bun run grant-sub <id_or_telegram_id>");
  process.exit(1);
}

const port = process.env.PORT || "8080";
const backendUrl = process.env.BACKEND_URL || `http://localhost:${port}`;
const adminPass = process.env.DB_PASS;

if (!adminPass) {
  console.error("DB_PASS must be set in .env (used as admin auth token).");
  process.exit(1);
}

try {
  const res = await fetch(`${backendUrl}/admin/grant-sub`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminPass}`,
    },
    body: JSON.stringify({ id: input }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`Error (${res.status}): ${data.error || "Unknown error"}`);
    process.exit(1);
  }

  console.log(data.message);
} catch (err) {
  console.error(
    `Failed to connect to backend at ${backendUrl}. Is it running?`
  );
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
