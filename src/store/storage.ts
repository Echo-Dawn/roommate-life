import { SCHEMA_VERSION, type AppState } from '../domain/types';
import { createSeedState } from '../domain/seed';

/**
 * localStorage 访问层。
 * - 只使用 roommate-life: 前缀的 key，重置时不影响同域下其他应用。
 * - 读取失败/结构损坏时向上报告，绝不静默清空。
 * - 写入失败时抛出，由 UI 明确提示，不虚报保存成功。
 */

export const STORAGE_PREFIX = 'roommate-life:';
export const STORAGE_KEY = `${STORAGE_PREFIX}state`;

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'ok'; state: AppState; migrated: boolean }
  | { kind: 'corrupt'; message: string; raw: string | null }
  | { kind: 'unavailable'; message: string };

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const ls = window.localStorage;
    const probe = `${STORAGE_PREFIX}__probe__`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return getLocalStorage() !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 迁移链：从 raw.schemaVersion 逐级升级到 SCHEMA_VERSION。
 * 当前只有 v1；后续版本在此追加迁移函数即可。
 */
const MIGRATIONS: Record<number, (input: Record<string, unknown>) => Record<string, unknown>> = {
  // 0 -> 1：v1 之前没有 schemaVersion 字段的早期结构，按最小可用字段补齐
  0: (input) => ({ ...input, schemaVersion: 1 }),
  // 1 -> 2：新增周期费用模板，并为历史账单补齐模板关联字段（保持原有 ID 与关联）
  1: (input) => {
    const expenses = Array.isArray(input.expenses) ? input.expenses : [];
    return {
      ...input,
      schemaVersion: 2,
      templates: Array.isArray(input.templates) ? input.templates : [],
      expenses: expenses.map((e) => {
        if (!isPlainObject(e)) return e;
        return {
          ...e,
          templateId: typeof e.templateId === 'string' ? e.templateId : null,
          periodKey: typeof e.periodKey === 'string' ? e.periodKey : null,
        };
      }),
    };
  },
  // 2 -> 3：值日规则引入「版本 + 暂停区间」，物品支持归档
  2: (input) => {
    const choreRules = Array.isArray(input.choreRules) ? input.choreRules : [];
    const supplies = Array.isArray(input.supplies) ? input.supplies : [];
    return {
      ...input,
      schemaVersion: 3,
      choreRules: choreRules.map((rule) => {
        if (!isPlainObject(rule)) return rule;
        const id = typeof rule.id === 'string' ? rule.id : `rule-${Math.random()}`;
        const startDate = typeof rule.startDate === 'string' ? rule.startDate : '2026-01-01';
        const weekdays = Array.isArray(rule.weekdays) ? rule.weekdays : [];
        const memberOrder = Array.isArray(rule.memberOrder) ? rule.memberOrder : [];
        const versions = Array.isArray(rule.versions) ? rule.versions : [];
        return {
          ...rule,
          // 旧规则没有版本历史：用原字段构造初始版本，保证历史排班结果不变
          versions:
            versions.length > 0
              ? versions
              : [
                  {
                    id: `${id}-v0`,
                    effectiveFrom: startDate,
                    weekdays,
                    memberOrder,
                    anchorDate: startDate,
                    createdBy: rule.createdBy ?? null,
                    createdAt: rule.createdAt ?? startDate,
                    note: '初始版本（迁移生成）',
                  },
                ],
          pauses: Array.isArray(rule.pauses) ? rule.pauses : [],
        };
      }),
      supplies: supplies.map((item) => {
        if (!isPlainObject(item)) return item;
        return {
          ...item,
          archived: item.archived === true,
          archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
        };
      }),
      swapRequests: (Array.isArray(input.swapRequests) ? input.swapRequests : []).map((s) =>
        isPlainObject(s) ? { ...s, reason: typeof s.reason === 'string' ? s.reason : null } : s,
      ),
    };
  },
};

function validate(state: unknown): AppState {
  if (!isPlainObject(state)) throw new Error('数据结构不是对象');
  if (!Array.isArray(state.members) || state.members.length === 0) {
    throw new Error('缺少成员数据');
  }
  if (!Array.isArray(state.expenses)) throw new Error('缺少费用数据');
  if (!Array.isArray(state.choreRules)) throw new Error('缺少值日规则');
  if (!Array.isArray(state.supplies)) throw new Error('缺少物品数据');
  if (!Array.isArray(state.restocks)) throw new Error('缺少补货记录');
  if (!Array.isArray(state.swapRequests)) throw new Error('缺少换班记录');
  if (!Array.isArray(state.templates)) {
    // 结构缺失但其余完整时按空数组补齐，而不是判定为损坏
    (state as Record<string, unknown>).templates = [];
  }
  if (!Array.isArray(state.pactVersions)) throw new Error('缺少公约数据');
  if (typeof state.homeName !== 'string') throw new Error('缺少小窝名称');
  const result = state as unknown as AppState;
  if (!result.members.some((m) => m.id === result.currentMemberId)) {
    result.currentMemberId = result.members[0].id;
  }
  return result;
}

export function migrate(raw: unknown): { state: AppState; migrated: boolean } {
  if (!isPlainObject(raw)) throw new Error('数据不是有效的 JSON 对象');
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  let current: Record<string, unknown> = { ...raw };
  let migrated = false;

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `数据来自更新版本（schema ${version}），当前应用支持 ${SCHEMA_VERSION}，请更新页面后再打开。`,
    );
  }

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`缺少 ${version} → ${version + 1} 的迁移逻辑`);
    current = step(current);
    version += 1;
    migrated = true;
  }
  current.schemaVersion = SCHEMA_VERSION;
  return { state: validate(current), migrated };
}

export function loadState(): LoadResult {
  const ls = getLocalStorage();
  if (!ls) {
    return {
      kind: 'unavailable',
      message: '当前浏览器无法使用本地存储（可能处于隐私模式或已禁用），数据将无法保存。',
    };
  }
  let raw: string | null = null;
  try {
    raw = ls.getItem(STORAGE_KEY);
  } catch (error) {
    return { kind: 'corrupt', message: `读取本地数据失败：${describe(error)}`, raw: null };
  }
  if (raw === null || raw === '') return { kind: 'empty' };

  try {
    const parsed = JSON.parse(raw) as unknown;
    const { state, migrated } = migrate(parsed);
    return { kind: 'ok', state, migrated };
  } catch (error) {
    return {
      kind: 'corrupt',
      message:
        error instanceof Error
          ? `本地数据无法解析：${error.message}`
          : '本地数据无法解析。',
      raw,
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 写入失败直接抛出，调用方负责提示 */
export function saveState(state: AppState): void {
  const ls = getLocalStorage();
  if (!ls) {
    throw new StorageError('本地存储不可用，本次改动未能保存。');
  }
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    throw new StorageError(`保存失败：${describe(error)}。请检查浏览器存储权限或剩余空间。`);
  }
}

/** 只清除本应用自己的 key */
export function clearAppData(): string[] {
  const ls = getLocalStorage();
  if (!ls) throw new StorageError('本地存储不可用，无法重置。');
  const removed: string[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => {
      ls.removeItem(key);
      removed.push(key);
    });
  } catch (error) {
    throw new StorageError(`重置失败：${describe(error)}`);
  }
  return removed;
}

/** 导出损坏数据，供用户自行备份 */
export function downloadBackup(raw: string, filename = 'roommate-life-backup.txt'): void {
  try {
    const blob = new Blob([raw], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    /* 备份失败不阻塞主流程 */
  }
}

export function freshState(): AppState {
  return createSeedState();
}
