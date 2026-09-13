import { useMemo, useState } from 'react';
import { useAction, useAppState } from '../../store/hooks';
import { Amount, Empty, Field, Input, Modal, Select } from '../../ui/primitives';
import { IconCheck, IconPlus } from '../../ui/Icon';
import { useToast } from '../../ui/Toast';
import { centsToInput, formatCents, parseYuanInput } from '../../domain/money';
import { availablePeriods } from '../../domain/monthly';
import { previewTemplate } from '../../domain/templates';
import { categoryLabel, EXPENSE_CATEGORIES, type ExpenseCategory } from '../../domain/types';

interface Props {
  today: string;
}

export default function TemplatePanel({ today }: Props) {
  const toast = useToast();
  const state = useAppState();
  const run = useAction();
  const periods = useMemo(() => availablePeriods(state.expenses, today), [state.expenses, today]);
  const [month, setMonth] = useState<string>(periods[0] ?? today.slice(0, 7));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;

  const previews = useMemo(
    () =>
      state.templates.map((t) => {
        const raw = amounts[t.id];
        const parsed = raw === undefined || raw.trim() === '' ? null : parseYuanInput(raw);
        const cents = parsed && parsed.ok ? parsed.cents : null;
        return previewTemplate(state, t, month, cents);
      }),
    [state, month, amounts],
  );

  function generate(templateId: string) {
    const preview = previews.find((p) => p.template.id === templateId);
    if (!preview) return;
    if (preview.errors.length > 0) {
      toast.error(preview.errors[0]);
      return;
    }
    const okDone = run(
      {
        type: 'template/generate',
        templateId,
        month,
        amountCents: preview.needsAmount ? preview.amountCents : null,
      },
      `${preview.template.name} ${month} 账单已生成`,
    );
    if (okDone) setAmounts((prev) => ({ ...prev, [templateId]: '' }));
  }

  return (
    <>
      <div className="card">
        <div className="card__head">
          <div className="card__title">按模板生成本月账单</div>
          <div className="row" style={{ gap: 8 }}>
            <Field label="账期" htmlFor="tpl-month">
              <Select id="tpl-month" value={month} onChange={(e) => setMonth(e.target.value)}>
                {periods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        <div className="small muted">
          模板只是记账模板，不会在页面关闭时自动生成。选定账期、确认金额后才会生成账单。
        </div>

        {state.templates.length === 0 ? (
          <Empty>还没有周期模板。点下方「新建模板」添加房租、水电等每月固定支出。</Empty>
        ) : (
          <div className="list" style={{ marginTop: 10 }}>
            {previews.map((p) => (
              <div className="item" key={p.template.id}>
                <div className="item__main">
                  <div className="item__title">
                    {p.template.name}
                    <span className="badge badge--neutral">{categoryLabel(p.template.category)}</span>
                    {!p.template.active ? (
                      <span className="badge badge--own">已停用</span>
                    ) : null}
                  </div>
                  <div className="item__meta">
                    发生日期 {p.date}
                    {p.dateClamped
                      ? `（模板设为 ${p.template.dayOfMonth} 日，${month} 不足该日，取月末）`
                      : ''}{' '}
                    · {nameOf(p.template.payerId)}垫付 · {p.template.participantIds.length} 人分摊
                  </div>
                  <div className="item__meta">
                    {p.duplicate
                      ? `${month} 已生成过账单，不能重复生成`
                      : p.voidedExpenseId
                        ? `${month} 的账单已作废，可以重新生成`
                        : p.needsAmount
                          ? '该模板没有固定金额，需要填写本期金额'
                          : `固定金额 ${formatCents(p.amountCents)} 元`}
                  </div>
                  {p.needsAmount && !p.duplicate ? (
                    <div className="row" style={{ marginTop: 6 }}>
                      <Input
                        inputMode="decimal"
                        style={{ width: 120 }}
                        value={amounts[p.template.id] ?? ''}
                        onChange={(e) =>
                          setAmounts((prev) => ({ ...prev, [p.template.id]: e.target.value }))
                        }
                        placeholder="本期金额"
                        aria-label={`${p.template.name} 本期金额`}
                      />
                      <span className="tiny muted">元</span>
                    </div>
                  ) : null}
                </div>
                <div className="item__side">
                  {p.template.active ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={p.duplicate}
                      onClick={() => generate(p.template.id)}
                    >
                      生成账单
                    </button>
                  ) : (
                    <span className="tiny muted">已停用</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card__head">
          <div className="card__title">模板管理</div>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => setCreating(true)}>
            <IconPlus size={15} /> 新建模板
          </button>
        </div>
        {state.templates.length === 0 ? (
          <Empty>还没有模板。</Empty>
        ) : (
          <div className="list">
            {state.templates.map((t) => (
              <div className="item" key={t.id}>
                <div className="item__main">
                  <div className="item__title">{t.name}</div>
                  <div className="item__meta">
                    每月 {t.dayOfMonth} 日 ·{' '}
                    {t.amountCents === null ? (
                      '每期手填金额'
                    ) : (
                      <>
                        固定 <Amount cents={t.amountCents} />
                      </>
                    )}{' '}
                    · {nameOf(t.payerId)}垫付 · {t.participantIds.map(nameOf).join('、')}
                  </div>
                  {t.note ? <div className="item__meta">备注：{t.note}</div> : null}
                </div>
                <div className="item__side">
                  <button type="button" className="btn btn--sm" onClick={() => setEditing(t.id)}>
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() =>
                      run(
                        { type: 'template/toggle', templateId: t.id, active: !t.active },
                        t.active ? '模板已停用' : '模板已启用',
                      )
                    }
                  >
                    {t.active ? '停用' : '启用'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="tiny muted" style={{ marginTop: 8 }}>
          修改模板只影响之后生成的账单，已经生成的账本记录保持原样。
        </div>
      </div>

      {creating ? (
        <TemplateFormModal
          onClose={() => setCreating(false)}
        />
      ) : null}
      {editing ? (
        <TemplateFormModal
          templateId={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function TemplateFormModal({
  templateId,
  onClose,
}: {
  templateId?: string;
  onClose: () => void;
}) {
  const state = useAppState();
  const toast = useToast();
  const run = useAction();
  const existing = templateId ? state.templates.find((t) => t.id === templateId) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'rent');
  const [day, setDay] = useState(String(existing?.dayOfMonth ?? 1));
  const [fixed, setFixed] = useState(existing ? existing.amountCents !== null : true);
  const [amount, setAmount] = useState(
    existing?.amountCents != null ? centsToInput(existing.amountCents) : '',
  );
  const [payerId, setPayerId] = useState(existing?.payerId ?? state.currentMemberId);
  const [participants, setParticipants] = useState<string[]>(
    existing?.participantIds ?? state.members.map((m) => m.id),
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggleParticipant = (id: string) =>
    setParticipants((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  function submit() {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = '请填写模板名称';
    const dayNum = Number(day);
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) next.day = '请填写 1–31 之间的日期';
    if (participants.length === 0) next.participants = '请至少选择一位参与成员';

    let amountCents: number | null = null;
    if (fixed) {
      const parsed = parseYuanInput(amount);
      if (!parsed.ok || parsed.cents <= 0) next.amount = '请填写大于 0 的固定金额';
      else amountCents = parsed.cents;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const input = {
      name,
      category,
      dayOfMonth: dayNum,
      amountCents,
      payerId,
      participantIds: participants,
      mode: 'equal' as const,
      customAmounts: {},
      note,
      createdBy: state.currentMemberId,
    };
    const okDone = templateId
      ? run({ type: 'template/update', templateId, patch: input }, '模板已更新')
      : run({ type: 'template/add', input }, '模板已创建');
    if (okDone) {
      toast.success(templateId ? '模板已更新，不影响历史账单' : '模板已创建');
      onClose();
    } else {
      toast.error('保存失败，请检查填写内容');
    }
  }

  return (
    <Modal
      title={templateId ? '编辑模板' : '新建周期模板'}
      subtitle="模板只在生成账单时使用，历史账单不受后续修改影响"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            <IconCheck size={15} /> 保存模板
          </button>
        </>
      }
    >
      <Field label="名称" error={errors.name} htmlFor="tpl-name">
        <Input
          id="tpl-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 房租、水电燃气"
        />
      </Field>
      <div className="grid grid--2">
        <Field label="分类" htmlFor="tpl-cat">
          <Select
            id="tpl-cat"
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
        <Field label="每月日期" error={errors.day} htmlFor="tpl-day" hint="短月自动取当月最后一天">
          <Input
            id="tpl-day"
            inputMode="numeric"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
      </div>
      <Field label="金额方式">
        <div className="row" style={{ gap: 10 }}>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="radio"
              name="tpl-fixed"
              checked={fixed}
              onChange={() => setFixed(true)}
            />
            固定金额
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="radio"
              name="tpl-fixed"
              checked={!fixed}
              onChange={() => setFixed(false)}
            />
            每期手填（如水电）
          </label>
        </div>
      </Field>
      {fixed ? (
        <Field label="固定金额（元）" error={errors.amount} htmlFor="tpl-amount">
          <Input
            id="tpl-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </Field>
      ) : (
        <div className="small muted">生成账单时会要求填写本期实际金额，不会沿用上期数值。</div>
      )}
      <Field label="垫付人" htmlFor="tpl-payer">
        <Select id="tpl-payer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
          {state.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="参与分摊" error={errors.participants}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {state.members.map((m) => (
            <label key={m.id} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={participants.includes(m.id)}
                onChange={() => toggleParticipant(m.id)}
              />
              {m.name}
            </label>
          ))}
        </div>
      </Field>
      <Field label="备注" htmlFor="tpl-note">
        <Input id="tpl-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}
