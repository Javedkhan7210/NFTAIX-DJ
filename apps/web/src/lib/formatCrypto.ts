export function shortenAddress(addr: string | null | undefined, lead = 6, tail = 4): string {
  const s = addr?.trim() ?? "";
  if (!s) return "";
  if (s.length <= lead + tail + 1) return s;
  return `${s.slice(0, lead)}…${s.slice(-tail)}`;
}

export function formatMoney(n: number, currency = "$"): string {
  if (!Number.isFinite(n)) return `${currency}0.00`;
  return `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** Parses API decimals / serialized Prisma Decimal; returns null when missing or invalid. */
export function moneyOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parses income `amount` from the API (string, number, or rare JSON numeric wrappers). */
export function parseIncomeAmount(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as { $numberDecimal?: string };
    if (typeof o.$numberDecimal === "string") {
      const n = parseFloat(o.$numberDecimal.replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

export type IncomeAmountRow = {
  amount: string | number;
  status: string;
  incomeType: string;
};

export function sumIncomeAmount(rows: IncomeAmountRow[], pred?: (r: IncomeAmountRow) => boolean): number {
  return rows.reduce((s, r) => {
    if (pred && !pred(r)) return s;
    return s + parseIncomeAmount(r.amount as unknown);
  }, 0);
}
