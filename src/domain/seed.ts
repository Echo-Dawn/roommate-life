import { addDays, nowISO, startOfWeek, todayKey, weekdayOf } from './dateKey';
import { occurrenceIndex } from './chores';
import { splitEqually } from './split';
import {
  SCHEMA_VERSION,
  type AppState,
  type ChoreRule,
  type ChoreTaskState,
  type Expense,
  type MemberId,
  type PactContent,
  type PactVersion,
  type Share,
  type SupplyItem,
  type ExpenseTemplate,
} from './types';

/**
 * 示例数据：虚构的「向阳小窝」与三位室友。
 * 所有日期基于首次初始化时的本地日期生成，避免打开时全部过期。
 * 仅在没有任何数据时写入，不覆盖用户已有操作。
 */

export const SEED_MEMBERS = [
  { id: 'lin', name: '小林', initial: '林' },
  { id: 'zhou', name: '小周', initial: '周' },
  { id: 'chen', name: '小陈', initial: '陈' },
];

const MEMBER_ORDER: MemberId[] = SEED_MEMBERS.map((m) => m.id);

export const SEED_HOME_NAME = '向阳小窝';

function makeShares(
  amountCents: number,
  memberOrder: MemberId[],
  overrides: Partial<Record<MemberId, Partial<Share>>> = {},
): Share[] {
  const { amounts } = splitEqually(amountCents, memberOrder, memberOrder, (id) => id);
  return memberOrder.map((memberId) => ({
    memberId,
    amountCents: amounts[memberId],
    paidAt: null,
    confirmedAt: null,
    dispute: null,
    disputeLog: [],
    ...(overrides[memberId] ?? {}),
  }));
}

function expense(
  base: Omit<
    Expense,
    'shares' | 'voided' | 'voidedAt' | 'voidedBy' | 'linkedRestockId' | 'templateId' | 'periodKey'
  >,
  overrides: Partial<Record<MemberId, Partial<Share>>>,
): Expense {
  return {
    ...base,
    shares: makeShares(base.amountCents, base.participantIds, overrides),
    voided: false,
    voidedAt: null,
    voidedBy: null,
    linkedRestockId: null,
    templateId: null,
    periodKey: null,
  };
}

/** 示例周期模板：房租固定、水电每期手填、宽带固定且设定在 31 日 */
function seedTemplates(): ExpenseTemplate[] {
  const at = nowISO();
  return [
    {
      id: 'seed-tpl-rent',
      name: '房租',
      category: 'rent',
      dayOfMonth: 1,
      amountCents: 360000,
      payerId: 'lin',
      participantIds: [...MEMBER_ORDER],
      mode: 'equal',
      customAmounts: {},
      note: '每月 1 日，三人平均分摊',
      active: true,
      createdBy: 'lin',
      createdAt: at,
    },
    {
      id: 'seed-tpl-utility',
      name: '水电燃气',
      category: 'utility',
      dayOfMonth: 6,
      amountCents: null,
      payerId: 'zhou',
      participantIds: [...MEMBER_ORDER],
      mode: 'equal',
      customAmounts: {},
      note: '金额每月不同，生成前需要手填',
      active: true,
      createdBy: 'zhou',
      createdAt: at,
    },
    {
      id: 'seed-tpl-network',
      name: '宽带月费',
      category: 'network',
      dayOfMonth: 31,
      amountCents: 9900,
      payerId: 'chen',
      participantIds: [...MEMBER_ORDER],
      mode: 'equal',
      customAmounts: {},
      note: '设定在 31 日，短月自动取当月最后一天',
      active: true,
      createdBy: 'chen',
      createdAt: at,
    },
  ];
}

export function createSeedState(today: string = todayKey()): AppState {
  const at = nowISO();
  const monthStart = `${today.slice(0, 7)}-01`;

  const expenses: Expense[] = [
    // 1) 待付款：小周、小陈各自应付 1200 元（小林垫付）
    expense(
      {
        id: 'seed-exp-rent',
        name: `${Number(today.slice(5, 7))} 月房租`,
        amountCents: 360_000,
        category: 'rent',
        date: monthStart,
        payerId: 'lin',
        participantIds: MEMBER_ORDER,
        mode: 'equal',
        note: '房东收款，按三人平均分摊。',
        createdBy: 'lin',
        createdAt: at,
      },
      {},
    ),
    // 2) 待付款：小林 89.34、小周 89.33（小陈垫付）
    expense(
      {
        id: 'seed-exp-utility',
        name: `${Number(today.slice(5, 7))} 月水电燃气`,
        amountCents: 26_800,
        category: 'utility',
        date: addDays(today, -3),
        payerId: 'chen',
        participantIds: MEMBER_ORDER,
        mode: 'equal',
        note: '账单已出，按户号均摊。',
        createdBy: 'chen',
        createdAt: at,
      },
      {},
    ),
    // 3) 待收款确认：小林已标记付款，等待小周确认
    expense(
      {
        id: 'seed-exp-supplies',
        name: '厨房公共用品采购',
        amountCents: 12_650,
        category: 'supplies',
        date: addDays(today, -6),
        payerId: 'zhou',
        participantIds: MEMBER_ORDER,
        mode: 'equal',
        note: '垃圾袋、洗洁精、海绵。',
        createdBy: 'zhou',
        createdAt: at,
      },
      {
        lin: { paidAt: at },
      },
    ),
    // 4) 已结清
    expense(
      {
        id: 'seed-exp-network',
        name: '宽带月费',
        amountCents: 9_900,
        category: 'network',
        date: addDays(today, -20),
        payerId: 'chen',
        participantIds: MEMBER_ORDER,
        mode: 'equal',
        note: '已全部结清。',
        createdBy: 'chen',
        createdAt: at,
      },
      {
        lin: { paidAt: at, confirmedAt: at },
        zhou: { paidAt: at, confirmedAt: at },
      },
    ),
  ];

  /* ------------------------------- 值日规则 ------------------------------- */
  const weekStart = startOfWeek(today);
  const ruleStart = addDays(weekStart, -7);

  const choreRules: ChoreRule[] = [
    {
      id: 'seed-rule-living',
      area: '客厅与玄关',
      standard: '地面清扫拖净，茶几物品归位，鞋柜外侧整齐，垃圾袋扎口。',
      weekdays: [1, 3, 5],
      memberOrder: ['lin', 'zhou', 'chen'],
      startDate: ruleStart,
      createdBy: 'lin',
      createdAt: at,
    },
    {
      id: 'seed-rule-kitchen',
      area: '厨房与餐桌',
      standard: '台面无油污，水槽清空并擦干，餐桌擦净，厨余及时倒。',
      weekdays: [2, 4, 6],
      memberOrder: ['zhou', 'chen', 'lin'],
      startDate: ruleStart,
      createdBy: 'zhou',
      createdAt: at,
    },
    {
      id: 'seed-rule-bath',
      area: '卫生间与洗手台',
      standard: '洗手台无水渍，地面拖干，镜面擦净，补充卫生纸。',
      weekdays: [0],
      memberOrder: ['chen', 'lin', 'zhou'],
      startDate: ruleStart,
      createdBy: 'chen',
      createdAt: at,
    },
  ];

  // 生成历史任务：除最近一次外全部完成，留下恰好一项「待补做」
  const choreTaskState: Record<string, ChoreTaskState> = {};
  type Occurrence = { key: string; date: string; ruleId: string; owner: MemberId };
  const past: Occurrence[] = [];
  let cursor = ruleStart;
  while (cursor < today) {
    choreRules.forEach((rule) => {
      if (!rule.weekdays.includes(weekdayOf(cursor))) return;
      const index = occurrenceIndex(rule, cursor);
      if (index < 0) return;
      const owner = rule.memberOrder[index % rule.memberOrder.length];
      past.push({ key: `${rule.id}|${cursor}`, date: cursor, ruleId: rule.id, owner });
    });
    cursor = addDays(cursor, 1);
  }
  past.sort((a, b) => (a.date === b.date ? a.ruleId.localeCompare(b.ruleId) : a.date < b.date ? -1 : 1));
  past.forEach((occ, index) => {
    if (index === past.length - 1) return; // 保留最近一次未完成 → 待补做
    choreTaskState[occ.key] = {
      completedAt: nowISO(),
      completedBy: occ.owner,
      note: '',
    };
  });

  /* ------------------------------- 公共物品 ------------------------------- */
  const supplies: SupplyItem[] = [
    {
      id: 'seed-item-trashbag',
      name: '垃圾袋',
      category: '清洁日用',
      location: '阳台储物柜',
      stock: 12,
      fullStock: 12,
      unit: '卷',
      lastRestockedAt: addDays(today, -5),
      claim: null,
      createdAt: at,
      createdBy: 'lin',
    },
    {
      id: 'seed-item-detergent',
      name: '洗洁精',
      category: '清洁日用',
      location: '厨房水槽下',
      stock: 1,
      fullStock: 2,
      unit: '瓶',
      lastRestockedAt: addDays(today, -12),
      claim: null,
      createdAt: at,
      createdBy: 'zhou',
    },
    {
      id: 'seed-item-tissue',
      name: '卫生纸',
      category: '清洁日用',
      location: '卫生间储物架',
      stock: 0,
      fullStock: 8,
      unit: '提',
      lastRestockedAt: addDays(today, -25),
      claim: { memberId: 'chen', at: addDays(today, -1) },
      createdAt: at,
      createdBy: 'chen',
    },
    {
      id: 'seed-item-soap',
      name: '洗手液',
      category: '清洁日用',
      location: '卫生间洗手台',
      stock: 4,
      fullStock: 4,
      unit: '瓶',
      lastRestockedAt: addDays(today, -8),
      claim: null,
      createdAt: at,
      createdBy: 'lin',
    },
    {
      id: 'seed-item-laundry',
      name: '洗衣液',
      category: '清洁日用',
      location: '阳台洗衣区',
      stock: 2,
      fullStock: 6,
      unit: '瓶',
      lastRestockedAt: addDays(today, -18),
      claim: null,
      createdAt: at,
      createdBy: 'zhou',
    },
  ];

  const restocks = [
    {
      id: 'seed-restock-1',
      itemId: 'seed-item-trashbag',
      itemName: '垃圾袋',
      memberId: 'lin',
      completedAt: addDays(today, -5),
      expenseId: null,
    },
    {
      id: 'seed-restock-2',
      itemId: 'seed-item-soap',
      itemName: '洗手液',
      memberId: 'zhou',
      completedAt: addDays(today, -8),
      expenseId: null,
    },
  ];

  /* -------------------------------- 公约 -------------------------------- */
  const v1Content: PactContent = {
    quiet: '工作日 23:00 后保持安静，周末可放宽到 24:00。',
    guest: '访客留宿提前一天在群里说明，每月不超过 2 次。',
    common: '公共区域使用后即时清理，个人物品不过夜堆放在客厅。',
    settle: '账单发起后 3 天内标记付款，收款方 24 小时内确认。',
    clean: '值日当天 22:00 前完成，未能完成则次日补做并说明。',
    purchase: '单笔超过 100 元的公共采购，先在群里说明再购买。',
  };
  const v2Content: PactContent = {
    ...v1Content,
    quiet: '工作日 22:30 后保持安静，周末可放宽到 23:30；视频通话请戴耳机。',
    guest: '访客留宿提前一天在群里说明，每月不超过 3 次，连续不超过 2 晚。',
  };

  const pactVersions: PactVersion[] = [
    {
      id: 'seed-pact-v1',
      version: 1,
      content: v1Content,
      memberIds: MEMBER_ORDER,
      confirmations: {
        lin: addDays(today, -30),
        zhou: addDays(today, -30),
        chen: addDays(today, -29),
      },
      status: 'active',
      createdBy: 'lin',
      createdAt: addDays(today, -30),
      effectiveAt: addDays(today, -29),
      withdrawnAt: null,
    },
    {
      id: 'seed-pact-v2',
      version: 2,
      content: v2Content,
      memberIds: MEMBER_ORDER,
      confirmations: { lin: addDays(today, -2) },
      status: 'pending',
      createdBy: 'lin',
      createdAt: addDays(today, -2),
      effectiveAt: null,
      withdrawnAt: null,
    },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    homeName: SEED_HOME_NAME,
    members: SEED_MEMBERS.map((m) => ({ ...m })),
    currentMemberId: 'lin',
    expenses,
    templates: seedTemplates(),
    choreRules,
    choreTaskState,
    choreAssignments: {},
    swapRequests: [],
    supplies,
    restocks,
    pactVersions,
    pactDraft: null,
    seededAt: nowISO(),
  };
}
