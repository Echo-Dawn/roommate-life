import { nowISO, todayKey } from '../domain/dateKey';
import { checkCustomSplit, splitEqually, stableSort } from '../domain/split';
import { buildShareView, canVoidExpense } from '../domain/expenses';
import { checkSwapPair, findTask, taskKey, type TaskQuery } from '../domain/chores';
import { activeVersion, hasContent, isFullyConfirmed, pendingVersion } from '../domain/pact';
import {
  SCHEMA_VERSION,
  type AppState,
  type ChoreRule,
  type Expense,
  type ExpenseCategory,
  type MemberId,
  type PactContent,
  type SplitMode,
  type SupplyItem,
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

export type Action =
  | { type: 'identity/set'; memberId: MemberId }
  | { type: 'expense/add'; input: ExpenseDraftInput }
  | { type: 'expense/void'; expenseId: string; by: MemberId }
  | { type: 'share/markPaid'; expenseId: string; memberId: MemberId; by: MemberId }
  | { type: 'share/confirm'; expenseId: string; memberId: MemberId; by: MemberId }
  | { type: 'share/dispute'; expenseId: string; memberId: MemberId; by: MemberId; reason: string }
  | { type: 'share/withdrawDispute'; expenseId: string; memberId: MemberId; by: MemberId }
  | { type: 'chore/addRule'; input: ChoreRuleInput }
  | { type: 'chore/complete'; key: string; by: MemberId; note: string }
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
      };
      return ok({ ...state, choreRules: [...state.choreRules, rule] });
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
      };
      return ok({ ...state, supplies: [...state.supplies, item] });
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
