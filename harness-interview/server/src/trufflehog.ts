/**
 * TruffleHog secrets scanning with fail-closed behavior.
 */

import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const TRUFFLEHOG_TIMEOUT_MS = 30_000;

/**
 * Scan text with TruffleHog for secrets.
 *
 * Returns true if clean, false if secrets detected.
 * Fail-closed: returns false if TruffleHog is missing or times out.
 */
export function scanForSecrets(text: string): boolean {
  if (!text.trim()) {
    return true;
  }

  const tempPath = join(tmpdir(), `trufflehog-scan-${randomUUID()}.txt`);

  try {
    writeFileSync(tempPath, text, 'utf-8');

    const result = execFileSync('trufflehog', ['filesystem', tempPath, '--json', '--no-update'], {
      timeout: TRUFFLEHOG_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // TruffleHog outputs JSON lines for each finding
    const findings = result
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    if (findings.length > 0) {
      console.warn(`TruffleHog detected ${findings.length} potential secrets`);
      return false;
    }

    return true;
  } catch (error) {
    // Fail-closed on any error
    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        console.error('TruffleHog not installed, rejecting submission for safety');
      } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timed out')) {
        console.error('TruffleHog scan timed out, rejecting submission for safety');
      } else {
        console.error('TruffleHog scan failed, rejecting submission for safety:', error.message);
      }
    }
    return false;
  } finally {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Redact text if secrets are detected.
 * Returns the original text if clean, or a redaction message if secrets found.
 */
export function redactIfSecretsDetected(text: string): string {
  if (!text.trim()) {
    return text;
  }

  if (scanForSecrets(text)) {
    return text;
  }

  return '[REDACTED: potential secret detected]';
}
