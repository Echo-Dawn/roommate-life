import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  periodDate,
  previewTemplate,
  computeTemplateShares,
  generatableTemplates,
  isDateClamped,
} from './templates';
import { buildMonthSummary, monthSummaryText, availablePeriods } from './monthly';
import { applyAction } from '../store/reducer';
import { makeExpense, testState, ORDER } from './testFactory';
import { migrate } from '../store/storage';
import { SCHEMA_VERSION, type AppState, type ExpenseTemplate } from './types';

function template(overrides: Partial<ExpenseTemplate> = {}): ExpenseTemplate {
  return {
    id: 'tpl-1',
    name: '房租',
    category: 'rent',
    dayOfMonth: 1,
    amountCents: 300000,
    payerId: 'lin',
    participantIds: [...ORDER],
    mode: 'equal',
    customAmounts: {},
    note: '',
    active: true,
    createdBy: 'lin',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('账期日期', () => {
  it('短月取当月最后一天，2 月平年为 28 日', () => {
    expect(periodDate('2026-02', 31)).toBe('2026-02-28');
    expect(periodDate('2026-04', 31)).toBe('2026-04-30');
    expect(periodDate('2026-01', 31)).toBe('2026-01-31');
  });

  it('闰年 2 月为 29 日', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(periodDate('2024-02', 31)).toBe('2024-02-29');
    expect(daysInMonth('2026-02')).toBe(28);
  });

  it('标记日期是否被裁剪', () => {
    expect(isDateClamped('2026-02', 31)).toBe(true);
    expect(isDateClamped('2026-01', 31)).toBe(false);
  });
});

describe('模板生成与防重', () => {
  it('固定金额模板生成账单并记录模板与账期', () => {
    const state = testState({ templates: [template()] });
    const res = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-1',
      month: '2026-03',
      amountCents: null,
    });
    expect(res.ok).toBe(true);
    const expense = res.state.expenses[0];
    expect(expense.amountCents).toBe(300000);
    expect(expense.date).toBe('2026-03-01');
    expect(expense.templateId).toBe('tpl-1');
    expect(expense.periodKey).toBe('2026-03');
    expect(expense.shares.reduce((a, s) => a + s.amountCents, 0)).toBe(300000);
  });

  it('同一模板同一账期不能重复生成', () => {
    let state = testState({ templates: [template()] });
    state = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-1',
      month: '2026-03',
      amountCents: null,
    }).state;
    const again = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-1',
      month: '2026-03',
      amountCents: null,
    });
    expect(again.ok).toBe(false);
    expect(again.error).toContain('重复');
    expect(again.state.expenses).toHaveLength(1);
  });

  it('不同账期可以分别生成；跨年也不冲突', () => {
    let state = testState({ templates: [template()] });
    ['2025-12', '2026-01', '2026-02'].forEach((month) => {
      const res = applyAction(state, {
        type: 'template/generate',
        templateId: 'tpl-1',
        month,
        amountCents: null,
      });
      expect(res.ok).toBe(true);
      state = res.state;
    });
    expect(state.expenses).toHaveLength(3);
    expect(state.expenses.map((e) => e.date).sort()).toEqual([
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
  });

  it('每期手填金额：未填金额被拒绝，填写后生成', () => {
    const state = testState({
      templates: [template({ id: 'tpl-u', name: '水电', amountCents: null, dayOfMonth: 6 })],
    });
    const missing = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-u',
      month: '2026-03',
      amountCents: null,
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('金额');

    const okRes = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-u',
      month: '2026-03',
      amountCents: 12345,
    });
    expect(okRes.ok).toBe(true);
    expect(okRes.state.expenses[0].amountCents).toBe(12345);
    expect(okRes.state.expenses[0].date).toBe('2026-03-06');
  });

  it('短月模板日期取月末', () => {
    const state = testState({
      templates: [template({ id: 'tpl-n', dayOfMonth: 31, amountCents: 9900 })],
    });
    const res = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-n',
      month: '2026-02',
      amountCents: null,
    });
    expect(res.ok).toBe(true);
    expect(res.state.expenses[0].date).toBe('2026-02-28');
  });

  it('账单作废后可以重新生成，之前的作废记录保留', () => {
    let state = testState({ templates: [template({ createdBy: 'lin' })] });
    state = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-1',
      month: '2026-03',
      amountCents: null,
    }).state;
    const previewBefore = previewTemplate(state, state.templates[0], '2026-03', null);
    expect(previewBefore.duplicate).toBe(true);

    state = applyAction(state, {
      type: 'expense/void',
      expenseId: state.expenses[0].id,
      by: 'lin',
    }).state;
    const previewAfter = previewTemplate(state, state.templates[0], '2026-03', null);
    expect(previewAfter.duplicate).toBe(false);
    expect(previewAfter.voidedExpenseId).toBeTruthy();

    const regen = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-1',
      month: '2026-03',
      amountCents: null,
    });
    expect(regen.ok).toBe(true);
    expect(regen.state.expenses).toHaveLength(2); // 作废记录 + 新记录
    expect(regen.state.expenses.filter((e) => !e.voided)).toHaveLength(1);
  });

  it('停用模板不会出现在可生成列表，也不生成账单', () => {
    let state = testState({ templates: [template()] });
    state = applyAction(state, { type: 'template/toggle', templateId: 'tpl-1', active: false })
      .state;
    expect(generatableTemplates(state, '2026-03')).toHaveLength(0);
    const res = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-1',
      month: '2026-03',
      amountCents: null,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('停用');
    // 重新启用后可以正常生成
    const reactivated = applyAction(state, {
      type: 'template/toggle',
      templateId: 'tpl-1',
      active: true,
    }).state;
    expect(
      applyAction(reactivated, {
        type: 'template/generate',
        templateId: 'tpl-1',
        month: '2026-03',
        amountCents: null,
      }).ok,
    ).toBe(true);
  });

  it('修改模板不改变已生成账单', () => {
    let state = testState({ templates: [template()] });
    state = applyAction(state, {
      type: 'template/generate',
      templateId: 'tpl-1',
      month: '2026-03',
      amountCents: null,
    }).state;
    const before = state.expenses[0];
    state = applyAction(state, {
      type: 'template/update',
      templateId: 'tpl-1',
      patch: { amountCents: 999900, name: '房租（涨）', dayOfMonth: 15 },
    }).state;
    const after = state.expenses.find((e) => e.id === before.id)!;
    expect(after.amountCents).toBe(before.amountCents);
    expect(after.date).toBe(before.date);
    expect(after.name).toBe(before.name);
  });

  it('模板校验：名称、日期、金额、参与人', () => {
    const state = testState();
    expect(
      applyAction(state, {
        type: 'template/add',
        input: {
          name: '  ',
          category: 'rent',
          dayOfMonth: 1,
          amountCents: 100,
          payerId: 'lin',
          participantIds: ORDER,
          mode: 'equal',
          customAmounts: {},
          note: '',
          createdBy: 'lin',
        },
      }).ok,
    ).toBe(false);
    expect(
      applyAction(state, {
        type: 'template/add',
        input: {
          name: '网费',
          category: 'network',
          dayOfMonth: 32,
          amountCents: 100,
          payerId: 'lin',
          participantIds: ORDER,
          mode: 'equal',
          customAmounts: {},
          note: '',
          createdBy: 'lin',
        },
      }).ok,
    ).toBe(false);
  });

  it('自定义分摊模板：合计必须等于总额', () => {
    const tpl = template({
      mode: 'custom',
      amountCents: 30000,
      customAmounts: { lin: 10000, zhou: 10000, chen: 10000 },
    });
    const okRes = computeTemplateShares(tpl, 30000, ORDER);
    expect(okRes.ok).toBe(true);
    const bad = computeTemplateShares(
      { ...tpl, customAmounts: { lin: 10000, zhou: 10000, chen: 5000 } },
      30000,
      ORDER,
    );
    expect(bad.ok).toBe(false);
  });
});

describe('月度概览', () => {
  const state: AppState = testState({
    expenses: [
      makeExpense({ id: 'm1', amountCents: 30000, payerId: 'lin', date: '2026-03-01' }),
      makeExpense({ id: 'm2', amountCents: 9000, payerId: 'zhou', date: '2026-03-10' }),
      makeExpense({ id: 'm3', amountCents: 5000, payerId: 'lin', date: '2026-04-01' }),
    ],
  });

  it('只汇总所选月份的有效账单', () => {
    const s = buildMonthSummary(state, '2026-03');
    expect(s.expenseCount).toBe(2);
    expect(s.totalCents).toBe(39000);
  });

  it('个人承担包含垫付人自己的份额', () => {
    const s = buildMonthSummary(state, '2026-03');
    const lin = s.members.find((m) => m.memberId === 'lin')!;
    // m1 小林垫付自己承担 10000；m2 小周垫付，小林承担 3000
    expect(lin.shareCents).toBe(13000);
    expect(lin.paidCents).toBe(30000);
  });

  it('未结清按债务人→垫付人汇总，可追溯原账单', () => {
    const s = buildMonthSummary(state, '2026-03');
    const pair = s.unsettled.find((p) => p.debtorId === 'zhou' && p.creditorId === 'lin')!;
    expect(pair.unpaidCents).toBe(10000);
    expect(pair.items[0].expenseId).toBe('m1');
  });

  it('已标记付款但未确认的金额单列', () => {
    let s2 = testState({
      expenses: [makeExpense({ id: 'p1', amountCents: 30000, payerId: 'lin', date: '2026-03-01' })],
    });
    s2 = applyAction(s2, {
      type: 'share/markPaid',
      expenseId: 'p1',
      memberId: 'zhou',
      by: 'zhou',
    }).state;
    const s = buildMonthSummary(s2, '2026-03');
    expect(s.awaitingConfirmCents).toBe(10000);
    expect(s.unpaidCents).toBe(10000); // 小陈仍未付款
    const pair = s.unsettled.find((p) => p.debtorId === 'zhou')!;
    expect(pair.awaitingCents).toBe(10000);
    expect(pair.unpaidCents).toBe(0);
  });

  it('作废账单不计入月度总支出', () => {
    let s2 = testState({
      expenses: [
        makeExpense({
          id: 'v1',
          amountCents: 30000,
          payerId: 'lin',
          date: '2026-03-01',
          createdBy: 'lin',
        }),
      ],
    });
    s2 = applyAction(s2, { type: 'expense/void', expenseId: 'v1', by: 'lin' }).state;
    const s = buildMonthSummary(s2, '2026-03');
    expect(s.totalCents).toBe(0);
    expect(s.expenseCount).toBe(0);
    expect(s.voidedCount).toBe(1);
  });

  it('空月份有明确空数据', () => {
    const s = buildMonthSummary(state, '2020-01');
    expect(s.expenseCount).toBe(0);
    expect(s.totalCents).toBe(0);
    expect(s.unsettled).toHaveLength(0);
  });

  it('可用账期包含当前月与有账单的月份', () => {
    const periods = availablePeriods(state.expenses, '2026-05-20');
    expect(periods).toContain('2026-05');
    expect(periods).toContain('2026-04');
    expect(periods[0]).toBe('2026-05');
  });

  it('复制摘要包含总额、分类、未结清与债务人关系', () => {
    const text = monthSummaryText(
      state,
      '2026-03',
      (c) => `¥${(c / 100).toFixed(2)}`,
      (id) => ({ lin: '小林', zhou: '小周', chen: '小陈' })[id] ?? id,
    );
    expect(text).toContain('2026-03');
    expect(text).toContain('总支出');
    expect(text).toContain('小周 → 小林');
    expect(text).toContain('当前结算状态');
  });
});

describe('schema 迁移', () => {
  it('v1 数据升级到当前版本并补齐模板与账期字段', () => {
    const v1 = {
      schemaVersion: 1,
      homeName: '旧数据小窝',
      members: [
        { id: 'lin', name: '小林', initial: '林' },
        { id: 'zhou', name: '小周', initial: '周' },
      ],
      currentMemberId: 'lin',
      expenses: [
        {
          id: 'old-1',
          name: '旧账单',
          amountCents: 5000,
          category: 'other',
          date: '2026-01-05',
          payerId: 'lin',
          participantIds: ['lin', 'zhou'],
          mode: 'equal',
          note: '',
          shares: [
            {
              memberId: 'lin',
              amountCents: 2500,
              paidAt: null,
              confirmedAt: null,
              dispute: null,
            },
            {
              memberId: 'zhou',
              amountCents: 2500,
              paidAt: null,
              confirmedAt: null,
              dispute: null,
            },
          ],
          createdBy: 'lin',
          createdAt: '2026-01-05T00:00:00.000Z',
          voided: false,
          voidedAt: null,
          voidedBy: null,
          linkedRestockId: null,
        },
      ],
      choreRules: [],
      choreTaskState: {},
      choreAssignments: {},
      swapRequests: [],
      supplies: [],
      restocks: [],
      pactVersions: [],
      pactDraft: null,
      seededAt: '2026-01-01T00:00:00.000Z',
    };

    const { state, migrated } = migrate(v1);
    expect(migrated).toBe(true);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.templates).toEqual([]);
    expect(state.expenses[0].id).toBe('old-1');
    expect(state.expenses[0].templateId).toBeNull();
    expect(state.expenses[0].periodKey).toBeNull();
    // 关联与金额保持不变
    expect(state.expenses[0].amountCents).toBe(5000);
    expect(state.homeName).toBe('旧数据小窝');
  });

  it('来自更高版本的数据被拒绝而不是静默覆盖', () => {
    expect(() => migrate({ schemaVersion: SCHEMA_VERSION + 5, members: [] })).toThrow();
  });
});
