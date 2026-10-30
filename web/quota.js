export function dollarsToCents(input) {
  const value = String(input).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) throw new Error('請輸入正數美元金額，最多兩位小數。');
  const [dollars, fraction = ''] = value.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000) throw new Error('金額必須介於 US$0.01 與 US$1,000,000。');
  return cents;
}
export function balance(member) {
  for (const field of ['quota_cents', 'charged_cents', 'reserved_cents']) {
    if (!Number.isSafeInteger(member[field]) || member[field] < 0) throw new Error('額度資料異常，請聯絡管理員。');
  }
  const total = member.quota_cents;
  const available = total - member.charged_cents - member.reserved_cents;
  const usedPercent = total ? Math.min(100, member.charged_cents / total * 100) : 0;
  const reservedPercent = total ? Math.min(100 - usedPercent, member.reserved_cents / total * 100) : 0;
  return {total, available, usedPercent, reservedPercent, overage: Math.max(0, -available)};
}
export const money = cents => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(cents / 100);
