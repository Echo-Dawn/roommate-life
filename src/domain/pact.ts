import type { AppState, MemberId, PactClauseKey, PactContent, PactVersion } from './types';
import { PACT_CLAUSES } from './types';

export function emptyPactContent(): PactContent {
  return PACT_CLAUSES.reduce((acc, clause) => {
    acc[clause.key] = '';
    return acc;
  }, {} as PactContent);
}

export function activeVersion(state: AppState): PactVersion | null {
  const active = state.pactVersions.filter((v) => v.status === 'active');
  if (active.length === 0) return null;
  return active.reduce((latest, v) =>
    (v.effectiveAt ?? v.createdAt) > (latest.effectiveAt ?? latest.createdAt) ? v : latest,
  );
}

/** 同时最多一个待确认版本 */
export function pendingVersion(state: AppState): PactVersion | null {
  return state.pactVersions.find((v) => v.status === 'pending') ?? null;
}

export function isFullyConfirmed(version: PactVersion): boolean {
  if (version.memberIds.length === 0) return false;
  return version.memberIds.every((id) => Boolean(version.confirmations[id]));
}

/** 当前演示身份是否还需要确认待确认版本 */
export function needsMyConfirmation(state: AppState, memberId: MemberId): boolean {
  const pending = pendingVersion(state);
  if (!pending) return false;
  if (!pending.memberIds.includes(memberId)) return false;
  return !pending.confirmations[memberId];
}

export function confirmedCount(version: PactVersion): number {
  return version.memberIds.filter((id) => Boolean(version.confirmations[id])).length;
}

export function sortedVersions(state: AppState): PactVersion[] {
  return [...state.pactVersions].sort((a, b) => b.version - a.version);
}

export function hasContent(content: PactContent): boolean {
  return PACT_CLAUSES.some((clause) => (content[clause.key] ?? '').trim() !== '');
}

export function countFilled(content: PactContent): number {
  return PACT_CLAUSES.filter((clause) => (content[clause.key] ?? '').trim() !== '').length;
}

/* ------------------------------ 版本条款差异 ------------------------------ */

export type ClauseChangeType = 'added' | 'modified' | 'removed' | 'unchanged';

export interface ClauseDiff {
  key: PactClauseKey;
  label: string;
  type: ClauseChangeType;
  before: string;
  after: string;
}

/**
 * 以当前生效版为基准，逐条对比待确认版本：
 * 新增 / 修改 / 删除 / 未变化。确认仍然绑定到具体版本 ID。
 */
export function diffPactContent(
  base: PactContent | null,
  next: PactContent,
): ClauseDiff[] {
  return PACT_CLAUSES.map((clause) => {
    const before = (base?.[clause.key] ?? '').trim();
    const after = (next[clause.key] ?? '').trim();
    let type: ClauseChangeType = 'unchanged';
    if (before === '' && after !== '') type = 'added';
    else if (before !== '' && after === '') type = 'removed';
    else if (before !== after) type = 'modified';
    return { key: clause.key, label: clause.label, type, before, after };
  });
}

export function changedClauses(diffs: ClauseDiff[]): ClauseDiff[] {
  return diffs.filter((d) => d.type !== 'unchanged');
}

export const CLAUSE_CHANGE_LABEL: Record<ClauseChangeType, string> = {
  added: '新增',
  modified: '修改',
  removed: '删除',
  unchanged: '未变',
};
