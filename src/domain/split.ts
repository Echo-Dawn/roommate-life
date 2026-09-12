import type { MemberId } from './types';

/**
 * 分摊计算。
 * 平均分摊：先按整数分整除，余数（0 ~ n-1 分）按「稳定成员顺序」依次 +1 分，
 * 保证总和严格等于总额，且同一批人每次计算结果完全一致。
 */

export interface EqualSplitResult {
  amounts: Record<MemberId, number>;
  /** 每人基础份额（分） */
  base: number;
  /** 余数（分） */
  remainder: number;
  /** 因余数多承担 1 分的成员，按稳定顺序 */
  extraMemberIds: MemberId[];
  explanation: string;
}

/** 按给定顺序（成员固定顺序）排序参与者，保证稳定 */
export function stableSort(ids: MemberId[], order: MemberId[]): MemberId[] {
  const rank = new Map<MemberId, number>();
  order.forEach((id, index) => rank.set(id, index));
  return [...ids].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
}

export function splitEqually(
  amountCents: number,
  participantIds: MemberId[],
  memberOrder: MemberId[],
  nameOf: (id: MemberId) => string,
): EqualSplitResult {
  const ids = stableSort(participantIds, memberOrder);
  const n = ids.length;
  if (n === 0) {
    return {
      amounts: {},
      base: 0,
      remainder: 0,
      extraMemberIds: [],
      explanation: '请先选择参与分摊的成员。',
    };
  }
  const base = Math.floor(amountCents / n);
  const remainder = amountCents - base * n;

  const amounts: Record<MemberId, number> = {};
  ids.forEach((id) => {
    amounts[id] = base;
  });
  const extraMemberIds = ids.slice(0, remainder);
  extraMemberIds.forEach((id) => {
    amounts[id] = base + 1;
  });

  const chain = ids.map(nameOf).join(' → ');
  const explanation =
    remainder === 0
      ? `${n} 人平均分摊，每人 ${(base / 100).toFixed(2)} 元，正好整除。`
      : `${n} 人平均分摊，每人 ${(base / 100).toFixed(2)} 元；余数 ${remainder} 分按固定成员顺序（${chain}）分配给前 ${remainder} 位，各多承担 1 分，合计仍为 ${(amountCents / 100).toFixed(2)} 元。`;

  return { amounts, base, remainder, extraMemberIds, explanation };
}

export interface CustomSplitCheck {
  ok: boolean;
  total: number;
  error?: string;
}

/** 自定义金额：合计必须严格等于总额 */
export function checkCustomSplit(
  amountCents: number,
  amounts: Record<MemberId, number>,
  participantIds: MemberId[],
): CustomSplitCheck {
  const total = participantIds.reduce((acc, id) => acc + (amounts[id] ?? 0), 0);
  if (total !== amountCents) {
    const diff = total - amountCents;
    return {
      ok: false,
      total,
      error: `各人金额合计 ${(total / 100).toFixed(2)} 元，与总额 ${(amountCents / 100).toFixed(2)} 元相差 ${(diff / 100).toFixed(2)} 元，需调整至完全一致。`,
    };
  }
  return { ok: true, total };
}
