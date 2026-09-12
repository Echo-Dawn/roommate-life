import type {
  AppState,
  Expense,
  ExpenseCategory,
  MemberId,
  Share,
  ShareStatus,
  ShareView,
} from './types';

/**
 * 费用结算规则。
 * 垫付人本人承担的份额不产生「向自己付款」，标记为 own。
 */

export function shareStatus(expense: Expense, share: Share): ShareStatus {
  if (share.memberId === expense.payerId) return 'own';
  if (share.confirmedAt) return 'settled';
  if (share.paidAt) return 'awaiting_confirm';
  return 'unpaid';
}

/** 异议只在未结清时生效；已结清后异议标记仅作记录 */
export function isShareDisputed(expense: Expense, share: Share): boolean {
  if (!share.dispute) return false;
  return shareStatus(expense, share) !== 'settled';
}

export function buildShareView(
  expense: Expense,
  share: Share,
  currentMemberId: MemberId,
): ShareView {
  const status = shareStatus(expense, share);
  const disputed = isShareDisputed(expense, share);
  const isOwner = currentMemberId === share.memberId;
  const isPayer = currentMemberId === expense.payerId;
  const open = !expense.voided && !disputed && status !== 'settled';

  return {
    expense,
    share,
    status,
    disputed,
    canMarkPaid: open && status === 'unpaid' && isOwner,
    canConfirm: open && status === 'awaiting_confirm' && isPayer,
    canRaiseDispute:
      !expense.voided &&
      !share.dispute &&
      status !== 'settled' &&
      status !== 'own' &&
      (isOwner || isPayer),
    canWithdrawDispute:
      !expense.voided &&
      Boolean(share.dispute) &&
      status !== 'settled' &&
      share.dispute?.raisedBy === currentMemberId,
  };
}

export function expenseShareViews(
  expense: Expense,
  currentMemberId: MemberId,
): ShareView[] {
  return expense.shares.map((share) => buildShareView(expense, share, currentMemberId));
}

export function canVoidExpense(expense: Expense, currentMemberId: MemberId): boolean {
  if (expense.voided) return false;
  if (expense.createdBy !== currentMemberId) return false;
  const anyPaid = expense.shares.some((s) => s.paidAt || s.confirmedAt);
  return !anyPaid;
}

/* ------------------------------- 汇总与筛选 ------------------------------- */

export interface SettlementSummary {
  /** 我应付（尚未标记付款） */
  payableCents: number;
  /** 我应付中处于异议的金额 */
  payableDisputedCents: number;
  /** 我应收（他人未结清份额） */
  receivableCents: number;
  /** 我应收中「已标记付款、待我确认」的部分 */
  awaitingConfirmCents: number;
  /** 我应收中处于异议的金额 */
  receivableDisputedCents: number;
}

export function summarizeFor(state: AppState, memberId: MemberId): SettlementSummary {
  const result: SettlementSummary = {
    payableCents: 0,
    payableDisputedCents: 0,
    receivableCents: 0,
    awaitingConfirmCents: 0,
    receivableDisputedCents: 0,
  };
  state.expenses.forEach((expense) => {
    if (expense.voided) return;
    expense.shares.forEach((share) => {
      const status = shareStatus(expense, share);
      const disputed = isShareDisputed(expense, share);
      if (share.memberId === memberId && status !== 'own') {
        if (status === 'unpaid') {
          result.payableCents += share.amountCents;
          if (disputed) result.payableDisputedCents += share.amountCents;
        }
      }
      if (expense.payerId === memberId && status !== 'own') {
        if (status !== 'settled') {
          result.receivableCents += share.amountCents;
          if (status === 'awaiting_confirm') result.awaitingConfirmCents += share.amountCents;
          if (disputed) result.receivableDisputedCents += share.amountCents;
        }
      }
    });
  });
  return result;
}

/**
 * 'unpaid' / 'awaiting_confirm' / 'settled' 按「本人承担的份额」判断；
 * 'receivable' 是收款视角：本人是垫付人，且仍有他人份额未结清。
 */
export type MySettleFilter =
  | 'all'
  | 'unpaid'
  | 'awaiting_confirm'
  | 'settled'
  | 'receivable'
  | 'none';

export interface ExpenseFilter {
  month: string; // YYYY-MM 或 'all'
  category: ExpenseCategory | 'all';
  mine: MySettleFilter;
}

export const DEFAULT_EXPENSE_FILTER: ExpenseFilter = {
  month: 'all',
  category: 'all',
  mine: 'all',
};

/** 收款视角：本人垫付，且至少还有一位其他成员未结清 */
export function hasUnsettledForPayer(expense: Expense, memberId: MemberId): boolean {
  if (expense.payerId !== memberId) return false;
  return expense.shares.some(
    (s) => s.memberId !== memberId && shareStatus(expense, s) !== 'settled',
  );
}

export function matchesFilter(
  expense: Expense,
  filter: ExpenseFilter,
  memberId: MemberId,
): boolean {
  if (filter.month !== 'all' && !expense.date.startsWith(filter.month)) return false;
  if (filter.category !== 'all' && expense.category !== filter.category) return false;
  if (filter.mine !== 'all') {
    if (filter.mine === 'receivable') {
      return hasUnsettledForPayer(expense, memberId);
    }
    const share = expense.shares.find((s) => s.memberId === memberId);
    const status = share ? shareStatus(expense, share) : 'none';
    if (status !== filter.mine) return false;
  }
  return true;
}

export const MINE_FILTER_LABELS: Record<MySettleFilter, string> = {
  all: '全部账单',
  unpaid: '我的待付款',
  awaiting_confirm: '我的待确认',
  settled: '我的已结清',
  receivable: '我垫付待收款',
  none: '未参与分摊',
};

export function availableMonths(expenses: Expense[]): string[] {
  const set = new Set<string>();
  expenses.forEach((e) => set.add(e.date.slice(0, 7)));
  return [...set].sort().reverse();
}

/** 待我确认收款的份额 */
export function sharesAwaitingMyConfirm(state: AppState, memberId: MemberId): ShareView[] {
  const result: ShareView[] = [];
  state.expenses.forEach((expense) => {
    if (expense.voided) return;
    expense.shares.forEach((share) => {
      const view = buildShareView(expense, share, memberId);
      if (view.canConfirm) result.push(view);
    });
  });
  return result;
}

/** 待我付款的份额 */
export function sharesAwaitingMyPayment(state: AppState, memberId: MemberId): ShareView[] {
  const result: ShareView[] = [];
  state.expenses.forEach((expense) => {
    if (expense.voided) return;
    expense.shares.forEach((share) => {
      const view = buildShareView(expense, share, memberId);
      if (view.canMarkPaid) result.push(view);
    });
  });
  return result;
}

/** 与当前身份相关的在途异议 */
export function openDisputes(state: AppState, memberId: MemberId): ShareView[] {
  const result: ShareView[] = [];
  state.expenses.forEach((expense) => {
    if (expense.voided) return;
    expense.shares.forEach((share) => {
      if (!isShareDisputed(expense, share)) return;
      if (share.memberId === memberId || expense.payerId === memberId) {
        result.push(buildShareView(expense, share, memberId));
      }
    });
  });
  return result;
}
