import { SCHEMA_VERSION, type AppState, type Expense, type MemberId, type Share } from './types';
import { splitEqually } from './split';

export const MEMBERS = [
  { id: 'lin', name: '小林', initial: '林' },
  { id: 'zhou', name: '小周', initial: '周' },
  { id: 'chen', name: '小陈', initial: '陈' },
];

export const ORDER: MemberId[] = MEMBERS.map((m) => m.id);

export function testState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    homeName: '测试小窝',
    members: MEMBERS.map((m) => ({ ...m })),
    currentMemberId: 'lin',
    expenses: [],
    choreRules: [],
    choreTaskState: {},
    choreAssignments: {},
    swapRequests: [],
    supplies: [],
    restocks: [],
    pactVersions: [],
    pactDraft: null,
    seededAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 平均分摊构造一笔账单 */
export function makeExpense(opts: {
  id: string;
  amountCents: number;
  payerId: MemberId;
  participantIds?: MemberId[];
  date?: string;
  createdBy?: MemberId;
}): Expense {
  const participantIds = opts.participantIds ?? ORDER;
  const { amounts } = splitEqually(opts.amountCents, participantIds, ORDER, (id) => id);
  const shares: Share[] = participantIds.map((memberId) => ({
    memberId,
    amountCents: amounts[memberId],
    paidAt: null,
    confirmedAt: null,
    dispute: null,
    disputeLog: [],
  }));
  return {
    id: opts.id,
    name: `账单-${opts.id}`,
    amountCents: opts.amountCents,
    category: 'other',
    date: opts.date ?? '2026-09-01',
    payerId: opts.payerId,
    participantIds,
    mode: 'equal',
    note: '',
    shares,
    createdBy: opts.createdBy ?? opts.payerId,
    createdAt: '2026-09-01T00:00:00.000Z',
    voided: false,
    voidedAt: null,
    voidedBy: null,
    linkedRestockId: null,
  };
}

export function patchShare(
  state: AppState,
  expenseId: string,
  memberId: MemberId,
  patch: Partial<Share>,
): AppState {
  return {
    ...state,
    expenses: state.expenses.map((e) =>
      e.id === expenseId
        ? {
            ...e,
            shares: e.shares.map((s) => (s.memberId === memberId ? { ...s, ...patch } : s)),
          }
        : e,
    ),
  };
}
