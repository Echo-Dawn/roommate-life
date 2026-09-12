import { describe, expect, it } from 'vitest';
import { splitEqually, checkCustomSplit, stableSort } from './split';
import { formatCents, parseYuanInput } from './money';
import { ORDER } from './testFactory';

describe('金额解析', () => {
  it('只接受最多两位小数，并按整数分存储', () => {
    expect(parseYuanInput('100').cents).toBe(10000);
    expect(parseYuanInput('100.00').cents).toBe(10000);
    expect(parseYuanInput(' 12.3 ').cents).toBe(1230);
    expect(parseYuanInput('12.345').ok).toBe(false);
    expect(parseYuanInput('abc').ok).toBe(false);
    expect(parseYuanInput('').ok).toBe(false);
  });

  it('格式化不丢失分位', () => {
    expect(formatCents(10000)).toBe('100.00');
    expect(formatCents(1)).toBe('0.01');
    expect(formatCents(3334)).toBe('33.34');
  });
});

describe('平均分摊', () => {
  it('100 元三人均摊，合计严格等于 100 元', () => {
    const result = splitEqually(10000, ORDER, ORDER, (id) => id);
    const total = ORDER.reduce((acc, id) => acc + result.amounts[id], 0);
    expect(total).toBe(10000);
    expect(result.base).toBe(3333);
    expect(result.remainder).toBe(1);
    expect(result.extraMemberIds).toEqual(['lin']);
    expect(result.amounts.lin).toBe(3334);
    expect(result.amounts.zhou).toBe(3333);
    expect(result.amounts.chen).toBe(3333);
  });

  it('余数为 2 时按顺序前两位各多 1 分', () => {
    const result = splitEqually(10001, ['chen', 'lin', 'zhou'], ORDER, (id) => id);
    // 稳定顺序后为 lin, zhou, chen；10001 分 = 3333 * 3 + 2
    const total = ['lin', 'zhou', 'chen'].reduce((acc, id) => acc + result.amounts[id], 0);
    expect(total).toBe(10001);
    expect(result.base).toBe(3333);
    expect(result.remainder).toBe(2);
    expect(result.extraMemberIds).toEqual(['lin', 'zhou']);
    expect(result.amounts.lin).toBe(3334);
    expect(result.amounts.zhou).toBe(3334);
    expect(result.amounts.chen).toBe(3333);
  });

  it('金额小于人数时也能整除分配（余数小于人数）', () => {
    const result = splitEqually(2, ORDER, ORDER, (id) => id);
    const total = ORDER.reduce((acc, id) => acc + result.amounts[id], 0);
    expect(total).toBe(2);
    expect(result.amounts.lin).toBe(1);
    expect(result.amounts.zhou).toBe(1);
    expect(result.amounts.chen).toBe(0);
  });

  it('无参与者时不产生份额', () => {
    const result = splitEqually(10000, [], ORDER, (id) => id);
    expect(result.amounts).toEqual({});
  });
});

describe('平均分摊稳定性', () => {
  it('参与者顺序不影响分配结果', () => {
    const a = splitEqually(10000, ORDER, ORDER, (id) => id);
    const b = splitEqually(10000, ['chen', 'zhou', 'lin'], ORDER, (id) => id);
    expect(b.amounts).toEqual(a.amounts);
  });

  it('stableSort 按给定顺序排序', () => {
    expect(stableSort(['chen', 'lin'], ORDER)).toEqual(['lin', 'chen']);
  });
});

describe('自定义分摊', () => {
  it('合计等于总额时通过', () => {
    expect(
      checkCustomSplit(10000, { lin: 4000, zhou: 3000, chen: 3000 }, ORDER).ok,
    ).toBe(true);
  });

  it('合计不等于总额时报错并给出差额', () => {
    const result = checkCustomSplit(10000, { lin: 4000, zhou: 3000, chen: 2999 }, ORDER);
    expect(result.ok).toBe(false);
    expect(result.total).toBe(9999);
    expect(result.error).toContain('-0.01');
  });
});
