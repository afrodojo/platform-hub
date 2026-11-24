export function isLiveStripeConfigured(): boolean {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return false;
  if (
    key.includes('replace') ||
    key.includes('placeholder') ||
    key.includes('your_') ||
    key.startsWith('sk_live_or') ||
    key.startsWith('sk_test_or')
  ) {
    return false;
  }
  return /^sk_(test|live)_[A-Za-z0-9]{16,}$/.test(key);
}