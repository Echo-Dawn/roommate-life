import { describe, expect, it } from 'vitest';
import { applyAction } from '../store/reducer';
import { makeExpense, testState, ORDER } from '../domain/testFactory';
import {
  DEFAULT_EXPENSE_FILTER,
  hasUnsettledForPayer,
  matchesFilter,
  summarizeFor,
} from '../domain/expenses';
import type { ExpenseDraftInput } from '../store/reducer';
import type { AppState, SupplyItem } from '../domain/types';

function sampleItem(): SupplyItem {
  return {
    id: 's1',
    name: '洗洁精',
    category: '清洁日用',
    location: '厨房水槽下',
    stock: 1,
    fullStock: 2,
    unit: '瓶',
    lastRestockedAt: null,
    claim: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'lin',
  };
}

function draft(overrides: Partial<ExpenseDraftInput> = {}): ExpenseDraftInput {
  return {
    name: '洗洁精补货',
    amountCents: 2000,
    category: 'supplies',
    date: '2026-09-10',
    payerId: 'lin',
    participantIds: [...ORDER],
    mode: 'equal',
    customAmounts: {},
    note: '',
    createdBy: 'lin',
    ...overrides,
  };
}

/** 走完「认领 → 完成补货」，返回状态与本次补货记录 id */
function completeRestock(state: AppState, by: 'lin' | 'zhou' | 'chen' = 'lin') {
  const claimed = applyAction(state, { type: 'supply/claim', itemId: 's1', by });
  expect(claimed.ok).toBe(true);
  const done = applyAction(claimed.state, { type: 'supply/completeRestock', itemId: 's1', by });
  expect(done.ok).toBe(true);
  const record = done.state.restocks[done.state.restocks.length - 1];
  return { state: done.state, restockId: record.id };
}

describe('补货记录补记费用（业务层防重）', () => {
  it('未关联的补货记录可以补记，并写入关联', () => {
    const base = testState({ supplies: [sampleItem()] });
    const { state, restockId } = completeRestock(base);
    const res = applyAction(state, {
      type: 'expense/add',
      input: draft({ linkedRestockId: restockId }),
    });
    expect(res.ok).toBe(true);
    const expense = res.state.expenses[0];
    expect(expense.linkedRestockId).toBe(restockId);
    expect(res.state.restocks.find((r) => r.id === restockId)!.expenseId).toBe(expense.id);
  });

  it('已有有效关联时，即使绕过界面也会被业务层拒绝', () => {
    const base = testState({ supplies: [sampleItem()] });
    const { state, restockId } = completeRestock(base);
    const first = applyAction(state, {
      type: 'expense/add',
      input: draft({ linkedRestockId: restockId }),
    });
    expect(first.ok).toBe(true);
    const second = applyAction(first.state, {
      type: 'expense/add',
      input: draft({ linkedRestockId: restockId, name: '重复补记' }),
    });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('已关联');
    expect(second.state).toBe(first.state);
    expect(second.state.expenses).toHaveLength(1);
  });

  it('原关联账单作废后可以重新补记，作废的账单不再算有效关联', () => {
    const base = testState({ supplies: [sampleItem()] });
    const { state, restockId } = completeRestock(base);
    const first = applyAction(state, {
      type: 'expense/add',
      input: draft({ linkedRestockId: restockId, createdBy: 'lin' }),
    });
    const expenseId = first.state.expenses[0].id;

    const voided = applyAction(first.state, { type: 'expense/void', expenseId, by: 'lin' });
    expect(voided.ok).toBe(true);
    // 作废后查询「有效关联」应为空，界面应重新出现补记入口
    const stillLinked = voided.state.expenses.find(
      (e) => e.linkedRestockId === restockId && !e.voided,
    );
    expect(stillLinked).toBeUndefined();

    const relink = applyAction(voided.state, {
      type: 'expense/add',
      input: draft({ linkedRestockId: restockId }),
    });
    expect(relink.ok).toBe(true);
    expect(relink.state.expenses.filter((e) => !e.voided)).toHaveLength(1);
    expect(relink.state.restocks.find((r) => r.id === restockId)!.expenseId).toBe(
      relink.state.expenses[0].id,
    );
  });

  it('关联不存在的补货记录会被拒绝', () => {
    const base = testState({ supplies: [sampleItem()] });
    const res = applyAction(base, {
      type: 'expense/add',
      input: draft({ linkedRestockId: 'not-exist' }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('不存在');
  });
});

describe('账本收款视角筛选', () => {
  const state = testState({
    expenses: [makeExpense({ id: 'e1', amountCents: 9000, payerId: 'lin' })],
  });

  it('我垫付且他人未结清时命中应收筛选', () => {
    expect(hasUnsettledForPayer(state.expenses[0], 'lin')).toBe(true);
    expect(
      matchesFilter(state.expenses[0], { ...DEFAULT_EXPENSE_FILTER, mine: 'receivable' }, 'lin'),
    ).toBe(true);
    // 非垫付人不应命中
    expect(
      matchesFilter(state.expenses[0], { ...DEFAULT_EXPENSE_FILTER, mine: 'receivable' }, 'zhou'),
    ).toBe(false);
  });

  it('只判断本人份额会漏掉垫付账单，收款视角不能这样算', () => {
    // 小林是付款人，本人份额状态为 own；若按本人份额判断会被错误排除
    const ownStatusFilter = matchesFilter(
      state.expenses[0],
      { ...DEFAULT_EXPENSE_FILTER, mine: 'unpaid' },
      'lin',
    );
    expect(ownStatusFilter).toBe(false);
    expect(
      matchesFilter(state.expenses[0], { ...DEFAULT_EXPENSE_FILTER, mine: 'receivable' }, 'lin'),
    ).toBe(true);
  });

  it('全员结清后不再出现在应收筛选中', () => {
    let s = state;
    ['zhou', 'chen'].forEach((memberId) => {
      s = applyAction(s, { type: 'share/markPaid', expenseId: 'e1', memberId, by: memberId }).state;
      s = applyAction(s, { type: 'share/confirm', expenseId: 'e1', memberId, by: 'lin' }).state;
    });
    expect(hasUnsettledForPayer(s.expenses[0], 'lin')).toBe(false);
    expect(
      matchesFilter(s.expenses[0], { ...DEFAULT_EXPENSE_FILTER, mine: 'receivable' }, 'lin'),
    ).toBe(false);
  });
});

describe('首页汇总随身份切换', () => {
  it('付款人视角统计他人未结清，参与人视角统计自己待付款', () => {
    const state = testState({
      expenses: [makeExpense({ id: 'e1', amountCents: 9000, payerId: 'lin' })],
    });
    const lin = summarizeFor(state, 'lin');
    expect(lin.payableCents).toBe(0);
    expect(lin.receivableCents).toBe(6000); // 小周、小陈各 3000

    const zhou = summarizeFor(state, 'zhou');
    expect(zhou.payableCents).toBe(3000);
    expect(zhou.receivableCents).toBe(0);

    // 不能把所有室友应付金额算成当前身份的应付款
    const chen = summarizeFor(state, 'chen');
    expect(chen.payableCents).toBe(3000);
    expect(chen.receivableCents).toBe(0);
  });
});
