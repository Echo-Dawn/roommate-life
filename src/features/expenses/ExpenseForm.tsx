import { useMemo, useState } from 'react';
import { useAction, useAppState } from '../../store/hooks';
import { useToast } from '../../ui/Toast';
import { Amount, Checkbox, Field, Input, Modal, Select, Textarea } from '../../ui/primitives';
import { todayKey } from '../../domain/dateKey';
import { centsToInput, parseYuanInput } from '../../domain/money';
import { checkCustomSplit, splitEqually, stableSort } from '../../domain/split';
import { EXPENSE_CATEGORIES, type ExpenseCategory, type MemberId, type SplitMode } from '../../domain/types';
import type { ExpenseDraftInput } from '../../store/reducer';

export interface ExpenseFormProps {
  initial?: Partial<ExpenseDraftInput>;
  linkedRestockId?: string | null;
  hint?: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface Errors {
  name?: string;
  amount?: string;
  date?: string;
  payer?: string;
  participants?: string;
  custom?: string;
}

export function ExpenseFormModal({
  initial,
  linkedRestockId = null,
  hint,
  onClose,
  onSaved,
}: ExpenseFormProps) {
  const state = useAppState();
  const run = useAction();
  const toast = useToast();
  const me = state.currentMemberId;

  const [name, setName] = useState(initial?.name ?? '');
  const [amountInput, setAmountInput] = useState(
    initial?.amountCents ? centsToInput(initial.amountCents) : '',
  );
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'supplies');
  const [date, setDate] = useState(initial?.date ?? todayKey());
  const [payerId, setPayerId] = useState<MemberId>(initial?.payerId ?? me);
  const [participants, setParticipants] = useState<MemberId[]>(
    initial?.participantIds ?? state.members.map((m) => m.id),
  );
  const [mode, setMode] = useState<SplitMode>(initial?.mode ?? 'equal');
  const [custom, setCustom] = useState<Record<MemberId, string>>({});
  const [note, setNote] = useState(initial?.note ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const nameOf = (id: MemberId) => state.members.find((m) => m.id === id)?.name ?? id;
  const order = state.members.map((m) => m.id);
  const ordered = useMemo(() => stableSort(participants, order), [participants, order]);

  const parsed = parseYuanInput(amountInput);
  const amountCents = parsed.ok ? parsed.cents : 0;

  const equalResult = useMemo(
    () => splitEqually(amountCents, participants, order, nameOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [amountCents, participants.join(','), order.join(','), state.members],
  );

  const customValues = useMemo(() => {
    const result: Record<MemberId, number> = {};
    ordered.forEach((id) => {
      const raw = custom[id] ?? '';
      const parsedValue = parseYuanInput(raw);
      result[id] = parsedValue.ok ? parsedValue.cents : 0;
    });
    return result;
  }, [custom, ordered]);

  const customCheck = checkCustomSplit(amountCents, customValues, ordered);

  const preview = useMemo(() => {
    if (mode === 'equal') {
      return ordered.map((id) => ({ id, cents: equalResult.amounts[id] ?? 0 }));
    }
    return ordered.map((id) => ({ id, cents: customValues[id] ?? 0 }));
  }, [mode, ordered, equalResult, customValues]);

  const payerParticipates = participants.includes(payerId);

  function toggleParticipant(id: MemberId) {
    setParticipants((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function validate(): Errors {
    const next: Errors = {};
    if (name.trim() === '') next.name = '请填写账单名称';
    if (!parsed.ok) next.amount = parsed.error ?? '金额不正确';
    else if (parsed.cents <= 0) next.amount = '总额必须大于 0 元';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) next.date = '请选择发生日期';
    if (!state.members.some((m) => m.id === payerId)) next.payer = '请选择付款人';
    if (participants.length === 0) next.participants = '参与分摊的成员不能为空';
    if (mode === 'custom' && parsed.ok && !customCheck.ok) next.custom = customCheck.error;
    return next;
  }

  function submit() {
    if (submitting) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error('请先修正表单中的问题');
      return;
    }
    setSubmitting(true);
    const okDone = run(
      {
        type: 'expense/add',
        input: {
          name,
          amountCents,
          category,
          date,
          payerId,
          participantIds: participants,
          mode,
          customAmounts: customValues,
          note,
          createdBy: me,
          linkedRestockId,
        },
      },
      '账单已记录',
    );
    setSubmitting(false);
    if (okDone) {
      onSaved?.();
      onClose();
    }
  }

  return (
    <Modal
      title="记一笔"
      subtitle={
        hint ?? '金额按整数分计算；平均分摊余数按固定成员顺序分配，合计严格等于总额。'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? '提交中…' : '提交账单'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="名称" error={errors.name} htmlFor="expense-name">
          <Input
            id="expense-name"
            value={name}
            invalid={Boolean(errors.name)}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：9 月水电燃气"
            maxLength={40}
          />
        </Field>

        <div className="grid grid--2">
          <Field label="金额（元）" error={errors.amount} htmlFor="expense-amount">
            <Input
              id="expense-amount"
              value={amountInput}
              invalid={Boolean(errors.amount)}
              onChange={(e) => setAmountInput(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </Field>
          <Field label="分类" htmlFor="expense-category">
            <Select
              id="expense-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid--2">
          <Field label="发生日期" error={errors.date} htmlFor="expense-date">
            <Input
              id="expense-date"
              type="date"
              value={date}
              invalid={Boolean(errors.date)}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="付款人" error={errors.payer} hint="垫付并收款的成员" htmlFor="expense-payer">
            <Select
              id="expense-payer"
              value={payerId}
              invalid={Boolean(errors.payer)}
              onChange={(e) => setPayerId(e.target.value)}
            >
              {state.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="参与分摊的成员"
          error={errors.participants}
          hint={
            payerParticipates
              ? '付款人参与分摊时，其本人份额无需结算，也不会产生向自己的付款。'
              : '付款人未参与分摊，全部金额由所选成员承担。'
          }
        >
          <div className="grid grid--3">
            {state.members.map((m) => (
              <Checkbox
                key={m.id}
                checked={participants.includes(m.id)}
                onChange={() => toggleParticipant(m.id)}
                label={m.name}
              />
            ))}
          </div>
        </Field>

        <Field label="分摊方式">
          <div className="tabs">
            <button
              type="button"
              className={`tab${mode === 'equal' ? ' tab--active' : ''}`}
              onClick={() => setMode('equal')}
            >
              平均分摊
            </button>
            <button
              type="button"
              className={`tab${mode === 'custom' ? ' tab--active' : ''}`}
              onClick={() => setMode('custom')}
            >
              自定义金额
            </button>
          </div>
        </Field>

        {mode === 'custom' ? (
          <Field
            label="各人承担金额（元）"
            error={errors.custom}
            hint={`当前合计 ${(customCheck.total / 100).toFixed(2)} 元，需与总额 ${(amountCents / 100).toFixed(2)} 元完全一致。`}
          >
            <div className="grid grid--3">
              {ordered.map((id) => (
                <div key={id} className="field">
                  <span className="field__label">{nameOf(id)}</span>
                  <Input
                    value={custom[id] ?? ''}
                    onChange={(e) => setCustom((prev) => ({ ...prev, [id]: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0.00"
                    invalid={Boolean(errors.custom) && !customCheck.ok}
                  />
                </div>
              ))}
            </div>
          </Field>
        ) : null}

        <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
          <div className="card__title small">分摊预览</div>
          <div style={{ marginTop: 8 }}>
            {preview.length === 0 ? (
              <div className="small muted">请选择参与分摊的成员</div>
            ) : (
              preview.map((row) => (
                <div className="preview-row" key={row.id}>
                  <span>
                    {nameOf(row.id)}
                    {row.id === payerId ? ' · 付款人' : ''}
                  </span>
                  <Amount cents={row.cents} />
                </div>
              ))
            )}
            <div className="preview-row" style={{ fontWeight: 650 }}>
              <span>合计</span>
              <Amount cents={preview.reduce((acc, r) => acc + r.cents, 0)} />
            </div>
          </div>
          {mode === 'equal' && amountCents > 0 ? (
            <div className="tiny muted" style={{ marginTop: 8 }}>
              {equalResult.explanation}
            </div>
          ) : null}
        </div>

        <Field label="备注（可选）" htmlFor="expense-note">
          <Textarea
            id="expense-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：账单已出，按户号均摊"
            maxLength={120}
          />
        </Field>
      </div>
    </Modal>
  );
}
