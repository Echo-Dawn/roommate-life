import { describe, expect, it } from 'vitest';
import { makeExpense, patchShare, testState, ORDER } from './testFactory';
import {
  buildShareView,
  canVoidExpense,
  shareStatus,
  summarizeFor,
} from './expenses';
import type { AppState } from './types';

function stateWith(expense: ReturnType<typeof makeExpense>): AppState {
  return testState({ expenses: [expense] });
}

describe('份额状态与付款人', () => {
  it('付款人参与分摊时，本人份额为 own，不产生向自己的付款', () => {
    const expense = makeExpense({ id: 'e1', amountCents: 10000, payerId: 'lin' });
    const state = stateWith(expense);
    const ownShare = expense.shares.find((s) => s.memberId === 'lin')!;
    expect(shareStatus(expense, ownShare)).toBe('own');
    const view = buildShareView(expense, ownShare, 'lin');
    expect(view.canMarkPaid).toBe(false);
    expect(view.canConfirm).toBe(false);

    // 小林作为收款方，只应看到他人两位成员的未结清金额
    const summary = summarizeFor(state, 'lin');
    expect(summary.payableCents).toBe(0);
    expect(summary.receivableCents).toBe(6666); // 小周 3333 + 小陈 3333
  });

  it('付款人不参与分摊时，全部金额由参与成员承担', () => {
    const expense = makeExpense({
      id: 'e2',
      amountCents: 9000,
      payerId: 'chen',
      participantIds: ['lin', 'zhou'],
    });
    expect(expense.shares).toHaveLength(2);
    expect(expense.shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(9000);
    const state = stateWith(expense);
    expect(summarizeFor(state, 'lin').payableCents).toBe(4500);
    expect(summarizeFor(state, 'chen').receivableCents).toBe(9000);
    expect(summarizeFor(state, 'chen').payableCents).toBe(0);
  });

  it('付款人参与分摊时，其本人份额仍计入总额但不需结算', () => {
    const expense = makeExpense({ id: 'e3', amountCents: 10000, payerId: 'lin' });
    expect(expense.shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(10000);
    const state = stateWith(expense);
    const summary = summarizeFor(state, 'lin');
    expect(summary.payableCents).toBe(0);
    // 小周 3333 + 小陈 3333 = 6666
    expect(summary.receivableCents).toBe(6666);
  });
});

describe('结算链路与权限', () => {
  it('非本人不能替其他演示成员付款', () => {
    const expense = makeExpense({ id: 'e4', amountCents: 10000, payerId: 'chen' });
    const zhouShare = expense.shares.find((s) => s.memberId === 'zhou')!;
    expect(buildShareView(expense, zhouShare, 'lin').canMarkPaid).toBe(false);
    expect(buildShareView(expense, zhouShare, 'zhou').canMarkPaid).toBe(true);
  });

  it('只有收款成员能确认收款，且必须已标记付款', () => {
    const expense = makeExpense({ id: 'e5', amountCents: 10000, payerId: 'chen' });
    const linShare = expense.shares.find((s) => s.memberId === 'lin')!;
    expect(buildShareView(expense, linShare, 'chen').canConfirm).toBe(false);

    const paid = { ...expense, shares: expense.shares.map((s) => (s.memberId === 'lin' ? { ...s, paidAt: '2026-09-02T00:00:00.000Z' } : s)) };
    const paidLinShare = paid.shares.find((s) => s.memberId === 'lin')!;
    expect(shareStatus(paid, paidLinShare)).toBe('awaiting_confirm');
    expect(buildShareView(paid, paidLinShare, 'chen').canConfirm).toBe(true);
    // 付款本人不能自己确认
    expect(buildShareView(paid, paidLinShare, 'lin').canConfirm).toBe(false);
  });

  it('已结清份额不能重复确认', () => {
    const expense = makeExpense({ id: 'e6', amountCents: 10000, payerId: 'chen' });
    const settled = patchShare(stateWith(expense), 'e6', 'lin', {
      paidAt: '2026-09-02T00:00:00.000Z',
      confirmedAt: '2026-09-03T00:00:00.000Z',
    }).expenses[0];
    const linShare = settled.shares.find((s) => s.memberId === 'lin')!;
    expect(shareStatus(settled, linShare)).toBe('settled');
    expect(buildShareView(settled, linShare, 'chen').canConfirm).toBe(false);
  });
});

describe('异议', () => {
  it('异议保留原付款状态，且暂停结算操作', () => {
    const expense = makeExpense({ id: 'e7', amountCents: 10000, payerId: 'chen' });
    const paid = patchShare(stateWith(expense), 'e7', 'lin', {
      paidAt: '2026-09-02T00:00:00.000Z',
    }).expenses[0];
    const disputed = patchShare(testState({ expenses: [paid] }), 'e7', 'lin', {
      dispute: { raisedBy: 'lin', reason: '金额有异议', at: '2026-09-02T00:00:00.000Z' },
    }).expenses[0];

    const linShare = disputed.shares.find((s) => s.memberId === 'lin')!;
    // 原始状态未被覆盖
    expect(linShare.paidAt).toBe('2026-09-02T00:00:00.000Z');
    expect(shareStatus(disputed, linShare)).toBe('awaiting_confirm');

    const view = buildShareView(disputed, linShare, 'chen');
    expect(view.disputed).toBe(true);
    expect(view.canConfirm).toBe(false);
  });

  it('已结清后异议标记不再阻断（仅作记录）', () => {
    const expense = makeExpense({ id: 'e8', amountCents: 10000, payerId: 'chen' });
    const settled = patchShare(
      patchShare(stateWith(expense), 'e8', 'lin', { paidAt: 'a', confirmedAt: 'b' }),
      'e8',
      'lin',
      { dispute: { raisedBy: 'lin', reason: 'x', at: 'c' } },
    ).expenses[0];
    const linShare = settled.shares.find((s) => s.memberId === 'lin')!;
    expect(buildShareView(settled, linShare, 'chen').disputed).toBe(false);
  });
});

describe('作废规则', () => {
  it('只有创建者在无人标记付款、无人结清时可作废', () => {
    const expense = makeExpense({ id: 'e9', amountCents: 10000, payerId: 'chen', createdBy: 'chen' });
    expect(canVoidExpense(expense, 'chen')).toBe(true);
    expect(canVoidExpense(expense, 'lin')).toBe(false);

    const paid = patchShare(stateWith(expense), 'e9', 'lin', { paidAt: 'x' }).expenses[0];
    expect(canVoidExpense(paid, 'chen')).toBe(false);
  });
});

describe('首页汇总', () => {
  it('不会把其他室友的应付款算到当前身份', () => {
    const rent = makeExpense({ id: 'r', amountCents: 30000, payerId: 'lin' });
    const utility = makeExpense({ id: 'u', amountCents: 3000, payerId: 'chen' });
    const state = testState({ expenses: [rent, utility] });

    const lin = summarizeFor(state, 'lin');
    expect(lin.payableCents).toBe(1000); // 仅 u 中自己的 1000
    expect(lin.receivableCents).toBe(20000); // r 中他人 10000 * 2

    const zhou = summarizeFor(state, 'zhou');
    expect(zhou.payableCents).toBe(11000); // r 10000 + u 1000
    expect(zhou.receivableCents).toBe(0);
  });

  it('待收款确认的金额仍计入未结清，并单列待确认部分', () => {
    const expense = makeExpense({ id: 's', amountCents: 3000, payerId: 'lin' });
    const state = patchShare(
      patchShare(testState({ expenses: [expense] }), 's', 'zhou', { paidAt: 'x' }),
      's',
      'zhou',
      {},
    );
    const summary = summarizeFor(state, 'lin');
    expect(summary.receivableCents).toBe(2000); // zhou 1000 + chen 1000
    expect(summary.awaitingConfirmCents).toBe(1000);
  });

  it('作废账单不计入汇总', () => {
    const expense = makeExpense({ id: 'v', amountCents: 3000, payerId: 'chen' });
    const voided = testState({
      expenses: [{ ...expense, voided: true, voidedAt: 'x', voidedBy: 'chen' }],
    });
    expect(summarizeFor(voided, 'lin').payableCents).toBe(0);
  });

  it('参与人顺序不影响汇总（成员集合一致）', () => {
    const a = testState({ expenses: [makeExpense({ id: 'a', amountCents: 10000, payerId: 'lin' })] });
    const b = testState({
      expenses: [makeExpense({ id: 'b', amountCents: 10000, payerId: 'lin', participantIds: [...ORDER].reverse() })],
    });
    expect(summarizeFor(a, 'zhou')).toEqual(summarizeFor(b, 'zhou'));
  });
});
