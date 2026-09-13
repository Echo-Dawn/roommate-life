import { SCHEMA_VERSION, type AppState, type Expense } from '../domain/types';
import { migrate } from './storage';

/**
 * 备份与恢复：
 * - 备份为带 schemaVersion 的完整 JSON，恢复走同一套迁移+校验管线。
 * - 恢复前先校验结构、版本、金额、日期与内部关联；任何一项失败都拒绝导入。
 * - 导入是「整体替换」，替换前自动把当前数据另存一份；替换失败不损坏原数据。
 * - 不做复杂数据合并。
 */

export interface BackupFile {
  app: 'roommate-life';
  schemaVersion: number;
  exportedAt: string;
  state: unknown;
}

export interface ImportCheck {
  ok: boolean;
  error?: string;
  /** 校验通过后可供确认页展示的概要 */
  summary?: {
    members: number;
    expenses: number;
    choreRules: number;
    supplies: number;
    restocks: number;
    pactVersions: number;
    templates: number;
    exportedAt: string | null;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function buildBackup(state: AppState): BackupFile {
  return {
    app: 'roommate-life',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    state: { ...state, schemaVersion: SCHEMA_VERSION },
  };
}

export function backupToJson(state: AppState): string {
  return JSON.stringify(buildBackup(state), null, 2);
}

/** 结构、版本、金额、日期与关联校验；全部通过才允许进入确认步骤 */
export function checkBackup(json: string): ImportCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON' };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: '备份结构不正确' };
  if (parsed.app !== 'roommate-life') {
    return { ok: false, error: '这不是「合租小窝」的备份文件' };
  }
  const version = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `备份来自更新版本（schema ${version}），当前支持 ${SCHEMA_VERSION}`,
    };
  }
  if (!isPlainObject(parsed.state)) return { ok: false, error: '备份缺少应用数据' };

  // 先走迁移+结构校验（复用 localStorage 的管线）
  let migrated;
  try {
    migrated = migrate(parsed.state);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '数据无法解析' };
  }
  const state = migrated.state;

  // 金额校验：份额合计必须等于总额
  for (const expense of state.expenses) {
    if (typeof expense.amountCents !== 'number' || !Number.isInteger(expense.amountCents) || expense.amountCents < 0) {
      return { ok: false, error: `账单「${expense.name ?? expense.id}」金额不是合法整数分` };
    }
    const shareTotal = expense.shares?.reduce((acc, s) => acc + (s.amountCents ?? 0), 0) ?? -1;
    if (shareTotal !== expense.amountCents) {
      return { ok: false, error: `账单「${expense.name ?? expense.id}」分摊合计（${shareTotal}）与总额（${expense.amountCents}）不一致` };
    }
    if (!DATE_RE.test(expense.date ?? '')) {
      return { ok: false, error: `账单「${expense.name ?? expense.id}」日期格式不正确` };
    }
  }

  // 成员引用校验
  const memberIds = new Set(state.members.map((m) => m.id));
  for (const expense of state.expenses) {
    if (!memberIds.has(expense.payerId)) {
      return { ok: false, error: `账单「${expense.name ?? expense.id}」付款人不存在` };
    }
    for (const share of expense.shares ?? []) {
      if (!memberIds.has(share.memberId)) {
        return { ok: false, error: `账单「${expense.name ?? expense.id}」包含未知成员` };
      }
    }
  }

  // 补货 ↔ 费用关联校验
  const restockIds = new Set(state.restocks.map((r) => r.id));
  const linked = new Set<string>();
  for (const expense of state.expenses) {
    if (expense.linkedRestockId) {
      if (!restockIds.has(expense.linkedRestockId)) {
        return { ok: false, error: `账单「${expense.name ?? expense.id}」关联了不存在的补货记录` };
      }
      if (!expense.voided) {
        if (linked.has(expense.linkedRestockId)) {
          return { ok: false, error: '同一条补货记录关联了多笔有效费用' };
        }
        linked.add(expense.linkedRestockId);
      }
    }
  }
  for (const restock of state.restocks) {
    if (!DATE_RE.test(restock.completedAt?.slice(0, 10) ?? '')) {
      return { ok: false, error: '补货记录日期格式不正确' };
    }
  }

  // 模板日期校验
  for (const template of state.templates ?? []) {
    const day = template.dayOfMonth;
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return { ok: false, error: `模板「${template.name ?? template.id}」执行日不合法` };
    }
  }

  return {
    ok: true,
    summary: {
      members: state.members.length,
      expenses: state.expenses.length,
      choreRules: state.choreRules.length,
      supplies: state.supplies.length,
      restocks: state.restocks.length,
      pactVersions: state.pactVersions.length,
      templates: state.templates.length,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
    },
  };
}

/** 从备份解析出可用的应用状态（checkBackup 通过后调用） */
export function parseBackup(json: string): AppState {
  const parsed = JSON.parse(json) as { state: unknown };
  return migrate(parsed.state).state;
}

/** 替换前的自动备份；失败不阻塞替换，但会向上说明 */
export function snapshotCurrent(state: AppState): string | null {
  try {
    return JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION });
  } catch {
    return null;
  }
}

export type { Expense };
