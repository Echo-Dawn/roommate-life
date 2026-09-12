/**
 * 金额：一律使用整数分。
 * 输入解析只接受最多两位小数，避免 0.1 + 0.2 这类浮点误差进入账本。
 */

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${sign}${yuan.toLocaleString('zh-CN')}.${`${fen}`.padStart(2, '0')}`;
}

export function formatYuan(cents: number): string {
  return `¥${formatCents(cents)}`;
}

export interface ParseResult {
  ok: boolean;
  cents: number;
  error?: string;
}

/** 解析用户输入的元金额，返回整数分 */
export function parseYuanInput(raw: string): ParseResult {
  const text = raw.trim().replace(/[¥,\s]/g, '');
  if (text === '') return { ok: false, cents: 0, error: '请输入金额' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, cents: 0, error: '金额需为数字，最多两位小数' };
  }
  const [intPart, decPart = ''] = text.split('.');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, cents: 0, error: '金额过大' };
  }
  return { ok: true, cents };
}

/** 分 -> 表单初始值（元） */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
