import { describe, expect, it } from 'vitest';
import { applyAction } from '../store/reducer';
import { testState, ORDER } from './testFactory';
import { activeVersion, emptyPactContent, isFullyConfirmed, pendingVersion } from './pact';
import { PACT_CLAUSES, type PactContent, type PactVersion } from './types';

function content(text: string): PactContent {
  const base = emptyPactContent();
  PACT_CLAUSES.forEach((clause) => {
    base[clause.key] = text;
  });
  return base;
}

function submitted(by = 'lin') {
  const base = testState({ pactDraft: content('v2 内容') });
  return applyAction(base, { type: 'pact/submit', by });
}

describe('公约版本', () => {
  it('提交后进入待确认，发起人自动确认', () => {
    const result = submitted();
    expect(result.ok).toBe(true);
    const pending = pendingVersion(result.state)!;
    expect(pending.status).toBe('pending');
    expect(pending.memberIds).toEqual(ORDER);
    expect(pending.confirmations.lin).toBeTruthy();
    expect(isFullyConfirmed(pending)).toBe(false);
  });

  it('未全员确认时新版本不生效，旧版本继续有效', () => {
    const active: PactVersion = {
      id: 'p1',
      version: 1,
      content: content('v1'),
      memberIds: ORDER,
      confirmations: { lin: 'a', zhou: 'a', chen: 'a' },
      status: 'active',
      createdBy: 'lin',
      createdAt: 'a',
      effectiveAt: 'a',
      withdrawnAt: null,
    };
    const base = testState({ pactVersions: [active], pactDraft: content('v2') });
    const submittedState = applyAction(base, { type: 'pact/submit', by: 'lin' }).state;
    const pending = pendingVersion(submittedState)!;

    const half = applyAction(submittedState, { type: 'pact/confirm', versionId: pending.id, by: 'zhou' });
    expect(half.ok).toBe(true);
    expect(pendingVersion(half.state)!.status).toBe('pending');
    expect(activeVersion(half.state)!.version).toBe(1);
  });

  it('全员确认后新版本生效，旧版本失效', () => {
    const active: PactVersion = {
      id: 'p1',
      version: 1,
      content: content('v1'),
      memberIds: ORDER,
      confirmations: { lin: 'a', zhou: 'a', chen: 'a' },
      status: 'active',
      createdBy: 'lin',
      createdAt: 'a',
      effectiveAt: 'a',
      withdrawnAt: null,
    };
    let state = testState({ pactVersions: [active], pactDraft: content('v2') });
    state = applyAction(state, { type: 'pact/submit', by: 'lin' }).state;
    const pending = pendingVersion(state)!;
    state = applyAction(state, { type: 'pact/confirm', versionId: pending.id, by: 'zhou' }).state;
    state = applyAction(state, { type: 'pact/confirm', versionId: pending.id, by: 'chen' }).state;

    const nowActive = activeVersion(state)!;
    expect(nowActive.version).toBe(2);
    expect(nowActive.effectiveAt).toBeTruthy();
    expect(state.pactVersions.find((v) => v.id === 'p1')!.status).toBe('superseded');
    expect(pendingVersion(state)).toBeNull();
  });

  it('同一人不能重复确认', () => {
    const state = submitted().state;
    const pending = pendingVersion(state)!;
    const again = applyAction(state, { type: 'pact/confirm', versionId: pending.id, by: 'lin' });
    expect(again.ok).toBe(false);
  });

  it('同时最多一个待确认版本', () => {
    const state = submitted().state;
    const second = applyAction(state, { type: 'pact/submit', by: 'zhou' });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('待确认');
  });

  it('只有发起人能撤回，撤回后可重新提交', () => {
    const state = submitted().state;
    const pending = pendingVersion(state)!;
    const wrong = applyAction(state, { type: 'pact/withdraw', versionId: pending.id, by: 'zhou' });
    expect(wrong.ok).toBe(false);

    const withdrawn = applyAction(state, { type: 'pact/withdraw', versionId: pending.id, by: 'lin' });
    expect(withdrawn.ok).toBe(true);
    expect(pendingVersion(withdrawn.state)).toBeNull();

    const resubmit = applyAction(withdrawn.state, { type: 'pact/submit', by: 'lin' });
    expect(resubmit.ok).toBe(true);
    // 版本号继续递增，撤回的版本保留在历史中
    expect(pendingVersion(resubmit.state)!.version).toBe(2);
  });

  it('不在确认名单中的人不能确认', () => {
    const state = submitted().state;
    const pending = pendingVersion(state)!;
    const restricted = {
      ...state,
      pactVersions: state.pactVersions.map((v) =>
        v.id === pending.id ? { ...v, memberIds: ['lin', 'zhou'] } : v,
      ),
    };
    const result = applyAction(restricted, {
      type: 'pact/confirm',
      versionId: pending.id,
      by: 'chen',
    });
    expect(result.ok).toBe(false);
  });

  it('没有有效版本时明确为 null', () => {
    expect(activeVersion(testState())).toBeNull();
  });
});
