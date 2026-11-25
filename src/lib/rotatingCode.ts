import crypto from 'crypto';

function getCodeSecret(): string {
  return (
    process.env.HITL_ROTATING_CODE_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    'platform-hub-dev-rotating-secret'
  );
}

/**
 * Generates a 6-digit rotating code for a given time step (default: 60s window).
 */
export function generateRotatingCode(offsetSteps = 0, windowSeconds = 60): string {
  const step = Math.floor(Date.now() / 1000 / windowSeconds) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(step));

  const hmac = crypto.createHmac('sha256', getCodeSecret()).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(codeInt % 1_000_000).padStart(6, '0');
}

/**
 * Verifies a 6-digit rotating code across the current window and +/- 1 adjacent window.
 */
export function verifyRotatingCode(candidate: string, windowSeconds = 60): boolean {
  const normalized = (candidate || '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;

  for (const offset of [-1, 0, 1]) {
    const expected = generateRotatingCode(offset, windowSeconds);
    const a = Buffer.from(normalized, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}