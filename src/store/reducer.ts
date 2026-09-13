import { nowISO, todayKey, addDays, compareKeys } from '../domain/dateKey';
import { checkCustomSplit, splitEqually, stableSort } from '../domain/split';
import { buildShareView, canVoidExpense } from '../domain/expenses';
import {
  checkSwapPair,
  findTask,
  isPausing,
  isSwapStale,
  ruleVersions,
  taskKey,
  type TaskQuery,
} from '../domain/chores';
import { activeVersion, hasContent, isFullyConfirmed, pendingVersion } from '../domain/pact';
import { computeTemplateShares, periodKeyOf, previewTemplate } from '../domain/templates';
import {
  SCHEMA_VERSION,
  type AppState,
  type ChoreRule,
  type Expense,
  type ExpenseCategory,
  type ExpenseTemplate,
  type MemberId,
  type PactContent,
  type SplitMode,
  type SupplyItem,
  type SwapRequest,
} from '../domain/types';
import { createSeedState } from '../domain/seed';

/* ------------------------------- Action 定义 ------------------------------- */

export interface ExpenseDraftInput {
  name: string;
  amountCents: number;
  category: ExpenseCategory;
  date: string;
  payerId: MemberId;
  participantIds: MemberId[];
  mode: SplitMode;
  customAmounts: Record<MemberId, number>;
  note: string;
  createdBy: MemberId;
  linkedRestockId?: string | null;
}

export interface ChoreRuleInput {
  area: string;
  standard: string;
  weekdays: number[];
  memberOrder: MemberId[];
  startDate: string;
  createdBy: MemberId;
}

export interface SupplyInput {
  name: string;
  category: string;
  location: string;
  stock: number;
  fullStock: number;
  unit: string;
  createdBy: MemberId;
}

export interface TemplateInput {
  name: string;
  category: ExpenseCategory;
  dayOfMonth: number;
  /** null 表示每期手填 */
  amountCents: number | null;
  payerId: MemberId;
  participantIds: MemberId[];
  mode: SplitMode;
  customAmounts: Record<MemberId, number>;
  note: string;
  createdBy: MemberId;
}

export type Action =
  | { type: 'identity/set'; memberId: MemberId }
  | { type: 'expense/add'; input: ExpenseDraftInput }
  | { type: 'expense/void'; expenseId: string; by: MemberId }
  | { type: 'template/add'; input: TemplateInput }
  | {
      type: 'template/update';
      templateId: string;
      patch: Partial<TemplateInput>;
    }
  | { type: 'template/toggle'; templateId: string; active: boolean }
  | { type: 'template/generate'; templateId: string; month: string; amountCents: number | null }
  | { type: 'share/markPaid'; expenseId: string; memberId: MemberId; by: MemberId }
  | { type: 'share/confirm'; expenseId: string; memberId: MemberId; by: MemberId }
  | { type: 'share/dispute'; expenseId: string; memberId: MemberId; by: MemberId; reason: string }
  | { type: 'share/withdrawDispute'; expenseId: string; memberId: MemberId; by: MemberId }
  | { type: 'chore/addRule'; input: ChoreRuleInput }
  | { type: 'chore/complete'; key: string; by: MemberId; note: string }
  | {
      type: 'chore/updateRule';
      ruleId: string;
      effectiveFrom: string;
      weekdays: number[];
      memberOrder: MemberId[];
      standard?: string;
      note?: string;
      by: MemberId;
    }
  | { type: 'chore/pause'; ruleId: string; from: string | null; by: MemberId }
  | { type: 'chore/resume'; ruleId: string; to: string | null; by: MemberId }
  | { type: 'chore/cleanupSwaps' }
  | { type: 'supply/archive'; itemId: string; by: MemberId }
  | { type: 'supply/unarchive'; itemId: string }
  | {
      type: 'supply/update';
      itemId: string;
      patch: Partial<Pick<SupplyItem, 'name' | 'category' | 'location' | 'unit' | 'stock' | 'fullStock'>>;
    }
  | { type: 'swap/request'; fromTaskKey: string; toTaskKey: string; by: MemberId }
  | { type: 'swap/accept'; swapId: string; by: MemberId }
  | { type: 'swap/reject'; swapId: string; by: MemberId }
  | { type: 'swap/cancel'; swapId: string; by: MemberId }
  | { type: 'supply/add'; input: SupplyInput }
  | { type: 'supply/setStock'; itemId: string; stock: number }
  | { type: 'supply/claim'; itemId: string; by: MemberId }
  | { type: 'supply/unclaim'; itemId: string; by: MemberId }
  | { type: 'supply/completeRestock'; itemId: string; by: MemberId }
  | { type: 'pact/saveDraft'; content: PactContent }
  | { type: 'pact/submit'; by: MemberId }
  | { type: 'pact/confirm'; versionId: string; by: MemberId }
  | { type: 'pact/withdraw'; versionId: string; by: MemberId };

/* -------------------------------- 工具函数 ------------------------------- */

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}

function fail(state: AppState, error: string): ActionResult {
  return { state, ok: false, error };
}

function ok(state: AppState): ActionResult {
  return { state, ok: true };
}

function replaceExpense(state: AppState, next: Expense): AppState {
  return {
    ...state,
    expenses: state.expenses.map((e) => (e.id === next.id ? next : e)),
  };
}

function taskQueryOf(state: AppState, today = todayKey()): TaskQuery {
  return {
    rules: state.choreRules,
    taskState: state.choreTaskState,
    assignments: state.choreAssignments,
    swaps: state.swapRequests,
    today,
  };
}

/**
 * 规则变更或暂停后，把受影响的「待确认」换班显式标记为失效，
 * 避免申请悬挂在已经不存在或已经改变负责人的任务上。
 */
function invalidateSwapsFor(
  state: AppState,
  ruleId: string,
  fromDate: string,
  at: string,
  reason: string,
): SwapRequest[] {
  return state.swapRequests.map((s) => {
    if (s.status !== 'pending') return s;
    const touches =
      s.fromTaskKey.startsWith(`${ruleId}|`) || s.toTaskKey.startsWith(`${ruleId}|`);
    if (!touches) return s;
    const fromDateKey = s.fromTaskKey.split('|')[1] ?? '';
    const toDateKey = s.toTaskKey.split('|')[1] ?? '';
    const affected = fromDateKey >= fromDate || toDateKey >= fromDate;
    if (!affected) return s;
    return { ...s, status: 'invalid', resolvedAt: at, reason };
  });
}

export interface ActionResult {
  state: AppState;
  ok: boolean;
  error?: string;
}

/* --------------------------------- Reducer -------------------------------- */

export function applyAction(state: AppState, action: Action): ActionResult {
  const at = nowISO();

  switch (action.type) {
    case 'identity/set': {
      if (!state.members.some((m) => m.id === action.memberId)) {
        return fail(state, '成员不存在');
      }
      if (state.currentMemberId === action.memberId) return ok(state);
      return ok({ ...state, currentMemberId: action.memberId });
    }

    /* --------------------------------- 费用 -------------------------------- */

    case 'expense/add': {
      const input = action.input;
      if (input.name.trim() === '') return fail(state, '请填写账单名称');
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        return fail(state, '总额必须大于 0 元');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail(state, '请选择发生日期');
      if (!state.members.some((m) => m.id === input.payerId)) return fail(state, '请选择付款人');
      if (input.participantIds.length === 0) return fail(state, '参与分摊的成员不能为空');

      // 关联补货记录：必须存在，且不能已经有另一笔「有效」账单挂在它上面。
      // 这里做业务层校验，不依赖界面按钮是否隐藏；作废后的旧账单不再算有效关联。
      const linkedRestockId = input.linkedRestockId ?? null;
      if (linkedRestockId) {
        const record = state.restocks.find((r) => r.id === linkedRestockId);
        if (!record) return fail(state, '关联的补货记录不存在');
        const existing = state.expenses.find(
          (e) => e.linkedRestockId === linkedRestockId && !e.voided,
        );
        if (existing) return fail(state, '该补货记录已关联一笔有效费用，不能重复记账');
      }

      const order = state.members.map((m) => m.id);
      const participantIds = stableSort(input.participantIds, order);

      let amounts: Record<MemberId, number>;
      if (input.mode === 'equal') {
        amounts = splitEqually(input.amountCents, participantIds, order, (id) => id).amounts;
      } else {
        const check = checkCustomSplit(input.amountCents, input.customAmounts, participantIds);
        if (!check.ok) return fail(state, check.error ?? '自定义金额合计与总额不一致');
        amounts = {};
        participantIds.forEach((id) => {
          amounts[id] = input.customAmounts[id] ?? 0;
        });
      }

      const expense: Expense = {
        id: newId('exp'),
        name: input.name.trim(),
        amountCents: input.amountCents,
        category: input.category,
        date: input.date,
        payerId: input.payerId,
        participantIds,
        mode: input.mode,
        note: input.note.trim(),
        shares: participantIds.map((memberId) => ({
          memberId,
          amountCents: amounts[memberId],
          paidAt: null,
          confirmedAt: null,
          dispute: null,
          disputeLog: [],
        })),
        createdBy: input.createdBy,
        createdAt: at,
        voided: false,
        voidedAt: null,
        voidedBy: null,
        linkedRestockId,
        templateId: null,
        periodKey: null,
      };

      const restocks = input.linkedRestockId
        ? state.restocks.map((r) =>
            r.id === input.linkedRestockId ? { ...r, expenseId: expense.id } : r,
          )
        : state.restocks;

      return ok({ ...state, expenses: [expense, ...state.expenses], restocks });
    }

    case 'expense/void': {
      const expense = state.expenses.find((e) => e.id === action.expenseId);
      if (!expense) return fail(state, '账单不存在');
      if (!canVoidExpense(expense, action.by)) {
        return fail(
          state,
          expense.voided
            ? '该账单已作废'
            : '只有创建者在无人标记付款、无人结清时才能作废账单',
        );
      }
      return ok(
        replaceExpense(state, {
          ...expense,
          voided: true,
          voidedAt: at,
          voidedBy: action.by,
        }),
      );
    }

    /* ------------------------------ 周期模板 ------------------------------ */

    case 'template/add': {
      const input = action.input;
      if (!input.name.trim()) return fail(state, '请填写模板名称');
      if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
        return fail(state, '每月日期需在 1–31 之间');
      }
      if (input.amountCents !== null && (!Number.isInteger(input.amountCents) || input.amountCents <= 0)) {
        return fail(state, '固定金额需为大于 0 的整数分');
      }
      if (input.participantIds.length === 0) return fail(state, '参与分摊的成员不能为空');
      if (!state.members.some((m) => m.id === input.payerId)) return fail(state, '请选择垫付人');
      const template: ExpenseTemplate = {
        id: newId('tpl'),
        name: input.name.trim(),
        category: input.category,
        dayOfMonth: input.dayOfMonth,
        amountCents: input.amountCents,
        payerId: input.payerId,
        participantIds: stableSort(input.participantIds, state.members.map((m) => m.id)),
        mode: input.mode,
        customAmounts: { ...input.customAmounts },
        note: input.note.trim(),
        active: true,
        createdBy: input.createdBy,
        createdAt: at,
      };
      return ok({ ...state, templates: [...state.templates, template] });
    }

    case 'template/update': {
      const template = state.templates.find((t) => t.id === action.templateId);
      if (!template) return fail(state, '模板不存在');
      const patch = action.patch;
      const next: ExpenseTemplate = { ...template };
      if (patch.name !== undefined) {
        if (!patch.name.trim()) return fail(state, '请填写模板名称');
        next.name = patch.name.trim();
      }
      if (patch.category !== undefined) next.category = patch.category;
      if (patch.dayOfMonth !== undefined) {
        if (!Number.isInteger(patch.dayOfMonth) || patch.dayOfMonth < 1 || patch.dayOfMonth > 31) {
          return fail(state, '每月日期需在 1–31 之间');
        }
        next.dayOfMonth = patch.dayOfMonth;
      }
      if (patch.amountCents !== undefined) {
        if (patch.amountCents !== null && (!Number.isInteger(patch.amountCents) || patch.amountCents <= 0)) {
          return fail(state, '固定金额需为大于 0 的整数分');
        }
        next.amountCents = patch.amountCents;
      }
      if (patch.payerId !== undefined) {
        if (!state.members.some((m) => m.id === patch.payerId)) return fail(state, '请选择垫付人');
        next.payerId = patch.payerId;
      }
      if (patch.participantIds !== undefined) {
        if (patch.participantIds.length === 0) return fail(state, '参与分摊的成员不能为空');
        next.participantIds = stableSort(patch.participantIds, state.members.map((m) => m.id));
      }
      if (patch.mode !== undefined) next.mode = patch.mode;
      if (patch.customAmounts !== undefined) next.customAmounts = { ...patch.customAmounts };
      if (patch.note !== undefined) next.note = patch.note.trim();
      // 注意：修改模板只影响之后的生成，已生成账单保持原样
      return ok({
        ...state,
        templates: state.templates.map((t) => (t.id === next.id ? next : t)),
      });
    }

    case 'template/toggle': {
      const template = state.templates.find((t) => t.id === action.templateId);
      if (!template) return fail(state, '模板不存在');
      return ok({
        ...state,
        templates: state.templates.map((t) =>
          t.id === template.id ? { ...t, active: action.active } : t,
        ),
      });
    }

    case 'template/generate': {
      const template = state.templates.find((t) => t.id === action.templateId);
      if (!template) return fail(state, '模板不存在');
      if (!template.active) return fail(state, '模板已停用，请先启用后再生成');
      const preview = previewTemplate(state, template, action.month, action.amountCents);
      if (preview.errors.length > 0) return fail(state, preview.errors[0]);

      const order = state.members.map((m) => m.id);
      const computed = computeTemplateShares(template, preview.amountCents, order);
      if (!computed.ok) return fail(state, computed.error ?? '分摊金额计算失败');

      const participantIds = stableSort(template.participantIds, order);
      const expense: Expense = {
        id: newId('exp'),
        name: `${template.name}（${action.month}）`,
        amountCents: preview.amountCents,
        category: template.category,
        date: preview.date,
        payerId: template.payerId,
        participantIds,
        mode: template.mode,
        note: template.note,
        shares: participantIds.map((memberId) => ({
          memberId,
          amountCents: computed.amounts[memberId] ?? 0,
          paidAt: null,
          confirmedAt: null,
          dispute: null,
          disputeLog: [],
        })),
        createdBy: template.createdBy,
        createdAt: at,
        voided: false,
        voidedAt: null,
        voidedBy: null,
        linkedRestockId: null,
        templateId: template.id,
        periodKey: periodKeyOf(action.month),
      };
      return ok({ ...state, expenses: [expense, ...state.expenses] });
    }

    case 'share/markPaid': {
      const expense = state.expenses.find((e) => e.id === action.expenseId);
      if (!expense) return fail(state, '账单不存在');
      const share = expense.shares.find((s) => s.memberId === action.memberId);
      if (!share) return fail(state, '份额不存在');
      const view = buildShareView(expense, share, action.by);
      if (!view.canMarkPaid) {
        if (view.disputed) return fail(state, '该份额存在异议，异议解决后才能标记付款');
        if (share.paidAt) return fail(state, '该份额已标记付款，无需重复操作');
        return fail(state, '只有该份额本人可以标记付款');
      }
      return ok(
        replaceExpense(state, {
          ...expense,
          shares: expense.shares.map((s) =>
            s.memberId === action.memberId ? { ...s, paidAt: at } : s,
          ),
        }),
      );
    }

    case 'share/confirm': {
      const expense = state.expenses.find((e) => e.id === action.expenseId);
      if (!expense) return fail(state, '账单不存在');
      const share = expense.shares.find((s) => s.memberId === action.memberId);
      if (!share) return fail(state, '份额不存在');
      const view = buildShareView(expense, share, action.by);
      if (!view.canConfirm) {
        if (view.disputed) return fail(state, '该份额存在异议，异议解决后才能确认收款');
        if (share.confirmedAt) return fail(state, '该份额已结清，不能重复确认');
        if (!share.paidAt) return fail(state, '对方尚未标记付款，暂不能确认收款');
        return fail(state, '只有收款成员（账单付款人）可以确认收款');
      }
      return ok(
        replaceExpense(state, {
          ...expense,
          shares: expense.shares.map((s) =>
            s.memberId === action.memberId ? { ...s, confirmedAt: at } : s,
          ),
        }),
      );
    }

    case 'share/dispute': {
      const reason = action.reason.trim();
      const expense = state.expenses.find((e) => e.id === action.expenseId);
      if (!expense) return fail(state, '账单不存在');
      const share = expense.shares.find((s) => s.memberId === action.memberId);
      if (!share) return fail(state, '份额不存在');
      const view = buildShareView(expense, share, action.by);
      if (!view.canRaiseDispute) {
        if (share.dispute) return fail(state, '该份额已有异议');
        if (share.confirmedAt) return fail(state, '已结清的份额不能再提出异议');
        return fail(state, '只有付款成员或收款成员可以提出异议');
      }
      if (reason === '') return fail(state, '请填写异议原因');
      return ok(
        replaceExpense(state, {
          ...expense,
          shares: expense.shares.map((s) =>
            s.memberId === action.memberId
              ? {
                  ...s,
                  dispute: { raisedBy: action.by, reason, at },
                  disputeLog: [
                    ...(s.disputeLog ?? []),
                    { action: 'raise', by: action.by, reason, at },
                  ],
                }
              : s,
          ),
        }),
      );
    }

    case 'share/withdrawDispute': {
      const expense = state.expenses.find((e) => e.id === action.expenseId);
      if (!expense) return fail(state, '账单不存在');
      const share = expense.shares.find((s) => s.memberId === action.memberId);
      if (!share) return fail(state, '份额不存在');
      const view = buildShareView(expense, share, action.by);
      if (!view.canWithdrawDispute) {
        return fail(state, '只有异议提出者可以撤回该异议');
      }
      const reason = share.dispute?.reason ?? '';
      return ok(
        replaceExpense(state, {
          ...expense,
          shares: expense.shares.map((s) =>
            s.memberId === action.memberId
              ? {
                  ...s,
                  dispute: null,
                  disputeLog: [
                    ...(s.disputeLog ?? []),
                    { action: 'withdraw', by: action.by, reason, at },
                  ],
                }
              : s,
          ),
        }),
      );
    }

    /* --------------------------------- 值日 -------------------------------- */

    case 'chore/addRule': {
      const input = action.input;
      if (input.area.trim() === '') return fail(state, '请填写区域');
      if (input.standard.trim() === '') return fail(state, '请填写完成标准');
      if (input.weekdays.length === 0) return fail(state, '请至少选择一个执行日');
      if (input.memberOrder.length === 0) return fail(state, '请至少选择一位成员');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return fail(state, '请选择起始日期');
      const rule: ChoreRule = {
        id: newId('rule'),
        area: input.area.trim(),
        standard: input.standard.trim(),
        weekdays: [...input.weekdays].sort((a, b) => a - b),
        memberOrder: input.memberOrder,
        startDate: input.startDate,
        createdBy: input.createdBy,
        createdAt: at,
        versions: [
          {
            id: newId('ver'),
            effectiveFrom: input.startDate,
            weekdays: [...input.weekdays].sort((a, b) => a - b),
            memberOrder: [...input.memberOrder],
            anchorDate: input.startDate,
            createdBy: input.createdBy,
            createdAt: at,
            note: '初始版本',
          },
        ],
        pauses: [],
      };
      return ok({ ...state, choreRules: [...state.choreRules, rule] });
    }

    /**
     * 修改规则：只追加一个新版本并从「最早次日」起生效，
     * 历史任务仍按旧版本计算，不会被重排。
     */
    case 'chore/updateRule': {
      const rule = state.choreRules.find((r) => r.id === action.ruleId);
      if (!rule) return fail(state, '规则不存在');
      if (action.weekdays.length === 0) return fail(state, '请至少选择一个执行日');
      if (action.memberOrder.length === 0) return fail(state, '请至少选择一位成员');
      const tomorrow = addDays(todayKey(), 1);
      if (compareKeys(action.effectiveFrom, tomorrow) < 0) {
        return fail(state, `生效日期最早为明天（${tomorrow}），历史排班不会被改写`);
      }
      const weekdays = [...action.weekdays].sort((a, b) => a - b);
      const nextRule: ChoreRule = {
        ...rule,
        standard: action.standard?.trim() || rule.standard,
        // 镜像字段同步为最新，便于列表展示；计算仍以版本为准
        weekdays,
        memberOrder: [...action.memberOrder],
        versions: [
          ...ruleVersions(rule),
          {
            id: newId('ver'),
            effectiveFrom: action.effectiveFrom,
            weekdays,
            memberOrder: [...action.memberOrder],
            anchorDate: action.effectiveFrom,
            createdBy: action.by,
            createdAt: at,
            note: action.note?.trim() || '规则调整',
          },
        ],
      };
      // 受影响的未完成换班显式失效，避免悬挂
      const swaps = invalidateSwapsFor(state, rule.id, action.effectiveFrom, at, '规则已调整，该换班申请失效');
      return ok({
        ...state,
        choreRules: state.choreRules.map((r) => (r.id === nextRule.id ? nextRule : r)),
        swapRequests: swaps,
      });
    }

    case 'chore/pause': {
      const rule = state.choreRules.find((r) => r.id === action.ruleId);
      if (!rule) return fail(state, '规则不存在');
      if (isPausing(rule)) return fail(state, '该规则已处于暂停状态');
      const from = action.from && compareKeys(action.from, todayKey()) > 0 ? action.from : todayKey();
      const nextRule: ChoreRule = {
        ...rule,
        pauses: [...(rule.pauses ?? []), { from, to: null, by: action.by, at }],
      };
      const swaps = invalidateSwapsFor(
        state,
        rule.id,
        from,
        at,
        '规则已暂停，该换班申请失效',
      );
      return ok({
        ...state,
        choreRules: state.choreRules.map((r) => (r.id === nextRule.id ? nextRule : r)),
        swapRequests: swaps,
      });
    }

    case 'chore/resume': {
      const rule = state.choreRules.find((r) => r.id === action.ruleId);
      if (!rule) return fail(state, '规则不存在');
      if (!isPausing(rule)) return fail(state, '该规则没有进行中的暂停');
      // 恢复后按「实际发生次数」继续轮换，暂停期间不消耗轮次
      const pauses = (rule.pauses ?? []).map((p) =>
        p.to === null ? { ...p, to: action.to ?? todayKey() } : p,
      );
      return ok({
        ...state,
        choreRules: state.choreRules.map((r) =>
          r.id === rule.id ? { ...r, pauses } : r,
        ),
      });
    }

    /** 清理过期或已失效的待确认换班 */
    case 'chore/cleanupSwaps': {
      const query = taskQueryOf(state);
      const swaps = state.swapRequests.map((s) => {
        if (s.status !== 'pending') return s;
        if (isSwapStale(s, query)) {
          return { ...s, status: 'expired' as const, resolvedAt: at, reason: '任务已过期或已完成' };
        }
        return s;
      });
      return ok({ ...state, swapRequests: swaps });
    }

    case 'chore/complete': {
      const query = taskQueryOf(state);
      const task = findTask(query, action.key);
      if (!task) return fail(state, '任务不存在');
      if (task.status === 'done') return fail(state, '该任务已完成，无需重复操作');
      if (task.assigneeId !== action.by) return fail(state, '只有当前负责人可以完成任务');
      return ok({
        ...state,
        choreTaskState: {
          ...state.choreTaskState,
          [action.key]: { completedAt: at, completedBy: action.by, note: action.note.trim() },
        },
      });
    }

    case 'swap/request': {
      const query = taskQueryOf(state);
      const mine = findTask(query, action.fromTaskKey);
      const theirs = findTask(query, action.toTaskKey);
      const check = checkSwapPair(mine, theirs, action.by);
      if (!check.ok) return fail(state, check.error ?? '无法发起换班');
      if (action.fromTaskKey === action.toTaskKey) return fail(state, '请选择另一个任务');
      return ok({
        ...state,
        swapRequests: [
          ...state.swapRequests,
          {
            id: newId('swap'),
            fromTaskKey: action.fromTaskKey,
            toTaskKey: action.toTaskKey,
            fromMemberId: action.by,
            toMemberId: theirs!.assigneeId,
            status: 'pending',
            createdAt: at,
            resolvedAt: null,
            reason: null,
          },
        ],
      });
    }

    case 'swap/accept': {
      const swap = state.swapRequests.find((s) => s.id === action.swapId);
      if (!swap) return fail(state, '换班申请不存在');
      if (swap.status !== 'pending') return fail(state, '该申请已处理，不能重复接受');
      if (swap.toMemberId !== action.by) return fail(state, '只有被邀请人能接受换班');

      // 接受时重新校验，避免已过期/已完成的任务被交换。
      // 校验时排除本条申请本身，否则会被自己的待确认状态挡住。
      const query = taskQueryOf({
        ...state,
        swapRequests: state.swapRequests.filter((s) => s.id !== swap.id),
      });
      const fromTask = findTask(query, swap.fromTaskKey);
      const toTask = findTask(query, swap.toTaskKey);
      const check = checkSwapPair(fromTask, toTask, swap.fromMemberId);
      if (!check.ok) return fail(state, check.error ?? '任务状态已变化，换班失败');
      if (fromTask!.assigneeId !== swap.fromMemberId || toTask!.assigneeId !== swap.toMemberId) {
        return fail(state, '负责人已变化，换班失败');
      }

      const nextAssignments = {
        ...state.choreAssignments,
        [swap.fromTaskKey]: swap.toMemberId,
        [swap.toTaskKey]: swap.fromMemberId,
      };
      return ok({
        ...state,
        choreAssignments: nextAssignments,
        swapRequests: state.swapRequests.map((s) =>
          s.id === swap.id ? { ...s, status: 'accepted', resolvedAt: at } : s,
        ),
      });
    }

    case 'swap/reject': {
      const swap = state.swapRequests.find((s) => s.id === action.swapId);
      if (!swap) return fail(state, '换班申请不存在');
      if (swap.status !== 'pending') return fail(state, '该申请已处理');
      if (swap.toMemberId !== action.by) return fail(state, '只有被邀请人能拒绝换班');
      return ok({
        ...state,
        swapRequests: state.swapRequests.map((s) =>
          s.id === swap.id ? { ...s, status: 'rejected', resolvedAt: at } : s,
        ),
      });
    }

    case 'swap/cancel': {
      const swap = state.swapRequests.find((s) => s.id === action.swapId);
      if (!swap) return fail(state, '换班申请不存在');
      if (swap.status !== 'pending') return fail(state, '该申请已处理');
      if (swap.fromMemberId !== action.by) return fail(state, '只有发起人能撤销申请');
      return ok({
        ...state,
        swapRequests: state.swapRequests.map((s) =>
          s.id === swap.id ? { ...s, status: 'cancelled', resolvedAt: at } : s,
        ),
      });
    }

    /* --------------------------------- 物品 -------------------------------- */

    case 'supply/add': {
      const input = action.input;
      if (input.name.trim() === '') return fail(state, '请填写物品名称');
      if (!Number.isInteger(input.stock) || input.stock < 0) return fail(state, '余量需为不小于 0 的整数');
      if (!Number.isInteger(input.fullStock) || input.fullStock < 1) {
        return fail(state, '满量需为不小于 1 的整数');
      }
      const item: SupplyItem = {
        id: newId('item'),
        name: input.name.trim(),
        category: input.category.trim() || '未分类',
        location: input.location.trim(),
        stock: input.stock,
        fullStock: Math.max(input.fullStock, input.stock),
        unit: input.unit.trim(),
        lastRestockedAt: input.stock > 0 ? todayKey() : null,
        claim: null,
        createdAt: at,
        createdBy: input.createdBy,
        archived: false,
        archivedAt: null,
      };
      return ok({ ...state, supplies: [...state.supplies, item] });
    }

    /** 归档：保留补货与费用历史，只是不再出现在补货提醒；有认领时先处理认领 */
    case 'supply/archive': {
      const item = state.supplies.find((s) => s.id === action.itemId);
      if (!item) return fail(state, '物品不存在');
      if (item.archived) return fail(state, '该物品已归档');
      if (item.claim) return fail(state, '请先取消或完成当前认领，再归档该物品');
      return ok({
        ...state,
        supplies: state.supplies.map((s) =>
          s.id === item.id ? { ...s, archived: true, archivedAt: at } : s,
        ),
      });
    }

    case 'supply/unarchive': {
      const item = state.supplies.find((s) => s.id === action.itemId);
      if (!item) return fail(state, '物品不存在');
      if (!item.archived) return fail(state, '该物品未归档');
      return ok({
        ...state,
        supplies: state.supplies.map((s) =>
          s.id === item.id ? { ...s, archived: false, archivedAt: null } : s,
        ),
      });
    }

    /**
     * 编辑物品：只改当前属性，历史补货记录保留当时的名称快照，
     * 容量变更不静默裁剪当前余量（允许余量高于参考满量，状态会显示清楚）。
     */
    case 'supply/update': {
      const item = state.supplies.find((s) => s.id === action.itemId);
      if (!item) return fail(state, '物品不存在');
      const patch = action.patch;
      if (patch.name !== undefined && patch.name.trim() === '') {
        return fail(state, '请填写物品名称');
      }
      if (patch.fullStock !== undefined && (!Number.isInteger(patch.fullStock) || patch.fullStock < 1)) {
        return fail(state, '满量需为不小于 1 的整数');
      }
      if (patch.stock !== undefined && (!Number.isInteger(patch.stock) || patch.stock < 0)) {
        return fail(state, '余量需为不小于 0 的整数');
      }
      const next: SupplyItem = {
        ...item,
        name: patch.name?.trim() ?? item.name,
        category: patch.category?.trim() ?? item.category,
        location: patch.location?.trim() ?? item.location,
        unit: patch.unit?.trim() ?? item.unit,
        stock: patch.stock ?? item.stock,
        fullStock: patch.fullStock ?? item.fullStock,
      };
      return ok({
        ...state,
        supplies: state.supplies.map((s) => (s.id === next.id ? next : s)),
      });
    }

    case 'supply/setStock': {
      const item = state.supplies.find((s) => s.id === action.itemId);
      if (!item) return fail(state, '物品不存在');
      if (!Number.isInteger(action.stock) || action.stock < 0) {
        return fail(state, '余量需为不小于 0 的整数');
      }
      return ok({
        ...state,
        supplies: state.supplies.map((s) =>
          s.id === action.itemId ? { ...s, stock: action.stock } : s,
        ),
      });
    }

    case 'supply/claim': {
      const item = state.supplies.find((s) => s.id === action.itemId);
      if (!item) return fail(state, '物品不存在');
      if (item.claim) return fail(state, '已有室友认领补货，不能重复认领');
      return ok({
        ...state,
        supplies: state.supplies.map((s) =>
          s.id === action.itemId ? { ...s, claim: { memberId: action.by, at } } : s,
        ),
      });
    }

    case 'supply/unclaim': {
      const item = state.supplies.find((s) => s.id === action.itemId);
      if (!item) return fail(state, '物品不存在');
      if (item.claim?.memberId !== action.by) return fail(state, '只能取消自己的认领');
      return ok({
        ...state,
        supplies: state.supplies.map((s) =>
          s.id === action.itemId ? { ...s, claim: null } : s,
        ),
      });
    }

    case 'supply/completeRestock': {
      const item = state.supplies.find((s) => s.id === action.itemId);
      if (!item) return fail(state, '物品不存在');
      if (item.claim?.memberId !== action.by) return fail(state, '只有认领人可以完成补货');
      const today = todayKey();
      return ok({
        ...state,
        supplies: state.supplies.map((s) =>
          s.id === action.itemId
            ? { ...s, stock: s.fullStock, lastRestockedAt: today, claim: null }
            : s,
        ),
        restocks: [
          {
            id: newId('restock'),
            itemId: item.id,
            itemName: item.name,
            memberId: action.by,
            completedAt: at,
            expenseId: null,
          },
          ...state.restocks,
        ],
      });
    }

    /* --------------------------------- 公约 -------------------------------- */

    case 'pact/saveDraft': {
      return ok({ ...state, pactDraft: { ...action.content } });
    }

    case 'pact/submit': {
      if (pendingVersion(state)) return fail(state, '已有待确认版本，请先处理后再提交');
      const draft = state.pactDraft;
      if (!draft || !hasContent(draft)) return fail(state, '请先编辑公约内容');
      const memberIds = state.members.map((m) => m.id);
      const version = {
        id: newId('pact'),
        version: state.pactVersions.reduce((max, v) => Math.max(max, v.version), 0) + 1,
        content: { ...draft },
        memberIds,
        confirmations: { [action.by]: at } as Record<MemberId, string>,
        status: 'pending' as const,
        createdBy: action.by,
        createdAt: at,
        effectiveAt: null,
        withdrawnAt: null,
      };
      return ok({ ...state, pactVersions: [...state.pactVersions, version] });
    }

    case 'pact/confirm': {
      const version = state.pactVersions.find((v) => v.id === action.versionId);
      if (!version) return fail(state, '版本不存在');
      if (version.status !== 'pending') return fail(state, '只有待确认版本可以确认');
      if (!version.memberIds.includes(action.by)) return fail(state, '你不在本次确认名单中');
      if (version.confirmations[action.by]) return fail(state, '你已确认过，无需重复操作');

      const confirmations = { ...version.confirmations, [action.by]: at };
      const nextVersion = { ...version, confirmations };
      if (isFullyConfirmed(nextVersion)) {
        const prevActive = activeVersion(state);
        const versions = state.pactVersions.map((v) => {
          if (v.id === version.id) {
            return { ...nextVersion, status: 'active' as const, effectiveAt: at };
          }
          if (prevActive && v.id === prevActive.id) {
            return { ...v, status: 'superseded' as const };
          }
          return v;
        });
        return ok({ ...state, pactVersions: versions, pactDraft: null });
      }
      return ok({
        ...state,
        pactVersions: state.pactVersions.map((v) => (v.id === version.id ? nextVersion : v)),
      });
    }

    case 'pact/withdraw': {
      const version = state.pactVersions.find((v) => v.id === action.versionId);
      if (!version) return fail(state, '版本不存在');
      if (version.status !== 'pending') return fail(state, '只有待确认版本可以撤回');
      if (version.createdBy !== action.by) return fail(state, '只有发起人可以撤回');
      return ok({
        ...state,
        pactVersions: state.pactVersions.map((v) =>
          v.id === version.id
            ? { ...v, status: 'withdrawn' as const, withdrawnAt: at }
            : v,
        ),
      });
    }

    default:
      return fail(state, '未知操作');
  }
}

export function initialState(): AppState {
  return createSeedState();
}

export function emptyState(): AppState {
  const seeded = createSeedState();
  return { ...seeded, schemaVersion: SCHEMA_VERSION };
}

/** 供测试使用的任务键构造 */
export { taskKey };
