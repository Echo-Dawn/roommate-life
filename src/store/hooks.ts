import { useCallback } from 'react';
import { dispatch, useStore } from './store';
import type { Action, ActionResult } from './reducer';
import type { AppState } from '../domain/types';
import { useToast } from '../ui/Toast';

/** 在路由页内使用，保证 state 已就绪 */
export function useAppState(): AppState {
  const { state } = useStore();
  if (!state) throw new Error('应用数据尚未就绪');
  return state;
}

export type RunAction = (action: Action, successText?: string) => boolean;

/**
 * 统一执行入口：校验失败时给出明确原因，成功时给出提交反馈。
 * 校验失败不会修改状态，因此重复点击不会产生重复副作用。
 */
export function useAction(): RunAction {
  const toast = useToast();
  return useCallback<RunAction>(
    (action, successText) => {
      let result: ActionResult;
      try {
        result = dispatch(action);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '操作失败');
        return false;
      }
      if (!result.ok) {
        toast.error(result.error ?? '操作未成功');
        return false;
      }
      if (successText) toast.success(successText);
      return true;
    },
    [toast],
  );
}
