import { describe, expect, it } from 'vitest';
import { migrate } from './storage';
import { createSeedState } from '../domain/seed';
import { SCHEMA_VERSION } from '../domain/types';
import { summarizeFor } from '../domain/expenses';
import { buildTasks } from '../domain/chores';
import { activeVersion, pendingVersion } from '../domain/pact';
import { startOfWeek, todayKey, addDays } from '../domain/dateKey';

describe('数据迁移', () => {
  it('当前版本数据原样通过', () => {
    const seed = createSeedState();
    const { state, migrated } = migrate(JSON.parse(JSON.stringify(seed)));
    expect(migrated).toBe(false);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('缺少 schemaVersion 的早期数据会被补齐', () => {
    const seed = createSeedState() as unknown as Record<string, unknown>;
    delete seed.schemaVersion;
    const { state, migrated } = migrate(seed);
    expect(migrated).toBe(true);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('来自更新版本的数据明确报错，不静默丢弃', () => {
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/更新版本/);
  });

  it('结构不完整的数据明确报错', () => {
    expect(() => migrate({ schemaVersion: 1 })).toThrow();
    expect(() => migrate('not-an-object')).toThrow();
  });
});

describe('示例数据', () => {
  const today = todayKey();
  const seed = createSeedState(today);

  it('包含三位虚构室友与向阳小窝', () => {
    expect(seed.homeName).toBe('向阳小窝');
    expect(seed.members.map((m) => m.name)).toEqual(['小林', '小周', '小陈']);
  });

  it('每笔账单的份额合计等于总额', () => {
    seed.expenses.forEach((expense) => {
      expect(expense.shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(expense.amountCents);
    });
  });

  it('覆盖待付款、待收款确认与已结清三种结算状态', () => {
    const statuses = new Set<string>();
    seed.expenses.forEach((expense) =>
      expense.shares.forEach((share) => {
        if (share.memberId === expense.payerId) return;
        if (share.confirmedAt) statuses.add('settled');
        else if (share.paidAt) statuses.add('awaiting_confirm');
        else statuses.add('unpaid');
      }),
    );
    expect(statuses).toContain('unpaid');
    expect(statuses).toContain('awaiting_confirm');
    expect(statuses).toContain('settled');
  });

  it('示例日期基于初始化当天，本周有值日且存在待补做任务', () => {
    const weekStart = startOfWeek(today);
    const tasks = buildTasks(
      {
        rules: seed.choreRules,
        taskState: seed.choreTaskState,
        assignments: seed.choreAssignments,
        swaps: seed.swapRequests,
        today,
      },
      addDays(weekStart, -7),
      addDays(weekStart, 6),
    );
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t) => t.status === 'overdue')).toBe(true);
  });

  it('覆盖充足、快用完、已用完三种物品状态', () => {
    const statuses = new Set(seed.supplies.map((item) => (item.stock <= 0 ? 'out' : item.stock <= 2 ? 'low' : 'ok')));
    expect(statuses).toContain('ok');
    expect(statuses).toContain('low');
    expect(statuses).toContain('out');
  });

  it('包含一份生效公约和一份待确认公约', () => {
    expect(activeVersion(seed)).not.toBeNull();
    expect(pendingVersion(seed)).not.toBeNull();
  });

  it('切换身份后汇总随之变化', () => {
    const lin = summarizeFor(seed, 'lin');
    const zhou = summarizeFor(seed, 'zhou');
    expect(lin.payableCents).not.toBe(zhou.payableCents);
    expect(zhou.payableCents).toBeGreaterThan(0);
  });
});
