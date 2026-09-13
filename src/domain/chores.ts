import { addDays, compareKeys, diffDays, todayKey, weekdayOf } from './dateKey';
import type {
  ChorePauseRange,
  ChoreRule,
  ChoreRuleVersion,
  ChoreTask,
  ChoreTaskState,
  MemberId,
  SwapRequest,
} from './types';

/**
 * 值日轮换。
 * - 负责人由「生效版本 + 该版本内实际发生的排班次数」决定，
 *   与用户正在浏览哪一周无关，因此前后翻周不会改变结果。
 * - 规则可以改，但改动以「版本 + 生效日期」记录，
 *   历史任务仍按当时生效的版本和轮换次数计算，不会被重排。
 * - 暂停区间内的日期不生成任务，也不消耗轮换次数。
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

/** 旧数据没有 versions 时，用镜像字段构造初始版本 */
export function legacyVersion(rule: ChoreRule): ChoreRuleVersion {
  return {
    id: `${rule.id}-v0`,
    effectiveFrom: rule.startDate,
    weekdays: [...rule.weekdays],
    memberOrder: [...rule.memberOrder],
    anchorDate: rule.startDate,
    createdBy: rule.createdBy,
    createdAt: rule.createdAt,
    note: '初始版本',
  };
}

export function ruleVersions(rule: ChoreRule): ChoreRuleVersion[] {
  return rule.versions && rule.versions.length > 0 ? rule.versions : [legacyVersion(rule)];
}

/** 某日期生效的版本；日期早于首个版本时返回 null */
export function effectiveVersion(rule: ChoreRule, date: string): ChoreRuleVersion | null {
  const list = [...ruleVersions(rule)].sort((a, b) =>
    compareKeys(a.effectiveFrom, b.effectiveFrom),
  );
  let chosen: ChoreRuleVersion | null = null;
  list.forEach((v) => {
    if (compareKeys(v.effectiveFrom, date) <= 0) chosen = v;
  });
  return chosen;
}

/** 下一个版本的生效日（没有则 null） */
export function nextVersionFrom(rule: ChoreRule): string | null {
  const future = ruleVersions(rule)
    .map((v) => v.effectiveFrom)
    .filter((d) => compareKeys(d, todayKey()) > 0)
    .sort((a, b) => compareKeys(a, b));
  return future[0] ?? null;
}

export function isPaused(rule: ChoreRule, date: string): boolean {
  return (rule.pauses ?? []).some(
    (p: ChorePauseRange) =>
      compareKeys(date, p.from) >= 0 && (p.to === null || compareKeys(date, p.to) <= 0),
  );
}

export function isPausing(rule: ChoreRule): boolean {
  return (rule.pauses ?? []).some((p) => p.to === null);
}

/** 该日期是否有排班（考虑版本生效日与暂停） */
export function isScheduled(rule: ChoreRule, date: string): boolean {
  const version = effectiveVersion(rule, date);
  if (!version) return false;
  if (compareKeys(date, version.anchorDate) < 0) return false;
  if (!version.weekdays.includes(weekdayOf(date))) return false;
  if (isPaused(rule, date)) return false;
  return true;
}

/**
 * 从生效版本的轮换起点到该日（含）为止，第几次实际发生；未排班返回 -1。
 * 暂停与未排班的日期不计数，因此暂停不会打乱轮换顺序。
 */
export function occurrenceIndex(rule: ChoreRule, date: string): number {
  if (!isScheduled(rule, date)) return -1;
  const version = effectiveVersion(rule, date)!;
  const span = diffDays(version.anchorDate, date);
  if (span < 0) return -1;
  let count = 0;
  for (let i = 0; i <= span && i <= MAX_LOOKBACK_DAYS; i += 1) {
    const day = addDays(version.anchorDate, i);
    const inVersion =
      compareKeys(day, version.anchorDate) >= 0 &&
      version.weekdays.includes(weekdayOf(day)) &&
      !isPaused(rule, day);
    if (inVersion) count += 1;
  }
  return count - 1;
}

export function rotationOwner(rule: ChoreRule, date: string): MemberId | null {
  const version = effectiveVersion(rule, date);
  if (!version || version.memberOrder.length === 0) return null;
  const index = occurrenceIndex(rule, date);
  if (index < 0) return null;
  return version.memberOrder[index % version.memberOrder.length];
}

export function pendingSwapIdFor(swaps: SwapRequest[], key: string): string | null {
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
    const span = diffDays(from, to);
    for (let i = 0; i <= span && i <= MAX_LOOKBACK_DAYS; i += 1) {
      const cursor = addDays(from, i);
      const task = buildTask(rule, cursor, query.taskState, query.assignments, query.swaps, today);
      if (task) tasks.push(task);
    }
  });
  return tasks.sort((a, b) => compareKeys(a.date, b.date) || a.ruleId.localeCompare(b.ruleId));
}

export function findTask(query: TaskQuery, key: string): ChoreTask | null {
  const parsed = parseTaskKey(key);
  if (!parsed) return null;
  const rule = query.rules.find((r) => r.id === parsed.ruleId);
  if (!rule) return null;
  const today = query.today ?? todayKey();
  return buildTask(rule, parsed.date, query.taskState, query.assignments, query.swaps, today);
}

/**
 * 规则变更影响预览：从生效日起未来若干天内，哪些未完成任务的负责人会变化、
 * 哪些日期不再排班。历史（生效日前）不受影响。
 */
export interface RuleChangeImpact {
  effectiveFrom: string;
  changed: { date: string; before: MemberId | null; after: MemberId | null }[];
  removedDates: string[];
  affectedPendingSwaps: SwapRequest[];
}

export function previewRuleChange(
  query: TaskQuery,
  rule: ChoreRule,
  next: { effectiveFrom: string; weekdays: number[]; memberOrder: MemberId[] },
  horizonDays = 28,
): RuleChangeImpact {
  const today = query.today ?? todayKey();
  const end = addDays(next.effectiveFrom, horizonDays);
  const changed: RuleChangeImpact['changed'] = [];
  const removedDates: string[] = [];

  const span = diffDays(next.effectiveFrom, end);
  for (let i = 0; i <= span && i <= MAX_LOOKBACK_DAYS; i += 1) {
    const date = addDays(next.effectiveFrom, i);
    const before = buildTask(rule, date, query.taskState, query.assignments, query.swaps, today);
    const simulated: ChoreRule = {
      ...rule,
      versions: [
        ...ruleVersions(rule),
        {
          id: 'preview',
          effectiveFrom: next.effectiveFrom,
          weekdays: next.weekdays,
          memberOrder: next.memberOrder,
          anchorDate: next.effectiveFrom,
          createdBy: rule.createdBy,
          createdAt: today,
          note: '预览',
        },
      ],
    };
    const after = buildTask(simulated, date, query.taskState, query.assignments, query.swaps, today);
    if (!before && !after) continue;
    if (before && !after) {
      removedDates.push(date);
      continue;
    }
    if (!before && after) {
      changed.push({ date, before: null, after: after.assigneeId });
      continue;
    }
    if (before!.assigneeId !== after!.assigneeId) {
      changed.push({ date, before: before!.assigneeId, after: after!.assigneeId });
    }
  }

  const affectedPendingSwaps = (query.swaps ?? []).filter(
    (s) =>
      s.status === 'pending' &&
      (s.fromTaskKey.startsWith(`${rule.id}|`) || s.toTaskKey.startsWith(`${rule.id}|`)) &&
      (s.fromTaskKey.split('|')[1] ?? '') >= next.effectiveFrom,
  );

  return { effectiveFrom: next.effectiveFrom, changed, removedDates, affectedPendingSwaps };
}

/** 待确认但已经不可能完成的换班（任务已过期或不再排班） */
export function isSwapStale(swap: SwapRequest, query: TaskQuery): boolean {
  if (swap.status !== 'pending') return false;
  const from = findTask(query, swap.fromTaskKey);
  const to = findTask(query, swap.toTaskKey);
  if (!from || !to) return true;
  return from.status === 'overdue' || from.status === 'done' || to.status === 'overdue' || to.status === 'done';
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
