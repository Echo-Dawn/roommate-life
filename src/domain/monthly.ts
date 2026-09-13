import { categoryLabel } from './types';
import { isSettleable, shareStatus } from './expenses';
import type {
  AppState,
  Expense,
  ExpenseCategory,
  MemberId,
  ShareStatus,
} from './types';

/**
 * 月度概览：按「费用发生月」汇总，不是实际转账流水。
 * - 总支出 = 该月有效账单金额之和
 * - 个人承担 = 各人在这月账单里的份额之和（含垫付人自己的份额）
 * - 未结清按「债务人 → 垫付人」配对汇总，可追溯到原账单
 * - 已标记付款但未被确认的金额单列，不与「未付」混在一起
 * 不做跨人债务抵消，也不提供一键虚假结清。
 */

export interface MonthCategoryTotal {
  category: ExpenseCategory;
  cents: number;
}

export interface MonthMemberTotal {
  memberId: MemberId;
  /** 本人承担的金额（含其垫付账单中自己的份额） */
  shareCents: number;
  /** 本人垫付的金额 */
  paidCents: number;
}

export interface UnsettledItem {
  expenseId: string;
  name: string;
  date: string;
  cents: number;
  status: ShareStatus;
}

export interface UnsettledPair {
  /** 债务人（需要付款的人） */
  debtorId: MemberId;
  /** 垫付人（收款方） */
  creditorId: MemberId;
  /** 尚未标记付款的金额 */
  unpaidCents: number;
  /** 已标记付款、等待对方确认的金额 */
  awaitingCents: number;
  items: UnsettledItem[];
}

export interface MonthSummary {
  month: string; // YYYY-MM
  /** 有效账单总额 */
  totalCents: number;
  expenseCount: number;
  voidedCount: number;
  categories: MonthCategoryTotal[];
  members: MonthMemberTotal[];
  unsettled: UnsettledPair[];
  /** 已标记付款但未确认的总额（跨全部配对） */
  awaitingConfirmCents: number;
  /** 仍未标记付款的总额 */
  unpaidCents: number;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 可用的账期：全部有账单的月份 + 当前月，倒序 */
export function availablePeriods(expenses: Expense[], today: string): string[] {
  const set = new Set<string>(expenses.map((e) => monthOf(e.date)));
  set.add(monthOf(today));
  return [...set].sort().reverse();
}

export function currentMonth(today: string): string {
  return monthOf(today);
}

export function buildMonthSummary(state: AppState, month: string): MonthSummary {
  const expenses = state.expenses.filter((e) => monthOf(e.date) === month);
  const valid = expenses.filter((e) => !e.voided);

  const totalCents = valid.reduce((acc, e) => acc + e.amountCents, 0);

  const categoryMap = new Map<ExpenseCategory, number>();
  const memberShare = new Map<MemberId, number>();
  const memberPaid = new Map<MemberId, number>();
  state.members.forEach((m) => {
    memberShare.set(m.id, 0);
    memberPaid.set(m.id, 0);
  });

  valid.forEach((expense) => {
    categoryMap.set(
      expense.category,
      (categoryMap.get(expense.category) ?? 0) + expense.amountCents,
    );
    memberPaid.set(
      expense.payerId,
      (memberPaid.get(expense.payerId) ?? 0) + expense.amountCents,
    );
    expense.shares.forEach((share) => {
      memberShare.set(share.memberId, (memberShare.get(share.memberId) ?? 0) + share.amountCents);
    });
  });

  // 未结清：按 债务人 → 垫付人 聚合
  const pairMap = new Map<string, UnsettledPair>();
  valid.forEach((expense) => {
    expense.shares.forEach((share) => {
      if (!isSettleable(expense, share)) return;
      const key = `${share.memberId}->${expense.payerId}`;
      const status = shareStatus(expense, share);
      let pair = pairMap.get(key);
      if (!pair) {
        pair = {
          debtorId: share.memberId,
          creditorId: expense.payerId,
          unpaidCents: 0,
          awaitingCents: 0,
          items: [],
        };
        pairMap.set(key, pair);
      }
      if (status === 'unpaid') pair.unpaidCents += share.amountCents;
      else pair.awaitingCents += share.amountCents;
      pair.items.push({
        expenseId: expense.id,
        name: expense.name,
        date: expense.date,
        cents: share.amountCents,
        status,
      });
    });
  });

  const unsettled = [...pairMap.values()]
    .map((p) => ({
      ...p,
      items: p.items.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => {
      const totalA = a.unpaidCents + a.awaitingCents;
      const totalB = b.unpaidCents + b.awaitingCents;
      return totalB - totalA;
    });

  return {
    month,
    totalCents,
    expenseCount: valid.length,
    voidedCount: expenses.length - valid.length,
    categories: [...categoryMap.entries()]
      .map(([category, cents]) => ({ category, cents }))
      .sort((a, b) => b.cents - a.cents),
    members: state.members.map((m) => ({
      memberId: m.id,
      shareCents: memberShare.get(m.id) ?? 0,
      paidCents: memberPaid.get(m.id) ?? 0,
    })),
    unsettled,
    awaitingConfirmCents: unsettled.reduce((acc, p) => acc + p.awaitingCents, 0),
    unpaidCents: unsettled.reduce((acc, p) => acc + p.unpaidCents, 0),
  };
}

/** 纯文本月度摘要：只由当前数据计算，复制后由用户自行发送 */
export function monthSummaryText(
  state: AppState,
  month: string,
  formatCents: (cents: number) => string,
  nameOf: (id: MemberId) => string,
): string {
  const s = buildMonthSummary(state, month);
  const lines: string[] = [];
  lines.push(`【${state.homeName}】${month} 月度账单概览`);
  lines.push(`有效账单 ${s.expenseCount} 笔，总支出 ${formatCents(s.totalCents)}`);
  if (s.categories.length > 0) {
    lines.push(
      `分类：${s.categories.map((c) => `${categoryLabel(c.category)} ${formatCents(c.cents)}`).join('，')}`,
    );
  }
  lines.push(
    `各人承担：${s.members.map((m) => `${nameOf(m.memberId)} ${formatCents(m.shareCents)}`).join('，')}`,
  );
  lines.push('');
  if (s.unsettled.length === 0) {
    lines.push('未结清：无（本月账单已全部结清）');
  } else {
    lines.push('未结清（债务人 → 垫付人）：');
    s.unsettled.forEach((p) => {
      const parts: string[] = [];
      if (p.unpaidCents > 0) parts.push(`待付款 ${formatCents(p.unpaidCents)}`);
      if (p.awaitingCents > 0) parts.push(`待确认 ${formatCents(p.awaitingCents)}`);
      lines.push(`- ${nameOf(p.debtorId)} → ${nameOf(p.creditorId)}：${parts.join('，')}`);
      p.items.forEach((item) => {
        const label = item.status === 'awaiting_confirm' ? '已标记付款待确认' : '待付款';
        lines.push(`    · ${item.name}（${item.date}）${formatCents(item.cents)} · ${label}`);
      });
    });
  }
  lines.push('');
  lines.push(`说明：以上为当前结算状态，由本机演示数据实时计算，不代表历史月末快照。`);
  return lines.join('\n');
}
