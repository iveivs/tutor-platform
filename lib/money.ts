// Money is kept as integer minor units (kopecks, cents). The currency is a free label chosen by the teacher.

const amountFormat = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatMoney(cents: number, currency?: string | null) {
  const value = amountFormat.format(cents / 100);
  return currency ? `${value} ${currency}` : value;
}

// Value for an input field: "2000" or "2000,5"; empty for "not set".
export function moneyInputValue(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "";
  return String(cents / 100).replace(".", ",");
}

// Parses what the teacher typed. Returns null for an empty field and NaN for invalid input.
export function parseMoneyInput(value: string) {
  const normalized = value.replace(/[\s ]/g, "").replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
}
