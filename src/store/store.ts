import { useSyncExternalStore } from 'react';
import type { AppState } from '../domain/types';
import { createSeedState } from '../domain/seed';
import {
  clearAppData,
  loadState,
  saveState,
  StorageError,
  type LoadResult,
} from './storage';
import { applyAction, type Action, type ActionResult } from './reducer';

/**
 * 极简外部 store：页面（React）只负责展示，业务规则在 reducer，持久化在 storage。
 * 用 useSyncExternalStore 订阅，避免把整个 state 塞进 Context 造成无谓重渲染。
 */

export type StoreStatus = 'loading' | 'ready' | 'corrupt' | 'unavailable';

export interface Snapshot {
  status: StoreStatus;
  state: AppState | null;
  /** 数据损坏时的提示与原始数据（不删除，供用户备份） */
  corrupt: { message: string; raw: string | null } | null;
  unavailableMessage: string | null;
  saveError: string | null;
  notice: string | null;
}

const listeners = new Set<() => void>();

let snapshot: Snapshot = {
  status: 'loading',
  state: null,
  corrupt: null,
  unavailableMessage: null,
  saveError: null,
  notice: null,
};

let initialized = false;

function emit() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function persist(state: AppState): void {
  try {
    saveState(state);
    if (snapshot.saveError) setSnapshot({ saveError: null });
  } catch (error) {
    const message =
      error instanceof StorageError ? error.message : `保存失败：${String(error)}`;
    setSnapshot({ saveError: message });
  }
}

export function initStore(): void {
  if (initialized) return;
  initialized = true;
  const result: LoadResult = loadState();
  switch (result.kind) {
    case 'empty': {
      const seeded = createSeedState();
      snapshot = {
        status: 'ready',
        state: seeded,
        corrupt: null,
        unavailableMessage: null,
        saveError: null,
        notice: null,
      };
      persist(seeded);
      emit();
      break;
    }
    case 'ok': {
      snapshot = {
        status: 'ready',
        state: result.state,
        corrupt: null,
        unavailableMessage: null,
        saveError: null,
        notice: result.migrated
          ? `本地数据已从旧版本迁移到当前格式（schema ${result.state.schemaVersion}）。`
          : null,
      };
      if (result.migrated) persist(result.state);
      emit();
      break;
    }
    case 'corrupt': {
      snapshot = {
        status: 'corrupt',
        state: null,
        corrupt: { message: result.message, raw: result.raw },
        unavailableMessage: null,
        saveError: null,
        notice: null,
      };
      emit();
      break;
    }
    case 'unavailable': {
      // 存储不可用：用示例数据在内存中运行，并明确告知无法保存
      snapshot = {
        status: 'unavailable',
        state: createSeedState(),
        corrupt: null,
        unavailableMessage: result.message,
        saveError: null,
        notice: null,
      };
      emit();
      break;
    }
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

export function dispatch(action: Action): ActionResult {
  const current = snapshot.state;
  if (!current) {
    return { state: current as unknown as AppState, ok: false, error: '数据尚未就绪' };
  }
  const result = applyAction(current, action);
  if (!result.ok) {
    // 校验失败：不改变状态，仅返回原因
    return result;
  }
  setSnapshot({ state: result.state });
  if (snapshot.status === 'ready') persist(result.state);
  return result;
}

export interface ResetResult {
  ok: boolean;
  error?: string;
  removed?: string[];
}

/** 重置：只清除本应用自己的 key，重新写入示例数据 */
export function resetStore(): ResetResult {
  try {
    const removed = clearAppData();
    const seeded = createSeedState();
    setSnapshot({
      status: 'ready',
      state: seeded,
      corrupt: null,
      saveError: null,
      notice: null,
    });
    persist(seeded);
    return { ok: true, removed };
  } catch (error) {
    const message = error instanceof StorageError ? error.message : `重置失败：${String(error)}`;
    setSnapshot({ saveError: message });
    return { ok: false, error: message };
  }
}

/** 数据损坏后由用户确认重置 */
export function recoverFromCorrupt(): ResetResult {
  return resetStore();
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

/**
 * 从备份整体替换当前数据。
 * - 调用前应已通过 checkBackup 校验并向用户确认。
 * - 替换前先把当前数据快照交给调用方保存（downloadBackup），失败不损坏原数据：
 *   只有新状态成功写入 localStorage 后才更新内存快照。
 */
export function restoreFromBackup(state: AppState): RestoreResult {
  try {
    saveState(state);
  } catch (error) {
    const message = error instanceof StorageError ? error.message : `恢复失败：${String(error)}`;
    return { ok: false, error: message };
  }
  setSnapshot({
    status: 'ready',
    state,
    corrupt: null,
    saveError: null,
    notice: '已从备份恢复数据（整体替换）。',
  });
  return { ok: true };
}

export function dismissNotice(): void {
  if (snapshot.notice || snapshot.saveError) setSnapshot({ notice: null, saveError: null });
}

export function useStore(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
