/**
 * 合租小窝 · 领域模型
 * 所有金额均以「整数分」存储与计算，避免浮点误差。
 */

export const SCHEMA_VERSION = 1;

export type MemberId = string;

export interface Member {
  id: MemberId;
  name: string;
  /** 头像用单字 */
  initial: string;
}

/* ---------------------------------- 费用 ---------------------------------- */

export type ExpenseCategory = 'rent' | 'utility' | 'network' | 'supplies' | 'other';

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'rent', label: '房租' },
  { value: 'utility', label: '水电燃气' },
  { value: 'network', label: '网络' },
  { value: 'supplies', label: '公共物品' },
  { value: 'other', label: '其他' },
];

export function categoryLabel(value: ExpenseCategory): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? '其他';
}

export type SplitMode = 'equal' | 'custom';

export interface Dispute {
  raisedBy: MemberId;
  reason: string;
  at: string;
}

/** 异议操作记录（提出 / 撤回均留痕） */
export interface DisputeLogEntry {
  action: 'raise' | 'withdraw';
  by: MemberId;
  reason: string;
  at: string;
}

/**
 * 一份「份额」= 某位成员在这笔账单中承担多少、以及结算到哪一步。
 * 结算链路：待付款 →（付款成员标记已付）→ 待收款人确认 →（收款成员确认收到）→ 已结清
 */
export interface Share {
  memberId: MemberId;
  amountCents: number;
  /** 付款成员（份额归属人）标记已付款的时间 */
  paidAt: string | null;
  /** 收款成员（账单付款人）确认收到的时间 */
  confirmedAt: string | null;
  dispute: Dispute | null;
  disputeLog: DisputeLogEntry[];
}

export interface Expense {
  id: string;
  name: string;
  amountCents: number;
  category: ExpenseCategory;
  /** YYYY-MM-DD */
  date: string;
  /** 垫付人（收款方） */
  payerId: MemberId;
  /** 参与分摊的成员，稳定顺序 */
  participantIds: MemberId[];
  mode: SplitMode;
  note: string;
  shares: Share[];
  createdBy: MemberId;
  createdAt: string;
  /** 作废：保留记录但不计入汇总 */
  voided: boolean;
  voidedAt: string | null;
  voidedBy: MemberId | null;
  /** 由补货完成「同时记一笔」生成的关联 */
  linkedRestockId: string | null;
}

/** 单份份额的结算状态（对外展示用） */
export type ShareStatus =
  | 'own' // 垫付人本人承担的份额，无需结算
  | 'unpaid' // 待付款
  | 'awaiting_confirm' // 已标记付款，待收款人确认
  | 'settled'; // 已结清

export interface ShareView {
  expense: Expense;
  share: Share;
  status: ShareStatus;
  /** 是否处于异议中（未结清时暂停结算操作） */
  disputed: boolean;
  /** 当前演示身份可以执行的操作 */
  canMarkPaid: boolean;
  canConfirm: boolean;
  canRaiseDispute: boolean;
  canWithdrawDispute: boolean;
}

/* ---------------------------------- 值日 ---------------------------------- */

export interface ChoreRule {
  id: string;
  /** 区域 */
  area: string;
  /** 完成标准 */
  standard: string;
  /** 每周执行日 0=周日 … 6=周六 */
  weekdays: number[];
  /** 轮换顺序（稳定） */
  memberOrder: MemberId[];
  /** YYYY-MM-DD，轮换起点 */
  startDate: string;
  createdBy: MemberId;
  createdAt: string;
}

export interface ChoreTaskState {
  completedAt: string;
  completedBy: MemberId;
  note: string;
}

export type SwapStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface SwapRequest {
  id: string;
  /** 发起人的任务 */
  fromTaskKey: string;
  /** 被邀请人的任务 */
  toTaskKey: string;
  fromMemberId: MemberId;
  toMemberId: MemberId;
  status: SwapStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export type ChoreStatus = 'pending' | 'done' | 'overdue';

/** 派生的值日任务（不入库，按规则 + 日期计算） */
export interface ChoreTask {
  key: string; // `${ruleId}|${YYYY-MM-DD}`
  ruleId: string;
  date: string;
  area: string;
  standard: string;
  /** 轮换或换班后的负责人 */
  assigneeId: MemberId;
  /** 未换班时的轮换负责人 */
  rotationOwnerId: MemberId;
  swapped: boolean;
  status: ChoreStatus;
  state: ChoreTaskState | null;
  /** 该任务涉及的待确认换班申请 */
  pendingSwapId: string | null;
}

/* --------------------------------- 公共物品 -------------------------------- */

export type SupplyStatus = 'ok' | 'low' | 'out';

/**
 * 库存状态按「容量比例」判断，而不是全局绝对数量：
 * - 余量 0 → 已用完
 * - 未满 且 余量/满量 ≤ 0.5 → 快用完
 * - 其他 → 充足
 */
export const LOW_STOCK_RATIO = 0.5;

export interface SupplyClaim {
  memberId: MemberId;
  at: string;
}

export interface SupplyItem {
  id: string;
  name: string;
  category: string;
  location: string;
  /** 当前余量 */
  stock: number;
  /** 满量：补货完成后恢复到该数量 */
  fullStock: number;
  unit: string;
  lastRestockedAt: string | null;
  claim: SupplyClaim | null;
  createdAt: string;
  createdBy: MemberId;
}

export interface RestockRecord {
  id: string;
  itemId: string;
  itemName: string;
  memberId: MemberId;
  completedAt: string;
  /** 关联的（有效）费用 */
  expenseId: string | null;
}

/* --------------------------------- 室友公约 -------------------------------- */

export type PactClauseKey =
  | 'quiet'
  | 'guest'
  | 'common'
  | 'settle'
  | 'clean'
  | 'purchase';

export const PACT_CLAUSES: { key: PactClauseKey; label: string; hint: string }[] = [
  { key: 'quiet', label: '安静时间', hint: '例如工作日晚间 23:00 后保持安静' },
  { key: 'guest', label: '访客留宿', hint: '例如提前一天在群里说明，每月不超过 2 次' },
  { key: 'common', label: '公共区域', hint: '例如使用后立即清理，物品不过夜堆放' },
  { key: 'settle', label: '费用结算', hint: '例如账单 3 天内标记付款，收款方 24 小时内确认' },
  { key: 'clean', label: '清洁标准', hint: '例如值日当天 22:00 前完成，未做则次日补做' },
  { key: 'purchase', label: '物品购买', hint: '例如单笔超过 100 元先在群里说明' },
];

export type PactContent = Record<PactClauseKey, string>;

export type PactVersionStatus = 'pending' | 'active' | 'withdrawn' | 'superseded';

export interface PactVersion {
  id: string;
  version: number;
  content: PactContent;
  /** 提交时固定的确认成员列表 */
  memberIds: MemberId[];
  /** memberId -> 确认时间 */
  confirmations: Record<MemberId, string>;
  status: PactVersionStatus;
  createdBy: MemberId;
  createdAt: string;
  effectiveAt: string | null;
  withdrawnAt: string | null;
}

/* ---------------------------------- 应用 ---------------------------------- */

export interface AppState {
  schemaVersion: number;
  homeName: string;
  members: Member[];
  currentMemberId: MemberId;
  expenses: Expense[];
  choreRules: ChoreRule[];
  choreTaskState: Record<string, ChoreTaskState>;
  /** 换班负责人覆盖：taskKey -> memberId */
  choreAssignments: Record<string, MemberId>;
  swapRequests: SwapRequest[];
  supplies: SupplyItem[];
  restocks: RestockRecord[];
  pactVersions: PactVersion[];
  pactDraft: PactContent | null;
  /** 首次初始化时间，示例数据基于此生成 */
  seededAt: string | null;
}
