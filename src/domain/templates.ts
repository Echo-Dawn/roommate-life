import { checkCustomSplit, splitEqually } from './split';
import type { AppState, Expense, ExpenseTemplate, MemberId } from './types';

/**
 * 周期费用模板。
 * 模板不是账单：必须用户选月份、确认金额并预览后才会生成，
 * 页面关闭期间不会自动生成任何东西。
 */

/** 账期 YYYY-MM 的当月天数 */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return 31;
  return new Date(y, m, 0).getDate();
}

/** 模板在某账期的实际发生日：设定 31 日而短月时取当月最后一天 */
export function periodDate(month: string, dayOfMonth: number): string {
  const max = daysInMonth(month);
  const day = Math.min(Math.max(1, dayOfMonth), max);
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** 是否因为短月而调整了日期 */
export function isDateClamped(month: string, dayOfMonth: number): boolean {
  return dayOfMonth > daysInMonth(month);
}

export function periodKeyOf(month: string): string {
  return month;
}

export interface TemplatePreview {
  template: ExpenseTemplate;
  month: string;
  date: string;
  dateClamped: boolean;
  amountCents: number;
  /** 固定金额模板不需要手填 */
  needsAmount: boolean;
  /** 已存在有效账单 → 不能重复生成 */
  duplicate: boolean;
  duplicateExpenseId: string | null;
  /** 存在但已作废 → 明确提示后可重新生成 */
  voidedExpenseId: string | null;
  errors: string[];
}

export function previewTemplate(
  state: AppState,
  template: ExpenseTemplate,
  month: string,
  inputAmountCents: number | null,
): TemplatePreview {
  const date = periodDate(month, template.dayOfMonth);
  const needsAmount = template.amountCents === null;
  const amountCents = needsAmount ? (inputAmountCents ?? 0) : (template.amountCents as number);
  const errors: string[] = [];

  if (needsAmount && (inputAmountCents === null || inputAmountCents <= 0)) {
    errors.push('该模板没有固定金额，请先填写本期金额');
  }
  if (!needsAmount && amountCents <= 0) errors.push('模板固定金额必须大于 0');
  if (template.participantIds.length === 0) errors.push('参与分摊的成员不能为空');

  const existing = state.expenses.filter(
    (e) => e.templateId === template.id && e.periodKey === periodKeyOf(month),
  );
  const duplicate = existing.some((e) => !e.voided);
  const voidedExpenseId = existing.find((e) => e.voided)?.id ?? null;

  if (duplicate) errors.push(`${month} 已由该模板生成过账单，不能重复生成`);

  return {
    template,
    month,
    date,
    dateClamped: isDateClamped(month, template.dayOfMonth),
    amountCents,
    needsAmount,
    duplicate,
    duplicateExpenseId: existing.find((e) => !e.voided)?.id ?? null,
    voidedExpenseId,
    errors,
  };
}

/** 模板在某账期生成账单的份额计算结果 */
export function computeTemplateShares(
  template: ExpenseTemplate,
  amountCents: number,
  memberOrder: MemberId[],
): { ok: boolean; error?: string; amounts: Record<MemberId, number> } {
  const participantIds = [...template.participantIds];
  if (template.mode === 'equal') {
    return {
      ok: true,
      amounts: splitEqually(amountCents, participantIds, memberOrder, (id) => id).amounts,
    };
  }
  const check = checkCustomSplit(amountCents, template.customAmounts, participantIds);
  if (!check.ok) return { ok: false, error: check.error ?? '自定义金额合计与总额不一致', amounts: {} };
  const amounts: Record<MemberId, number> = {};
  participantIds.forEach((id) => {
    amounts[id] = template.customAmounts[id] ?? 0;
  });
  return { ok: true, amounts };
}

/** 该账期可生成的模板（启用的、且未重复） */
export function generatableTemplates(state: AppState, month: string): ExpenseTemplate[] {
  return state.templates.filter((t) => {
    if (!t.active) return false;
    return !state.expenses.some(
      (e) => e.templateId === t.id && e.periodKey === periodKeyOf(month) && !e.voided,
    );
  });
}

/** 由模板生成的账单标签，用于列表展示来源 */
export function templateLabelOf(state: AppState, expense: Expense): string | null {
  if (!expense.templateId) return null;
  const tpl = state.templates.find((t) => t.id === expense.templateId);
  return tpl ? `${tpl.name}·${expense.periodKey}` : `模板·${expense.periodKey}`;
}
