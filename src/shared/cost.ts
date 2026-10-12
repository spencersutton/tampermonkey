// Estimated total cost = (bid + buyer's premium + lot fee [+ transfer fee]) × (1 + sales tax)
export const FEES = {
  premium: 0.15, // 15% buyer's premium
  lotFee: 1, // $1 per lot
  transferFee: 5, // $5 for Anderson / Transferable lots
  salesTax: 0.0725, // 7.25% NC sales tax
};

export function totalCost(bid: number, transferFee = 0): number {
  return (bid * (1 + FEES.premium) + FEES.lotFee + transferFee) * (1 + FEES.salesTax);
}

export function costBreakdown(bid: number, transferFee = 0): string {
  return (
    `${money(bid)} + ${+(FEES.premium * 100).toFixed(2)}% premium + ${money(FEES.lotFee)} lot fee` +
    (transferFee ? ` + ${money(transferFee)} transfer` : '') +
    `, then ${(FEES.salesTax * 100).toFixed(2)}% sales tax`
  );
}

export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const dollars = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
