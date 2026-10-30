/**
 * Google OAuth flow with @stablekernel.com domain restriction.
 */

import { createHash } from 'crypto';

const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const ALLOWED_DOMAIN = 'stablekernel.com';

export interface AuthenticatedUser {
  /** Domain portion of the email */
  readonly domain: string;
  /** SHA256 hash of email for pseudonymity */
  readonly emailHash: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

interface GoogleUserInfo {
  email?: string;
  email_verified?: boolean;
}

/**
 * Validate Google OAuth access token and enforce domain restriction.
 *
 * Returns AuthenticatedUser with pseudonymous identity (hashed email).
 * Throws AuthError if validation fails or domain is not allowed.
 */
export async function validateGoogleToken(accessToken: string): Promise<AuthenticatedUser> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AuthError('Invalid or expired access token');
    }

    const userInfo = (await response.json()) as GoogleUserInfo;
    const { email, email_verified } = userInfo;

    if (!email || !email_verified) {
      throw new AuthError('Email not verified');
    }

    const domain = email.split('@')[1]?.toLowerCase();
    if (domain !== ALLOWED_DOMAIN) {
      throw new AuthError(`Domain ${domain} not allowed. Required: ${ALLOWED_DOMAIN}`);
    }

    const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex');

    return { domain, emailHash };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AuthError('Authentication request timed out');
    }
    throw new AuthError('Authentication failed');
  } finally {
    clearTimeout(timeoutId);
  }
}
