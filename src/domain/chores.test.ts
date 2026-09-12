import { describe, expect, it } from 'vitest';
import { addDays, startOfWeek, todayKey } from './dateKey';
import { buildTasks, checkSwapPair, occurrenceIndex, rotationOwner, taskKey, type TaskQuery } from './chores';
import { applyAction } from '../store/reducer';
import { testState, ORDER } from './testFactory';
import type { ChoreRule, ChoreTask } from './types';

const RULE: ChoreRule = {
  id: 'r1',
  area: '客厅与玄关',
  standard: '地面清扫拖净',
  weekdays: [1, 3, 5], // 周一、周三、周五
  memberOrder: ORDER,
  startDate: '2026-09-07', // 周一
  createdBy: 'lin',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function tasksFor(rule: ChoreRule, from: string, to: string, today: string): ChoreTask[] {
  return buildTasks(
    {
      rules: [rule],
      taskState: {},
      assignments: {},
      swaps: [],
      today,
    },
    from,
    to,
  );
}

describe('轮换规则', () => {
  it('按实际排班次数轮换，起始日当天为第一位', () => {
    expect(occurrenceIndex(RULE, '2026-09-07')).toBe(0);
    expect(rotationOwner(RULE, '2026-09-07')).toBe('lin');
    expect(occurrenceIndex(RULE, '2026-09-09')).toBe(1);
    expect(rotationOwner(RULE, '2026-09-09')).toBe('zhou');
    expect(occurrenceIndex(RULE, '2026-09-11')).toBe(2);
    expect(rotationOwner(RULE, '2026-09-11')).toBe('chen');
    expect(rotationOwner(RULE, '2026-09-14')).toBe('lin'); // 第 4 次，回到首位
  });

  it('未排班的日期不产生任务', () => {
    expect(rotationOwner(RULE, '2026-09-08')).toBeNull(); // 周二
    expect(rotationOwner(RULE, '2026-09-06')).toBeNull(); // 起始日之前
  });

  it('浏览不同周不会改变某天的负责人', () => {
    const target = '2026-09-21'; // 两周后的周一
    const fromThisWeek = tasksFor(RULE, '2026-09-07', '2026-09-27', '2026-09-09');
    const fromLaterWeek = tasksFor(RULE, '2026-09-21', '2026-09-21', '2026-09-21');
    const a = fromThisWeek.find((t) => t.date === target);
    const b = fromLaterWeek.find((t) => t.date === target);
    expect(a?.assigneeId).toBe(b?.assigneeId);
    expect(a?.rotationOwnerId).toBe(b?.rotationOwnerId);
  });

  it('同一规则同一日期最多一个任务', () => {
    const tasks = tasksFor(RULE, '2026-09-07', '2026-09-27', '2026-09-09');
    const keys = tasks.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(taskKey('r1', '2026-09-07'));
  });

  it('过期任务保留原负责人，不自动转给下一人', () => {
    const tasks = tasksFor(RULE, '2026-09-07', '2026-09-13', '2026-09-14');
    const overdue = tasks.filter((t) => t.status === 'overdue');
    expect(overdue.length).toBe(3);
    overdue.forEach((t) => {
      expect(t.assigneeId).toBe(t.rotationOwnerId);
    });
    expect(overdue.map((t) => t.date)).toEqual(['2026-09-07', '2026-09-09', '2026-09-11']);
  });
});

describe('换班', () => {
  // reducer 内部以「真实今天」判断过期，这里同样使用真实今天，保持与实现一致
  const today = todayKey();
  const LIVE_RULE: ChoreRule = { ...RULE, startDate: addDays(startOfWeek(today), -7) };

  function upcoming(query: TaskQuery, from = today, to = addDays(today, 28)): ChoreTask[] {
    return buildTasks(query, from, to);
  }

  function pendingPair(state: ReturnType<typeof testState>) {
    const tasks = upcoming({
      rules: state.choreRules,
      taskState: state.choreTaskState,
      assignments: state.choreAssignments,
      swaps: state.swapRequests,
      today,
    });
    const mine = tasks.find((t) => t.assigneeId === 'lin' && t.status === 'pending')!;
    const theirs = tasks.find((t) => t.assigneeId === 'zhou' && t.status === 'pending')!;
    return { mine, theirs };
  }

  it('只有自己的未完成任务可以发起，且目标不能是过期任务', () => {
    const base = testState({ choreRules: [LIVE_RULE] });
    const { mine, theirs } = pendingPair(base);
    const overdue = { ...theirs, status: 'overdue' as const };
    expect(checkSwapPair(mine, overdue, 'lin').ok).toBe(false);
    expect(checkSwapPair(mine, null, 'lin').ok).toBe(false);
    expect(checkSwapPair(mine, theirs, 'chen').ok).toBe(false);
    expect(checkSwapPair(mine, theirs, 'lin').ok).toBe(true);
  });

  it('接受后两项任务负责人原子交换，且不能重复接受', () => {
    const base = testState({ choreRules: [LIVE_RULE] });
    const { mine, theirs } = pendingPair(base);

    const requested = applyAction(base, {
      type: 'swap/request',
      fromTaskKey: mine.key,
      toTaskKey: theirs.key,
      by: 'lin',
    });
    expect(requested.ok).toBe(true);
    const swapId = requested.state.swapRequests[0].id;

    // 接受前原任务负责人不变
    const before = pendingPair(requested.state);
    expect(before.mine.assigneeId).toBe('lin');
    expect(before.theirs.assigneeId).toBe('zhou');

    const accepted = applyAction(requested.state, { type: 'swap/accept', swapId, by: 'zhou' });
    expect(accepted.ok).toBe(true);
    expect(accepted.state.choreAssignments[mine.key]).toBe('zhou');
    expect(accepted.state.choreAssignments[theirs.key]).toBe('lin');

    const after = upcoming({
      rules: accepted.state.choreRules,
      taskState: accepted.state.choreTaskState,
      assignments: accepted.state.choreAssignments,
      swaps: accepted.state.swapRequests,
      today,
    });
    expect(after.find((t) => t.key === mine.key)!.assigneeId).toBe('zhou');
    expect(after.find((t) => t.key === theirs.key)!.assigneeId).toBe('lin');

    // 重复接受被拒绝，状态不变
    const again = applyAction(accepted.state, { type: 'swap/accept', swapId, by: 'zhou' });
    expect(again.ok).toBe(false);
    expect(again.state).toBe(accepted.state);
  });

  it('非被邀请人不能接受，拒绝或撤销后负责人不变', () => {
    const base = testState({ choreRules: [LIVE_RULE] });
    const { mine, theirs } = pendingPair(base);
    const requested = applyAction(base, {
      type: 'swap/request',
      fromTaskKey: mine.key,
      toTaskKey: theirs.key,
      by: 'lin',
    });
    const swapId = requested.state.swapRequests[0].id;

    const wrong = applyAction(requested.state, { type: 'swap/accept', swapId, by: 'chen' });
    expect(wrong.ok).toBe(false);
    expect(wrong.state.choreAssignments).toEqual({});

    const rejected = applyAction(requested.state, { type: 'swap/reject', swapId, by: 'zhou' });
    expect(rejected.ok).toBe(true);
    expect(rejected.state.choreAssignments).toEqual({});

    const cancelled = applyAction(requested.state, { type: 'swap/cancel', swapId, by: 'lin' });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.choreAssignments).toEqual({});
    expect(cancelled.state.swapRequests[0].status).toBe('cancelled');
  });

  it('接受时若目标任务已完成则交换失败', () => {
    const base = testState({ choreRules: [LIVE_RULE] });
    const { mine, theirs } = pendingPair(base);
    const requested = applyAction(base, {
      type: 'swap/request',
      fromTaskKey: mine.key,
      toTaskKey: theirs.key,
      by: 'lin',
    });
    const swapId = requested.state.swapRequests[0].id;
    const completed = applyAction(requested.state, {
      type: 'chore/complete',
      key: theirs.key,
      by: 'zhou',
      note: '',
    });
    expect(completed.ok).toBe(true);
    const after = applyAction(completed.state, { type: 'swap/accept', swapId, by: 'zhou' });
    expect(after.ok).toBe(false);
    expect(after.state.choreAssignments).toEqual({});
  });

  it('已参与待确认换班的任务不能再发起新的换班', () => {
    const base = testState({ choreRules: [LIVE_RULE] });
    const { mine, theirs } = pendingPair(base);
    const requested = applyAction(base, {
      type: 'swap/request',
      fromTaskKey: mine.key,
      toTaskKey: theirs.key,
      by: 'lin',
    });
    const withPending = requested.state;
    const tasks = upcoming({
      rules: withPending.choreRules,
      taskState: withPending.choreTaskState,
      assignments: withPending.choreAssignments,
      swaps: withPending.swapRequests,
      today,
    });
    const mineNow = tasks.find((t) => t.key === mine.key)!;
    expect(mineNow.pendingSwapId).toBeTruthy();
    const other = tasks.find((t) => t.assigneeId === 'chen' && t.status === 'pending')!;
    const result = applyAction(withPending, {
      type: 'swap/request',
      fromTaskKey: mineNow.key,
      toTaskKey: other.key,
      by: 'lin',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('待确认');
  });
});

describe('完成任务', () => {
  const today = todayKey();
  const LIVE_RULE: ChoreRule = { ...RULE, startDate: addDays(startOfWeek(today), -7) };

  it('只有负责人能完成，重复完成被拒绝', () => {
    const base = testState({ choreRules: [LIVE_RULE] });
    const tasks = buildTasks(
      {
        rules: base.choreRules,
        taskState: base.choreTaskState,
        assignments: base.choreAssignments,
        swaps: base.swapRequests,
        today,
      },
      today,
      addDays(today, 28),
    );
    const mine = tasks.find((t) => t.assigneeId === 'lin')!;
    const wrong = applyAction(base, { type: 'chore/complete', key: mine.key, by: 'zhou', note: '' });
    expect(wrong.ok).toBe(false);

    const done = applyAction(base, { type: 'chore/complete', key: mine.key, by: 'lin', note: 'ok' });
    expect(done.ok).toBe(true);
    const again = applyAction(done.state, {
      type: 'chore/complete',
      key: mine.key,
      by: 'lin',
      note: '',
    });
    expect(again.ok).toBe(false);
    expect(again.state).toBe(done.state);
  });
});
