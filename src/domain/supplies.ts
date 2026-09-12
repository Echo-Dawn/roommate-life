import { LOW_STOCK_THRESHOLD, type MemberId, type SupplyItem, type SupplyStatus } from './types';

export function supplyStatus(item: SupplyItem): SupplyStatus {
  if (item.stock <= 0) return 'out';
  if (item.stock <= LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

export function supplyStatusLabel(status: SupplyStatus): string {
  if (status === 'out') return '已用完';
  if (status === 'low') return '快用完';
  return '充足';
}

export function needsRestock(item: SupplyItem): boolean {
  return supplyStatus(item) !== 'ok';
}

/** 已有认领时，另一位身份不能重复认领 */
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
