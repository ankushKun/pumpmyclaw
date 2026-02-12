/**
 * OpenAI PKCE OAuth helpers for browser-side auth flow.
 *
 * Flow:
 *   1. generatePKCE() → { verifier, challenge, state }
 *   2. getAuthorizeUrl(challenge, state) → URL to open in popup
 *   3. User authorizes in OpenAI, gets redirected to localhost:1455/auth/callback
 *   4. extractCodeFromUrl(callbackUrl) → auth code
 *   5. Send { code, codeVerifier } to backend /api/openai-auth/exchange
 */

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";

/** Generate a random string of given length using crypto */
function randomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

/** Generate a PKCE code verifier (43-128 chars, URL-safe) */
function generateVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Generate SHA-256 code challenge from verifier */
async function generateChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface PKCEParams {
  verifier: string;
  challenge: string;
  state: string;
}

/** Generate all PKCE parameters */
export async function generatePKCE(): Promise<PKCEParams> {
  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  const state = randomString(32);
  return { verifier, challenge, state };
}

/** Build the OpenAI authorize URL */
export function getAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Extract the authorization code from a callback URL */
export function extractCodeFromUrl(url: string): { code: string; state: string } | null {
  try {
    // Handle both full URLs and URLs that may have been pasted partially
    const parsed = new URL(url);
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");
    if (code && state) {
      return { code, state };
    }
  } catch {
    // Not a valid URL
  }
  return null;
}
