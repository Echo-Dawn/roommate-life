import { describe, expect, it } from 'vitest';
import { applyAction } from './reducer';
import { makeExpense, testState, ORDER } from '../domain/testFactory';
import { buildShareView } from '../domain/expenses';
import type { AppState, SupplyItem } from '../domain/types';

function addExpense(state: AppState, amountCents: number, overrides = {}) {
  return applyAction(state, {
    type: 'expense/add',
    input: {
      name: '测试账单',
      amountCents,
      category: 'other',
      date: '2026-09-01',
      payerId: 'lin',
      participantIds: ORDER,
      mode: 'equal',
      customAmounts: {},
      note: '',
      createdBy: 'lin',
      ...overrides,
    },
  });
}

const ITEM: SupplyItem = {
  id: 'i1',
  name: '垃圾袋',
  category: '清洁日用',
  location: '阳台',
  stock: 0,
  fullStock: 6,
  unit: '卷',
  lastRestockedAt: null,
  claim: null,
  createdAt: 'x',
  createdBy: 'lin',
  archived: false,
  archivedAt: null,
};

describe('新增账单', () => {
  it('100 元三人均摊，各份额合计严格等于 100 元', () => {
    const result = addExpense(testState(), 10000);
    expect(result.ok).toBe(true);
    const expense = result.state.expenses[0];
    expect(expense.amountCents).toBe(10000);
    expect(expense.shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(10000);
    expect(expense.shares.map((s) => s.amountCents).sort()).toEqual([3333, 3333, 3334]);
  });

  it('总额必须大于 0，参与人不能为空', () => {
    expect(addExpense(testState(), 0).ok).toBe(false);
    expect(addExpense(testState(), -100).ok).toBe(false);
    expect(addExpense(testState(), 10000, { participantIds: [] }).ok).toBe(false);
  });

  it('自定义金额合计必须严格等于总额', () => {
    const bad = addExpense(testState(), 10000, {
      mode: 'custom',
      customAmounts: { lin: 5000, zhou: 3000, chen: 1000 },
    });
    expect(bad.ok).toBe(false);

    const good = addExpense(testState(), 10000, {
      mode: 'custom',
      customAmounts: { lin: 5000, zhou: 3000, chen: 2000 },
    });
    expect(good.ok).toBe(true);
    expect(good.state.expenses[0].shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(10000);
  });

  it('付款人可以不参与分摊', () => {
    const result = addExpense(testState(), 9000, {
      payerId: 'chen',
      participantIds: ['lin', 'zhou'],
    });
    expect(result.ok).toBe(true);
    const expense = result.state.expenses[0];
    expect(expense.shares.map((s) => s.memberId)).toEqual(['lin', 'zhou']);
    expect(expense.shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(9000);
  });
});

describe('结算操作幂等与权限', () => {
  it('重复点击标记付款不会重复生效', () => {
    const base = testState({ expenses: [makeExpense({ id: 'e1', amountCents: 10000, payerId: 'chen' })] });
    const first = applyAction(base, {
      type: 'share/markPaid',
      expenseId: 'e1',
      memberId: 'lin',
      by: 'lin',
    });
    expect(first.ok).toBe(true);
    const second = applyAction(first.state, {
      type: 'share/markPaid',
      expenseId: 'e1',
      memberId: 'lin',
      by: 'lin',
    });
    expect(second.ok).toBe(false);
    expect(second.state).toBe(first.state);
    const share = second.state.expenses[0].shares.find((s) => s.memberId === 'lin')!;
    expect(share.paidAt).toBe(first.state.expenses[0].shares.find((s) => s.memberId === 'lin')!.paidAt);
  });

  it('非收款成员不能确认收款', () => {
    const base = testState({ expenses: [makeExpense({ id: 'e2', amountCents: 10000, payerId: 'chen' })] });
    const paid = applyAction(base, {
      type: 'share/markPaid',
      expenseId: 'e2',
      memberId: 'lin',
      by: 'lin',
    }).state;
    const wrong = applyAction(paid, {
      type: 'share/confirm',
      expenseId: 'e2',
      memberId: 'lin',
      by: 'zhou',
    });
    expect(wrong.ok).toBe(false);
    const right = applyAction(paid, {
      type: 'share/confirm',
      expenseId: 'e2',
      memberId: 'lin',
      by: 'chen',
    });
    expect(right.ok).toBe(true);
    const again = applyAction(right.state, {
      type: 'share/confirm',
      expenseId: 'e2',
      memberId: 'lin',
      by: 'chen',
    });
    expect(again.ok).toBe(false);
  });

  it('异议提出后暂停操作，撤回后恢复原状态', () => {
    const base = testState({ expenses: [makeExpense({ id: 'e3', amountCents: 10000, payerId: 'chen' })] });
    const disputed = applyAction(base, {
      type: 'share/dispute',
      expenseId: 'e3',
      memberId: 'lin',
      by: 'lin',
      reason: '金额需要核对',
    }).state;
    const share = () => disputed.expenses[0].shares.find((s) => s.memberId === 'lin')!;
    expect(buildShareView(disputed.expenses[0], share(), 'lin').canMarkPaid).toBe(false);

    const paidAttempt = applyAction(disputed, {
      type: 'share/markPaid',
      expenseId: 'e3',
      memberId: 'lin',
      by: 'lin',
    });
    expect(paidAttempt.ok).toBe(false);

    const withdrawn = applyAction(disputed, {
      type: 'share/withdrawDispute',
      expenseId: 'e3',
      memberId: 'lin',
      by: 'lin',
    });
    expect(withdrawn.ok).toBe(true);
    const after = withdrawn.state.expenses[0].shares.find((s) => s.memberId === 'lin')!;
    expect(after.dispute).toBeNull();
    expect(after.paidAt).toBeNull();
    expect(after.disputeLog.map((e) => e.action)).toEqual(['raise', 'withdraw']);
    expect(buildShareView(withdrawn.state.expenses[0], after, 'lin').canMarkPaid).toBe(true);
  });

  it('异议原因不能为空', () => {
    const base = testState({ expenses: [makeExpense({ id: 'e4', amountCents: 10000, payerId: 'chen' })] });
    const result = applyAction(base, {
      type: 'share/dispute',
      expenseId: 'e4',
      memberId: 'lin',
      by: 'lin',
      reason: '   ',
    });
    expect(result.ok).toBe(false);
  });
});

describe('公共物品', () => {
  it('已有认领时另一位身份不能重复认领', () => {
    const base = testState({ supplies: [ITEM] });
    const claimed = applyAction(base, { type: 'supply/claim', itemId: 'i1', by: 'lin' });
    expect(claimed.ok).toBe(true);
    const second = applyAction(claimed.state, { type: 'supply/claim', itemId: 'i1', by: 'zhou' });
    expect(second.ok).toBe(false);
  });

  it('只有认领人能完成补货，完成后恢复满量并生成记录', () => {
    const base = testState({ supplies: [ITEM] });
    const claimed = applyAction(base, { type: 'supply/claim', itemId: 'i1', by: 'lin' }).state;
    const wrong = applyAction(claimed, { type: 'supply/completeRestock', itemId: 'i1', by: 'zhou' });
    expect(wrong.ok).toBe(false);

    const done = applyAction(claimed, { type: 'supply/completeRestock', itemId: 'i1', by: 'lin' });
    expect(done.ok).toBe(true);
    expect(done.state.supplies[0].stock).toBe(6);
    expect(done.state.supplies[0].claim).toBeNull();
    expect(done.state.restocks).toHaveLength(1);
  });

  it('补货后记一笔会关联到该补货记录，且只关联一笔', () => {
    const base = testState({ supplies: [ITEM] });
    const done = applyAction(
      applyAction(base, { type: 'supply/claim', itemId: 'i1', by: 'lin' }).state,
      { type: 'supply/completeRestock', itemId: 'i1', by: 'lin' },
    ).state;
    const restockId = done.restocks[0].id;
    const linked = applyAction(done, {
      type: 'expense/add',
      input: {
        name: '垃圾袋补货',
        amountCents: 3000,
        category: 'supplies',
        date: '2026-09-01',
        payerId: 'lin',
        participantIds: ORDER,
        mode: 'equal',
        customAmounts: {},
        note: '',
        createdBy: 'lin',
        linkedRestockId: restockId,
      },
    });
    expect(linked.ok).toBe(true);
    const record = linked.state.restocks.find((r) => r.id === restockId)!;
    expect(record.expenseId).toBe(linked.state.expenses[0].id);
  });
});

describe('身份切换', () => {
  it('只能切换到存在的成员', () => {
    const base = testState();
    expect(applyAction(base, { type: 'identity/set', memberId: 'zhou' }).state.currentMemberId).toBe(
      'zhou',
    );
    expect(applyAction(base, { type: 'identity/set', memberId: 'nobody' }).ok).toBe(false);
  });
});
