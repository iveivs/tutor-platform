// The monthly subscription price comes from SUBSCRIPTION_MONTHLY_PRICE_RUB on the server, so it
// can change without a release. Without it the interface shows no price, only the contacts.
export function subscriptionPriceCents() {
  const rubles = Number(process.env.SUBSCRIPTION_MONTHLY_PRICE_RUB);
  return Number.isFinite(rubles) && rubles > 0 && rubles <= 1_000_000 ? Math.round(rubles * 100) : null;
}
