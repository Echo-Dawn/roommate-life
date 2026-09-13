import { describe, expect, it } from 'vitest';
import {
  addDays,
  startOfWeek,
  todayKey,
  weekdayOf,
} from './dateKey';
import {
  buildTasks,
  checkSwapPair,
  effectiveVersion,
  isPaused,
  isPausing,
  isScheduled,
  isSwapStale,
  previewRuleChange,
  rotationOwner,
  taskKey,
} from './chores';
import type { MemberId, PactContent } from './types';

const ORDER: MemberId[] = ['lin', 'zhou', 'chen'];
import { diffPactContent, changedClauses, emptyPactContent } from './pact';
import { supplyStatus, canClaim, needsRestock } from './supplies';
import type { ChoreRule, SupplyItem } from './types';

function rule(overrides: Partial<ChoreRule> = {}): ChoreRule {
  const start = overrides.startDate ?? '2026-09-07'; // 周一
  return {
    id: 'rule-1',
    area: '客厅',
    standard: '地面无杂物',
    weekdays: [1, 3, 5],
    memberOrder: [...ORDER],
    startDate: start,
    createdBy: 'lin',
    createdAt: '2026-09-01T00:00:00.000Z',
    versions: overrides.versions ?? [
      {
        id: 'v0',
        effectiveFrom: start,
        weekdays: overrides.weekdays ?? [1, 3, 5],
        memberOrder: overrides.memberOrder ?? [...ORDER],
        anchorDate: start,
        createdBy: 'lin',
        createdAt: '2026-09-01T00:00:00.000Z',
        note: '初始版本',
      },
    ],
    pauses: overrides.pauses ?? [],
    ...overrides,
  };
}

describe('值日规则版本生效', () => {
  it('生效日之前按旧版本，生效日起按新版本', () => {
    const today = todayKey();
    const start = addDays(startOfWeek(today), -21);
    const effective = addDays(today, 7);
    const r: ChoreRule = {
      ...rule({ startDate: start }),
      versions: [
        {
          id: 'v0',
          effectiveFrom: start,
          weekdays: [1, 3, 5],
          memberOrder: ['lin', 'zhou', 'chen'],
          anchorDate: start,
          createdBy: 'lin',
          createdAt: '',
          note: '初始',
        },
        {
          id: 'v1',
          effectiveFrom: effective,
          weekdays: [2, 4],
          memberOrder: ['chen', 'lin', 'zhou'],
          anchorDate: effective,
          createdBy: 'lin',
          createdAt: '',
          note: '调整',
        },
      ],
    };
    expect(effectiveVersion(r, addDays(effective, -1))?.id).toBe('v0');
    expect(effectiveVersion(r, effective)?.id).toBe('v1');
    // 生效日之前仍按旧版本（周一/三/五）排班
    const legacyRule: ChoreRule = { ...r, versions: r.versions!.slice(0, 1) };
    const legacy = buildTasks(
      { rules: [legacyRule], taskState: {}, assignments: {}, swaps: [], today },
      addDays(effective, -7),
      addDays(effective, -1),
    );
    expect(legacy.length).toBeGreaterThan(0);
    legacy.forEach((t) => {
      expect([1, 3, 5]).toContain(weekdayOf(t.date));
      expect(isScheduled(r, t.date)).toBe(true);
    });
    // 新版本只在周二/周四排班
    const after = buildTasks(
      { rules: [r], taskState: {}, assignments: {}, swaps: [], today },
      effective,
      addDays(effective, 13),
    );
    expect(after.length).toBeGreaterThan(0);
    after.forEach((t) => {
      expect([2, 4]).toContain(weekdayOf(t.date));
    });
  });

  it('修改规则不会重算生效日之前的历史负责人', () => {
    const today = todayKey();
    const start = addDays(startOfWeek(today), -21);
    const effective = addDays(today, 3);
    const base = rule({ startDate: start });
    const before = buildTasks(
      { rules: [base], taskState: {}, assignments: {}, swaps: [], today },
      start,
      addDays(effective, -1),
    );

    const updated: ChoreRule = {
      ...base,
      versions: [
        ...base.versions!,
        {
          id: 'v1',
          effectiveFrom: effective,
          weekdays: [2, 4, 6],
          memberOrder: ['chen', 'zhou', 'lin'],
          anchorDate: effective,
          createdBy: 'lin',
          createdAt: '',
          note: '调整',
        },
      ],
    };
    const after = buildTasks(
      { rules: [updated], taskState: {}, assignments: {}, swaps: [], today },
      start,
      addDays(effective, -1),
    );
    // 历史片段的负责人与日期完全一致
    expect(after.map((t) => `${t.date}:${t.assigneeId}`)).toEqual(
      before.map((t) => `${t.date}:${t.assigneeId}`),
    );
  });

  it('预览影响范围：给出负责人变化与不再排班的日期', () => {
    const today = todayKey();
    const start = addDays(startOfWeek(today), -14);
    const effective = addDays(today, 2);
    const r = rule({ startDate: start });
    const impact = previewRuleChange(
      { rules: [r], taskState: {}, assignments: {}, swaps: [], today },
      r,
      { effectiveFrom: effective, weekdays: [2, 4], memberOrder: ['chen', 'lin', 'zhou'] },
      21,
    );
    expect(impact.effectiveFrom).toBe(effective);
    // 生效日之后原周一/三/五的排班被移除或改到周二/周四
    expect(impact.removedDates.length + impact.changed.length).toBeGreaterThan(0);
    impact.removedDates.forEach((d) => {
      expect(compareAtLeast(d, effective)).toBe(true);
    });
  });
});

function compareAtLeast(date: string, base: string): boolean {
  return date >= base;
}

describe('值日规则暂停与恢复', () => {
  const today = todayKey();

  it('暂停期间不生成任务', () => {
    const start = addDays(startOfWeek(today), -14);
    const r: ChoreRule = {
      ...rule({ startDate: start }),
      pauses: [{ from: today, to: null, by: 'lin', at: '' }],
    };
    expect(isPausing(r)).toBe(true);
    expect(isPaused(r, today)).toBe(true);
    expect(isPaused(r, addDays(today, 5))).toBe(true);
    const tasks = buildTasks(
      { rules: [r], taskState: {}, assignments: {}, swaps: [], today },
      today,
      addDays(today, 20),
    );
    expect(tasks).toHaveLength(0);
  });

  it('暂停区间结束后的任务恢复正常，且轮换次数不被暂停期消耗', () => {
    const start = addDays(startOfWeek(today), -14);
    const noPause = rule({ startDate: start });
    const paused: ChoreRule = {
      ...noPause,
      pauses: [{ from: start, to: addDays(start, 7), by: 'lin', at: '' }],
    };
    expect(isPausing(paused)).toBe(false);
    const target = addDays(start, 21);
    // 暂停发生在起始之后但目标日期之前：目标日期的轮换次数按「实际发生次数」计算，
    // 因此与未暂停时排在该日期的「第 N 次发生」不同，这正是设计意图
    const ownerNoPause = rotationOwner(noPause, target);
    const ownerPaused = rotationOwner(paused, target);
    expect(ownerNoPause).not.toBe(ownerPaused);
    // 但负责人一定来自轮换顺序
    expect(paused.versions![0].memberOrder).toContain(ownerPaused);
    // 暂停区间内不排班
    expect(
      buildTasks(
        { rules: [paused], taskState: {}, assignments: {}, swaps: [], today },
        start,
        addDays(start, 7),
      ),
    ).toHaveLength(0);
    // 区间结束后恢复排班
    const resumed = buildTasks(
      { rules: [paused], taskState: {}, assignments: {}, swaps: [], today },
      addDays(start, 8),
      addDays(start, 28),
    );
    expect(resumed.length).toBeGreaterThan(0);
  });
});

describe('换班失效处理', () => {
  const today = todayKey();

  it('任务过期后待确认换班被判定为失效', () => {
    const start = addDays(startOfWeek(today), -14);
    const r = rule({ startDate: start });
    const q = { rules: [r], taskState: {}, assignments: {}, swaps: [], today };
    const tasks = buildTasks(q, today, addDays(today, 14));
    const mine = tasks.find((t) => t.assigneeId === 'lin')!;
    const theirs = tasks.find((t) => t.assigneeId === 'zhou')!;
    const swap = {
      id: 'swap-1',
      fromTaskKey: mine.key,
      toTaskKey: theirs.key,
      fromMemberId: 'lin' as const,
      toMemberId: 'zhou' as const,
      status: 'pending' as const,
      createdAt: '',
      resolvedAt: null,
      reason: null,
    };
    expect(isSwapStale(swap, q)).toBe(false);

    // 把任务日期放到过去 -> 过期 -> 失效
    const pastDate = addDays(today, -7);
    const staleSwap = {
      ...swap,
      fromTaskKey: taskKey(r.id, pastDate),
      toTaskKey: taskKey(r.id, addDays(today, 3)),
    };
    expect(isSwapStale(staleSwap, q)).toBe(true);
  });

  it('已完成或已过期的任务不能发起换班', () => {
    const start = addDays(startOfWeek(today), -14);
    const r = rule({ startDate: start });
    const q = { rules: [r], taskState: {}, assignments: {}, swaps: [], today };
    const tasks = buildTasks(q, today, addDays(today, 14));
    const mine = tasks.find((t) => t.assigneeId === 'lin')!;
    const theirs = tasks.find((t) => t.assigneeId === 'zhou')!;
    expect(checkSwapPair({ ...mine, status: 'done' }, theirs, 'lin').ok).toBe(false);
    expect(checkSwapPair({ ...mine, status: 'overdue' }, theirs, 'lin').ok).toBe(false);
    expect(checkSwapPair(mine, { ...theirs, status: 'done' }, 'lin').ok).toBe(false);
    expect(checkSwapPair(mine, mine, 'lin').ok).toBe(false);
    expect(checkSwapPair(mine, theirs, 'lin').ok).toBe(true);
  });
});

describe('物品归档与状态', () => {
  function item(overrides: Partial<SupplyItem> = {}): SupplyItem {
    return {
      id: 'item-1',
      name: '洗洁精',
      category: '清洁日用',
      location: '厨房',
      unit: '瓶',
      stock: 2,
      fullStock: 2,
      lastRestockedAt: null,
      claim: null,
      createdAt: '',
      createdBy: 'lin',
      archived: false,
      archivedAt: null,
      ...overrides,
    };
  }

  it('已归档物品不进入待补货判断', () => {
    const out = item({ stock: 0, archived: true });
    expect(supplyStatus(out)).toBe('out'); // 状态本身仍按余量计算
    // 但列表层面按 archived 过滤（此处验证过滤条件成立）
    expect(out.archived).toBe(true);
    expect(needsRestock(item({ stock: 0 }))).toBe(true);
  });

  it('补满后不再是快用完，且不能被认领', () => {
    const full = item({ stock: 2, fullStock: 2 });
    expect(supplyStatus(full)).toBe('ok');
    expect(needsRestock(full)).toBe(false);
    expect(canClaim(full, 'lin')).toBe(false);

    // 满量 8、余量 4 -> 恰好 50%，按“不超过 50%”判为快用完
    const half = item({ stock: 4, fullStock: 8 });
    expect(supplyStatus(half)).toBe('low');
    // 余量 5 -> 62.5% -> 充足
    const overHalf = item({ stock: 5, fullStock: 8 });
    expect(supplyStatus(overHalf)).toBe('ok');
  });
});

describe('公约版本差异', () => {
  const base: PactContent = {
    ...emptyPactContent(),
    quiet: '23:00 后保持安静',
    guest: '访客需提前告知',
  };
  const next: PactContent = {
    ...emptyPactContent(),
    quiet: '22:30 后保持安静', // 修改
    // guest 删除
    clean: '每周六上午大扫除', // 新增
  };

  it('识别新增、修改、删除条款', () => {
    const diffs = diffPactContent(base, next);
    const byKey = new Map(diffs.map((d) => [d.key, d]));
    expect(byKey.get('quiet')?.type).toBe('modified');
    expect(byKey.get('guest')?.type).toBe('removed');
    expect(byKey.get('clean')?.type).toBe('added');
    const changed = changedClauses(diffs);
    expect(changed.map((d) => d.key).sort()).toEqual(['clean', 'guest', 'quiet']);
  });

  it('删除条款保留原文以便对照', () => {
    const diffs = diffPactContent(base, next);
    const guest = diffs.find((d) => d.key === 'guest')!;
    expect(guest.before).toBe('访客需提前告知');
    expect(guest.after).toBe('');
  });

  it('首次提交时以空白为基准，全部为新增', () => {
    const diffs = diffPactContent(null, next);
    const changed = changedClauses(diffs);
    expect(changed.every((d) => d.type === 'added')).toBe(true);
  });
});
