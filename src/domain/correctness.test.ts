import { describe, expect, it } from 'vitest';
import {
  buildShareView,
  hasUnsettledForPayer,
  matchesFilter,
  shareStatus,
  sharesAwaitingMyConfirm,
  summarizeFor,
  DEFAULT_EXPENSE_FILTER,
} from './expenses';
import { applyAction } from '../store/reducer';
import { makeExpense, testState, ORDER } from './testFactory';
import { resolveStockInput } from './supplies';
import type { Expense } from './types';

/** 100 元自定义分摊：小林 100、小周 0、小陈 0 */
function customZeroExpense(): Expense {
  const base = makeExpense({ id: 'z1', amountCents: 10000, payerId: 'lin' });
  return {
    ...base,
    mode: 'custom',
    shares: base.shares.map((s) => ({
      ...s,
      amountCents: s.memberId === 'lin' ? 10000 : 0,
    })),
  };
}

describe('0 元份额：无需支付', () => {
  it('0.01 元三人均摊时，零份额状态为 zero', () => {
    // 1 分三人均摊 → 小林（付款人）1 分，其余两人 0 分
    const expense = makeExpense({ id: 'c1', amountCents: 1, payerId: 'lin' });
    const statuses = expense.shares.map((s) => shareStatus(expense, s));
    // 稳定顺序 lin, zhou, chen；余数 1 分给顺序首位 lin
    expect(statuses).toContain('own');
    expect(statuses.filter((s) => s === 'zero').length).toBe(2);
  });

  it('零份额不能付款、确认、异议', () => {
    const expense = customZeroExpense();
    const zero = expense.shares.find((s) => s.memberId === 'zhou')!;
    expect(shareStatus(expense, zero)).toBe('zero');

    const asZhou = buildShareView(expense, zero, 'zhou');
    expect(asZhou.canMarkPaid).toBe(false);
    expect(asZhou.canRaiseDispute).toBe(false);

    const asLin = buildShareView(expense, zero, 'lin');
    expect(asLin.canConfirm).toBe(false);
    expect(asLin.canRaiseDispute).toBe(false);
  });

  it('零份额不进入待我确认、不计入应收应付', () => {
    const state = testState({ expenses: [customZeroExpense()] });
    expect(sharesAwaitingMyConfirm(state, 'lin')).toHaveLength(0);

    const lin = summarizeFor(state, 'lin');
    expect(lin.receivableCents).toBe(0);
    expect(lin.awaitingConfirmCents).toBe(0);

    const zhou = summarizeFor(state, 'zhou');
    expect(zhou.payableCents).toBe(0);
    expect(zhou.receivableCents).toBe(0);
  });

  it('不伪造付款时间：零份额的 paidAt / confirmedAt 保持为空', () => {
    const expense = customZeroExpense();
    expense.shares
      .filter((s) => s.amountCents === 0)
      .forEach((s) => {
        expect(s.paidAt).toBeNull();
        expect(s.confirmedAt).toBeNull();
      });
  });

  it('标记付款与确认收款都会被业务层拒绝', () => {
    const state = testState({ expenses: [customZeroExpense()] });
    const paid = applyAction(state, {
      type: 'share/markPaid',
      expenseId: 'z1',
      memberId: 'zhou',
      by: 'zhou',
    });
    expect(paid.ok).toBe(false);
    const confirmed = applyAction(state, {
      type: 'share/confirm',
      expenseId: 'z1',
      memberId: 'zhou',
      by: 'lin',
    });
    expect(confirmed.ok).toBe(false);
  });

  it('垫付人只剩零份额待收时，不出现在「我垫付待收款」', () => {
    const state = testState({ expenses: [customZeroExpense()] });
    expect(hasUnsettledForPayer(state.expenses[0], 'lin')).toBe(false);
    expect(
      matchesFilter(state.expenses[0], { ...DEFAULT_EXPENSE_FILTER, mine: 'receivable' }, 'lin'),
    ).toBe(false);
  });

  it('非零份额仍然照常可结算（回归保护）', () => {
    const state = testState({
      expenses: [makeExpense({ id: 'n1', amountCents: 9000, payerId: 'lin' })],
    });
    const zhouShare = state.expenses[0].shares.find((s) => s.memberId === 'zhou')!;
    expect(shareStatus(state.expenses[0], zhouShare)).toBe('unpaid');
    expect(buildShareView(state.expenses[0], zhouShare, 'zhou').canMarkPaid).toBe(true);
  });
});

describe('作废账单排除待办与收款候选', () => {
  function voidable() {
    return testState({
      expenses: [makeExpense({ id: 'v1', amountCents: 9000, payerId: 'lin', createdBy: 'lin' })],
    });
  }

  it('作废后不再是待收款候选，也不匹配待付款', () => {
    const state = voidable();
    expect(
      matchesFilter(state.expenses[0], { ...DEFAULT_EXPENSE_FILTER, mine: 'receivable' }, 'lin'),
    ).toBe(true);
    const voided = applyAction(state, { type: 'expense/void', expenseId: 'v1', by: 'lin' });
    expect(voided.ok).toBe(true);
    const e = voided.state.expenses[0];
    expect(
      matchesFilter(e, { ...DEFAULT_EXPENSE_FILTER, mine: 'receivable' }, 'lin'),
    ).toBe(false);
    expect(matchesFilter(e, { ...DEFAULT_EXPENSE_FILTER, mine: 'unpaid' }, 'zhou')).toBe(false);
    expect(matchesFilter(e, { ...DEFAULT_EXPENSE_FILTER, mine: 'awaiting_confirm' }, 'lin')).toBe(
      false,
    );
    expect(hasUnsettledForPayer(e, 'lin')).toBe(false);
  });

  it('作废账单只在「已作废（仅历史）」视图出现', () => {
    const state = voidable();
    const voided = applyAction(state, { type: 'expense/void', expenseId: 'v1', by: 'lin' });
    const e = voided.state.expenses[0];
    expect(matchesFilter(e, { ...DEFAULT_EXPENSE_FILTER, mine: 'voided' }, 'lin')).toBe(true);
    expect(matchesFilter(e, { ...DEFAULT_EXPENSE_FILTER, mine: 'all' }, 'lin')).toBe(true);
  });

  it('作废后不计入首页应收与待确认', () => {
    const state = voidable();
    const before = summarizeFor(state, 'lin');
    expect(before.receivableCents).toBe(6000);
    const voided = applyAction(state, { type: 'expense/void', expenseId: 'v1', by: 'lin' });
    const after = summarizeFor(voided.state, 'lin');
    expect(after.receivableCents).toBe(0);
    expect(sharesAwaitingMyConfirm(voided.state, 'lin')).toHaveLength(0);
  });
});

describe('余量输入草稿', () => {
  it('基线一致时保留用户未提交的输入', () => {
    expect(resolveStockInput({ value: '0', base: 2 }, 2)).toBe('0');
    expect(resolveStockInput({ value: '7', base: 7 }, 7)).toBe('7');
  });

  it('业务更新余量后（补货完成/导入）丢弃旧草稿，显示真实余量', () => {
    // 用户在余量 1 时输入 0，随后补货完成使余量变为 2
    expect(resolveStockInput({ value: '0', base: 1 }, 2)).toBe('2');
  });

  it('没有草稿时显示真实余量', () => {
    expect(resolveStockInput(undefined, 5)).toBe('5');
  });
});

describe('回归保护：原有结算链路不受影响', () => {
  it('100 元三人均摊、标记付款、确认收款仍完整可用', () => {
    let state = testState({
      expenses: [makeExpense({ id: 'r1', amountCents: 10000, payerId: 'lin' })],
    });
    state = applyAction(state, {
      type: 'share/markPaid',
      expenseId: 'r1',
      memberId: 'zhou',
      by: 'zhou',
    }).state;
    expect(sharesAwaitingMyConfirm(state, 'lin')).toHaveLength(1);
    expect(summarizeFor(state, 'lin').awaitingConfirmCents).toBe(
      state.expenses[0].shares.find((s) => s.memberId === 'zhou')!.amountCents,
    );
    state = applyAction(state, {
      type: 'share/confirm',
      expenseId: 'r1',
      memberId: 'zhou',
      by: 'lin',
    }).state;
    const zhou = state.expenses[0].shares.find((s) => s.memberId === 'zhou')!;
    expect(shareStatus(state.expenses[0], zhou)).toBe('settled');
    expect(summarizeFor(state, 'lin').receivableCents).toBe(
      state.expenses[0].shares.find((s) => s.memberId === 'chen')!.amountCents,
    );
  });

  it('参与成员顺序稳定', () => {
    const state = testState({
      expenses: [makeExpense({ id: 'o1', amountCents: 300, payerId: 'chen' })],
    });
    expect(state.expenses[0].shares.map((s) => s.memberId)).toEqual(ORDER);
  });
});
