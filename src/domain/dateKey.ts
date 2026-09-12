/**
 * 本地日历日期工具。
 * 统一用 YYYY-MM-DD 字符串表示「一天」，并在取值/回写时使用本地时间，
 * 避免 Date 的 UTC 转换导致跨时区错日（例如 UTC+8 的 23:00 被算成次日）。
 */

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_RE.test(value);
}

/** Date -> YYYY-MM-DD（本地时区） */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 今天的本地日期 */
export function todayKey(): string {
  return toDateKey(new Date());
}

/** YYYY-MM-DD -> 本地零点 Date */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** 0=周日 … 6=周六 */
export function weekdayOf(key: string): number {
  return parseDateKey(key).getDay();
}

/** b - a，单位天 */
export function diffDays(a: string, b: string): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 以周一为一周之始 */
export function startOfWeek(key: string): string {
  const wd = weekdayOf(key);
  const back = wd === 0 ? 6 : wd - 1;
  return addDays(key, -back);
}

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayLabel(wd: number): string {
  return WEEK_LABELS[wd] ?? '';
}

/** 9 月 12 日 */
export function formatDateCN(key: string): string {
  const date = parseDateKey(key);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 2026-09-12 */
export function formatDateISO(key: string): string {
  return key;
}

export function formatMonthCN(key: string): string {
  const [y, m] = key.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

/** YYYY-MM */
export function monthOf(key: string): string {
  return key.slice(0, 7);
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function formatTimeCN(iso: string): string {
  const d = new Date(iso);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${m}-${day} ${hh}:${mm}`;
}
