import type { AppState, MemberId, PactContent, PactVersion } from './types';
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
