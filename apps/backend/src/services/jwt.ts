import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRY = process.env.JWT_EXPIRY || "7d"; // 7 days default

// Encode secret as Uint8Array for jose
const secretKey = new TextEncoder().encode(JWT_SECRET);

export interface TokenPayload extends JWTPayload {
  userId: number;
  telegramId: string;
}

/**
 * Sign a JWT token for a user.
 * Returns the signed token string.
 */
export async function signToken(payload: {
  userId: number;
  telegramId: string;
}): Promise<string> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .setIssuer("pmc")
    .setAudience("pmc")
    .sign(secretKey);

  return token;
}

/**
 * Verify and decode a JWT token.
 * Returns the payload if valid, null otherwise.
 */
export async function verifyToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: "pmc",
      audience: "pmc",
    });

    // Validate required fields
    if (
      typeof payload.userId !== "number" ||
      typeof payload.telegramId !== "string"
    ) {
      return null;
    }

    return payload as TokenPayload;
  } catch {
    return null;
  }
}
