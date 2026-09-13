import { describe, expect, it } from 'vitest';
import { backupToJson, checkBackup, parseBackup, buildBackup } from './backup';
import { migrate } from './storage';
import { SCHEMA_VERSION, type AppState } from '../domain/types';
import { testState, makeExpense, ORDER } from '../domain/testFactory';

const MEMBER_IDS = ORDER;

function currentState(): AppState {
  const state = testState();
  return { ...state, expenses: [makeExpense({ id: 'e-0', payerId: 'lin', amountCents: 9000, participantIds: [...ORDER] })] };
}

describe('备份校验', () => {
  it('合法备份通过校验并给出概要', () => {
    const json = backupToJson(currentState());
    const result = checkBackup(json);
    expect(result.ok).toBe(true);
    expect(result.summary?.members).toBe(3);
    expect(result.summary?.expenses).toBe(1);
  });

  it('非 JSON 或非本应用备份被拒绝', () => {
    expect(checkBackup('not json').ok).toBe(false);
    expect(checkBackup(JSON.stringify({ app: 'other-app', state: {} })).ok).toBe(false);
  });

  it('份额合计与总额不一致被拒绝', () => {
    const state = currentState();
    const broken: AppState = {
      ...state,
      expenses: [
        {
          ...state.expenses[0],
          shares: state.expenses[0].shares.map((s) => ({ ...s, amountCents: 1000 })),
        },
      ],
    };
    const result = checkBackup(JSON.stringify(buildBackup(broken)));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('不一致');
  });

  it('负数或非整数金额被拒绝', () => {
    const state = currentState();
    const broken: AppState = {
      ...state,
      expenses: [{ ...state.expenses[0], amountCents: -100 }],
    };
    expect(checkBackup(JSON.stringify(buildBackup(broken))).ok).toBe(false);
  });

  it('日期格式不正确被拒绝', () => {
    const state = currentState();
    const broken: AppState = {
      ...state,
      expenses: [{ ...state.expenses[0], date: '2026/09/12' }],
    };
    expect(checkBackup(JSON.stringify(buildBackup(broken))).ok).toBe(false);
  });

  it('付款人不存在被拒绝', () => {
    const state = currentState();
    const broken: AppState = {
      ...state,
      expenses: [{ ...state.expenses[0], payerId: 'ghost' }],
    };
    const result = checkBackup(JSON.stringify(buildBackup(broken)));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('付款人');
  });

  it('同一补货记录关联多笔有效费用被拒绝', () => {
    const state = currentState();
    const linked: AppState = {
      ...state,
      supplies: [{ id: 'item-1', name: '洗洁精', category: '清洁日用', location: '厨房', unit: '瓶', stock: 1, fullStock: 2, lastRestockedAt: null, claim: null, createdAt: '', createdBy: 'lin', archived: false, archivedAt: null }],
    restocks: [
        {
          id: 'rs-1',
          itemId: 'item-1',
          itemName: '洗洁精',
          expenseId: null,
          memberId: 'lin' as const,
          completedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      expenses: [
        { ...makeExpense({ id: 'e-1', payerId: 'lin', amountCents: 1000, participantIds: [...ORDER] }), linkedRestockId: 'rs-1' },
        { ...makeExpense({ id: 'e-2', payerId: 'lin', amountCents: 2000, participantIds: [...ORDER] }), linkedRestockId: 'rs-1' },
      ],
    };
    const result = checkBackup(JSON.stringify(buildBackup(linked)));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('多笔有效费用');
  });

  it('作废账单的关联不占用有效名额，可重新补记', () => {
    const state = currentState();
    const voidedThenNew: AppState = {
      ...state,
      restocks: [
        {
          id: 'rs-1',
          itemId: 'item-1',
          itemName: '洗洁精',
          expenseId: null,
          memberId: 'lin' as const,
          completedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      expenses: [
        {
          ...makeExpense({ id: 'e-1', payerId: 'lin', amountCents: 1000, participantIds: [...ORDER] }),
          id: 'e-1',
          linkedRestockId: 'rs-1',
          voided: true,
        },
        { ...makeExpense({ id: 'e-2', payerId: 'lin', amountCents: 2000, participantIds: [...ORDER] }), linkedRestockId: 'rs-1' },
      ],
    };
    expect(checkBackup(JSON.stringify(buildBackup(voidedThenNew))).ok).toBe(true);
  });

  it('更高 schema 版本被拒绝', () => {
    const state = currentState();
    const future = { ...buildBackup(state), schemaVersion: SCHEMA_VERSION + 1 };
    const result = checkBackup(JSON.stringify(future));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('更新版本');
  });

  it('校验通过后 parseBackup 返回可用状态', () => {
    const json = backupToJson(currentState());
    const state = parseBackup(json);
    expect(state.expenses).toHaveLength(1);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('schema 迁移链（旧数据兼容）', () => {
  it('v1 数据迁移到当前版本：补齐模板与关联字段，业务数据保持原样', () => {
    const v1 = {
      schemaVersion: 1,
      homeName: '向阳小窝',
      currentMemberId: 'lin',
      members: MEMBER_IDS.map((id, i) => ({ id, name: `成员${i}`, initial: 'A' })),
      expenses: [
        {
          id: 'e-1',
          name: '房租',
          category: 'rent',
          date: '2026-09-01',
          amountCents: 9000,
          payerId: 'lin',
          participantIds: ['lin', 'zhou', 'chen'],
          note: '',
          createdAt: '2026-09-01T00:00:00.000Z',
          createdBy: 'lin',
          shares: [
            { memberId: 'lin', amountCents: 3000, paidAt: null, confirmedAt: null, dispute: null, disputeLog: [] },
            { memberId: 'zhou', amountCents: 3000, paidAt: null, confirmedAt: null, dispute: null, disputeLog: [] },
            { memberId: 'chen', amountCents: 3000, paidAt: null, confirmedAt: null, dispute: null, disputeLog: [] },
          ],
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
    };
    const { state, migrated } = migrate(v1);
    expect(migrated).toBe(true);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.templates).toEqual([]);
    expect(state.expenses[0].templateId).toBeNull();
    expect(state.expenses[0].amountCents).toBe(9000);
    // 值日规则迁移生成初始版本
    expect(state.choreRules).toEqual([]);
  });

  it('v2 数据迁移：规则生成初始版本、物品补归档字段、换班补 reason', () => {
    const v2 = {
      schemaVersion: 2,
      homeName: '向阳小窝',
      currentMemberId: 'lin',
      members: MEMBER_IDS.map((id, i) => ({ id, name: `成员${i}`, initial: 'A' })),
      expenses: [],
      templates: [],
      choreRules: [
        {
          id: 'rule-1',
          area: '客厅',
          standard: '无杂物',
          weekdays: [1],
          memberOrder: ['lin', 'zhou', 'chen'],
          startDate: '2026-09-07',
          createdBy: 'lin',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      choreTaskState: {},
      choreAssignments: {},
      swapRequests: [{ id: 's-1', fromTaskKey: 'rule-1|2026-09-14', toTaskKey: 'rule-1|2026-09-16', fromMemberId: 'lin', toMemberId: 'zhou', status: 'pending', createdAt: '', resolvedAt: null }],
      supplies: [
        {
          id: 'item-1',
          name: '洗洁精',
          category: '清洁日用',
          location: '厨房',
          unit: '瓶',
          stock: 1,
          fullStock: 2,
          lastRestockedAt: null,
          claim: null,
          createdAt: '',
          createdBy: 'lin',
        },
      ],
      restocks: [],
      pactVersions: [],
      pactDraft: null,
    };
    const { state, migrated } = migrate(v2);
    expect(migrated).toBe(true);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    // 规则迁移生成与原字段一致的初始版本，历史排班不变
    expect(state.choreRules[0].versions).toHaveLength(1);
    expect(state.choreRules[0].versions![0].weekdays).toEqual([1]);
    expect(state.choreRules[0].versions![0].memberOrder).toEqual(['lin', 'zhou', 'chen']);
    expect(state.choreRules[0].pauses).toEqual([]);
    expect(state.supplies[0].archived).toBe(false);
    expect(state.swapRequests[0].reason).toBeNull();
  });

  it('当前版本数据原样通过（无迁移）', () => {
    const state = currentState();
    const { migrated } = migrate(buildBackup(state).state);
    expect(migrated).toBe(false);
  });
});
