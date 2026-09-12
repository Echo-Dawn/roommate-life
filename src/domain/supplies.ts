import { LOW_STOCK_RATIO, type MemberId, type SupplyItem, type SupplyStatus } from './types';

/**
 * 统一的库存状态规则（首页、物品页、导航提醒、认领条件共用）：
 * - 余量 0：已用完
 * - 未满 且 余量/满量 ≤ 50%：快用完
 * - 其他：充足
 */
export function supplyStatus(item: SupplyItem): SupplyStatus {
  const full = Number.isFinite(item.fullStock) && item.fullStock > 0 ? item.fullStock : 1;
  if (item.stock <= 0) return 'out';
  if (item.stock < full && item.stock / full <= LOW_STOCK_RATIO) return 'low';
  return 'ok';
}

export function supplyStatusLabel(status: SupplyStatus): string {
  if (status === 'out') return '已用完';
  if (status === 'low') return '快用完';
  return '充足';
}

/** 规则说明文案，保证各页面一致 */
export function supplyRuleHint(): string {
  return `余量为 0 视为「已用完」，未满且不足满量一半视为「快用完」，其余为「充足」；补货后会恢复到满量。`;
}

export function needsRestock(item: SupplyItem): boolean {
  return supplyStatus(item) !== 'ok';
}

/** 已有认领时，另一位身份不能重复认领；补满后也不再需要认领 */
export function canClaim(item: SupplyItem, _memberId: MemberId): boolean {
  if (item.claim) return false;
  return needsRestock(item);
}

export function canCancelClaim(item: SupplyItem, memberId: MemberId): boolean {
  return item.claim?.memberId === memberId;
}

export function canCompleteRestock(item: SupplyItem, memberId: MemberId): boolean {
  return item.claim?.memberId === memberId;
}

export function sortByUrgency(items: SupplyItem[]): SupplyItem[] {
  const rank: Record<SupplyStatus, number> = { out: 0, low: 1, ok: 2 };
  return [...items].sort((a, b) => {
    const ra = rank[supplyStatus(a)];
    const rb = rank[supplyStatus(b)];
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}
