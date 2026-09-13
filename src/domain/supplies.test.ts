import { describe, expect, it } from 'vitest';
import { canClaim, needsRestock, sortByUrgency, supplyStatus, supplyStatusLabel } from './supplies';
import { applyAction } from '../store/reducer';
import { testState } from './testFactory';
import type { SupplyItem } from './types';

function item(stock: number, fullStock: number): SupplyItem {
  return {
    id: `i-${stock}-${fullStock}`,
    name: '测试物品',
    category: '清洁日用',
    location: '阳台',
    stock,
    fullStock,
    unit: '瓶',
    lastRestockedAt: null,
    claim: null,
    createdAt: 'x',
    createdBy: 'lin',
    archived: false,
    archivedAt: null,
  };
}

describe('库存状态规则（容量比例）', () => {
  it('余量为 0 一律为已用完，与满量无关', () => {
    [1, 2, 6, 8].forEach((full) => {
      expect(supplyStatus(item(0, full))).toBe('out');
    });
  });

  it('补满后为充足，不再需要补货、也不能再次认领', () => {
    [1, 2, 6, 8].forEach((full) => {
      const fulled = item(full, full);
      expect(supplyStatus(fulled)).toBe('ok');
      expect(needsRestock(fulled)).toBe(false);
      expect(canClaim(fulled, 'lin')).toBe(false);
    });
  });

  it('满量 2：1 瓶为快用完，2 瓶为充足', () => {
    expect(supplyStatus(item(1, 2))).toBe('low');
    expect(supplyStatus(item(2, 2))).toBe('ok');
  });

  it('满量 6：3 瓶及以下为快用完，4 瓶起为充足', () => {
    expect(supplyStatus(item(1, 6))).toBe('low');
    expect(supplyStatus(item(2, 6))).toBe('low');
    expect(supplyStatus(item(3, 6))).toBe('low');
    expect(supplyStatus(item(4, 6))).toBe('ok');
    expect(supplyStatus(item(5, 6))).toBe('ok');
  });

  it('满量 8：4 瓶为快用完（正好 50%），5 瓶为充足', () => {
    expect(supplyStatus(item(4, 8))).toBe('low');
    expect(supplyStatus(item(5, 8))).toBe('ok');
  });

  it('满量 1：0 为已用完，1 为充足', () => {
    expect(supplyStatus(item(0, 1))).toBe('out');
    expect(supplyStatus(item(1, 1))).toBe('ok');
  });

  it('状态文案与排序一致', () => {
    expect(supplyStatusLabel('out')).toBe('已用完');
    expect(supplyStatusLabel('low')).toBe('快用完');
    expect(supplyStatusLabel('ok')).toBe('充足');
    const sorted = sortByUrgency([item(5, 8), item(0, 8), item(2, 8)]);
    expect(sorted.map((i) => supplyStatus(i))).toEqual(['out', 'low', 'ok']);
  });
});

describe('认领与补货闭环', () => {
  const low = item(1, 2);

  it('快用完且无人认领时可以认领', () => {
    expect(canClaim(low, 'lin')).toBe(true);
  });

  it('完成补货后恢复满量、状态转为充足且清除认领', () => {
    const base = testState({ supplies: [{ ...low, id: 'x1' }] });
    const claimed = applyAction(base, { type: 'supply/claim', itemId: 'x1', by: 'lin' }).state;
    const done = applyAction(claimed, {
      type: 'supply/completeRestock',
      itemId: 'x1',
      by: 'lin',
    });
    expect(done.ok).toBe(true);
    const after = done.state.supplies[0];
    expect(after.stock).toBe(2);
    expect(supplyStatus(after)).toBe('ok');
    expect(needsRestock(after)).toBe(false);
    expect(after.claim).toBeNull();
    // 补满后不能再次认领
    expect(canClaim(after, 'zhou')).toBe(false);
    expect(done.state.restocks).toHaveLength(1);
  });

  it('手动更新余量到满量后同样视为充足', () => {
    const base = testState({ supplies: [{ ...item(0, 4), id: 'x2' }] });
    const updated = applyAction(base, { type: 'supply/setStock', itemId: 'x2', stock: 4 });
    expect(supplyStatus(updated.state.supplies[0])).toBe('ok');
  });
});
