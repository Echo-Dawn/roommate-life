import { addDays, compareKeys, diffDays, todayKey, weekdayOf } from './dateKey';
import type {
  ChoreRule,
  ChoreTask,
  ChoreTaskState,
  MemberId,
  SwapRequest,
} from './types';

/**
 * 值日轮换。
 * 负责人由「起始日期 → 该日期之间实际发生的排班次数」决定，
 * 与用户正在浏览哪一周无关，因此前后翻周不会改变结果。
 */

const MAX_LOOKBACK_DAYS = 3660;

export function taskKey(ruleId: string, date: string): string {
  return `${ruleId}|${date}`;
}

export function parseTaskKey(key: string): { ruleId: string; date: string } | null {
  const idx = key.indexOf('|');
  if (idx <= 0) return null;
  return { ruleId: key.slice(0, idx), date: key.slice(idx + 1) };
}

export function isScheduled(rule: ChoreRule, date: string): boolean {
  if (compareKeys(date, rule.startDate) < 0) return false;
  return rule.weekdays.includes(weekdayOf(date));
}

/** 从起始日期到该日（含）为止，第几次发生；未排班返回 -1 */
export function occurrenceIndex(rule: ChoreRule, date: string): number {
  if (!isScheduled(rule, date)) return -1;
  const span = diffDays(rule.startDate, date);
  if (span < 0) return -1;
  let count = 0;
  for (let i = 0; i <= span && i <= MAX_LOOKBACK_DAYS; i += 1) {
    const day = addDays(rule.startDate, i);
    if (rule.weekdays.includes(weekdayOf(day))) count += 1;
  }
  return count - 1;
}

export function rotationOwner(rule: ChoreRule, date: string): MemberId | null {
  if (rule.memberOrder.length === 0) return null;
  const index = occurrenceIndex(rule, date);
  if (index < 0) return null;
  return rule.memberOrder[index % rule.memberOrder.length];
}

export function pendingSwapIdFor(
  swaps: SwapRequest[],
  key: string,
): string | null {
  const hit = swaps.find(
    (s) => s.status === 'pending' && (s.fromTaskKey === key || s.toTaskKey === key),
  );
  return hit ? hit.id : null;
}

export function buildTask(
  rule: ChoreRule,
  date: string,
  state: Record<string, ChoreTaskState>,
  assignments: Record<string, MemberId>,
  swaps: SwapRequest[],
  today: string,
): ChoreTask | null {
  const rotation = rotationOwner(rule, date);
  if (!rotation) return null;
  const key = taskKey(rule.id, date);
  const override = assignments[key];
  const taskState = state[key] ?? null;
  const status: ChoreTask['status'] = taskState
    ? 'done'
    : compareKeys(date, today) < 0
      ? 'overdue'
      : 'pending';
  return {
    key,
    ruleId: rule.id,
    date,
    area: rule.area,
    standard: rule.standard,
    assigneeId: override ?? rotation,
    rotationOwnerId: rotation,
    swapped: Boolean(override) && override !== rotation,
    status,
    state: taskState,
    pendingSwapId: pendingSwapIdFor(swaps, key),
  };
}

export interface TaskQuery {
  rules: ChoreRule[];
  taskState: Record<string, ChoreTaskState>;
  assignments: Record<string, MemberId>;
  swaps: SwapRequest[];
  today?: string;
}

/** 生成 [from, to] 区间内全部任务（同一规则同一日期最多一个） */
export function buildTasks(query: TaskQuery, from: string, to: string): ChoreTask[] {
  const today = query.today ?? todayKey();
  const tasks: ChoreTask[] = [];
  query.rules.forEach((rule) => {
    let cursor = from;
    const span = diffDays(from, to);
    for (let i = 0; i <= span && i <= MAX_LOOKBACK_DAYS; i += 1) {
      cursor = addDays(from, i);
      const task = buildTask(rule, cursor, query.taskState, query.assignments, query.swaps, today);
      if (task) tasks.push(task);
    }
  });
  return tasks.sort(
    (a, b) => compareKeys(a.date, b.date) || a.ruleId.localeCompare(b.ruleId),
  );
}

export function findTask(query: TaskQuery, key: string): ChoreTask | null {
  const parsed = parseTaskKey(key);
  if (!parsed) return null;
  const rule = query.rules.find((r) => r.id === parsed.ruleId);
  if (!rule) return null;
  const today = query.today ?? todayKey();
  return buildTask(rule, parsed.date, query.taskState, query.assignments, query.swaps, today);
}

export interface SwapCheck {
  ok: boolean;
  error?: string;
}

/** 发起/接受换班前的校验 */
export function checkSwapPair(
  mine: ChoreTask | null,
  theirs: ChoreTask | null,
  myId: MemberId,
): SwapCheck {
  if (!mine || !theirs) return { ok: false, error: '所选任务不存在，可能规则已被删除。' };
  if (mine.assigneeId !== myId) return { ok: false, error: '只能从自己负责的任务发起换班。' };
  if (theirs.assigneeId === myId) return { ok: false, error: '请选择另一位室友负责的任务。' };
  if (mine.status === 'done' || theirs.status === 'done') {
    return { ok: false, error: '已完成的任务不能换班。' };
  }
  if (mine.status === 'overdue' || theirs.status === 'overdue') {
    return { ok: false, error: '已过期的任务不能换班，请先补做。' };
  }
  if (mine.pendingSwapId || theirs.pendingSwapId) {
    return { ok: false, error: '该任务已有待确认的换班申请，请先处理。' };
  }
  return { ok: true };
}
