// Live preview of the maths. The server recalculates everything on save (backend/main/calc.py).
import { num, shop } from './format';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function lineTotals(l) {
  const pq = num(shop.priceQuantity) || 1;
  const qty = num(l.quantity) || 1;
  const totalWeight = num(l.netWeight) * qty + num(l.lossWeight);
  const metal = (totalWeight * num(l.rate)) / pq;
  const c = num(l.makingCharge);
  const making = l.makingMode === 'fixed' ? c * qty : l.makingMode === 'percent' ? (metal * c) / 100 : (c * totalWeight) / pq;
  return { totalWeight: r3(totalWeight), metal: r2(metal), making: r2(making), amount: r2(metal + making + num(l.gemsPrice) * qty) };
}

export function billTotals(lines, b, taxRate = 0) {
  const pq = num(shop.priceQuantity) || 1;
  const calc = lines.map(lineTotals);
  const subtotal = calc.reduce((s, l) => s + l.amount, 0);
  const finalWeight = calc.reduce((s, l) => s + l.totalWeight, 0);
  const oldMetal = (num(b.customerMetalWeight) * num(b.buyRate)) / pq;
  const taxable = Math.max(subtotal - num(b.discount), 0);
  const tax = (taxable * num(taxRate)) / 100;
  const grand = taxable + tax - oldMetal;
  return {
    lines: calc, subtotal: r2(subtotal), finalWeight: r3(finalWeight), oldMetal: r2(oldMetal), tax: r2(tax), grand: r2(grand),
    remaining: r2(grand - num(b.advanceAmount) - num(b.paidAmount) - num(b.laterPaid)),
  };
}
