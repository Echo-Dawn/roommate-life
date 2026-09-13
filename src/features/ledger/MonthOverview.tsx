import { useMemo, useState } from 'react';
import { Amount, Empty, Field, Input, Select } from '../../ui/primitives';
import { IconAlert, IconDoc, IconLedger } from '../../ui/Icon';
import { useToast } from '../../ui/Toast';
import { formatCents } from '../../domain/money';
import { availablePeriods, buildMonthSummary, monthSummaryText } from '../../domain/monthly';
import { categoryLabel, type AppState } from '../../domain/types';

interface Props {
  state: AppState;
  today: string;
  /** 点击未结清明细时跳到对应账单 */
  onOpenExpense: (expenseId: string, month: string) => void;
}

export default function MonthOverview({ state, today, onOpenExpense }: Props) {
  const toast = useToast();
  const periods = useMemo(() => availablePeriods(state.expenses, today), [state.expenses, today]);
  const [month, setMonth] = useState<string>(periods[0] ?? today.slice(0, 7));
  const [copied, setCopied] = useState(false);
  const [openPair, setOpenPair] = useState<string | null>(null);

  const summary = useMemo(() => buildMonthSummary(state, month), [state, month]);
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const yuan = (cents: number) => `¥${formatCents(cents)}`;
  const maxCategory = summary.categories[0]?.cents ?? 0;

  async function copySummary() {
    const text = monthSummaryText(state, month, yuan, nameOf);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success('月度摘要已复制，可自行粘贴发送');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('复制失败，请手动选择文本');
    }
  }

  return (
    <>
      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconLedger size={17} /> 月度概览
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Field label="账期" htmlFor="month-pick">
              <Select
                id="month-pick"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setOpenPair(null);
                }}
              >
                {periods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <button type="button" className="btn btn--sm" onClick={copySummary}>
              <IconDoc size={15} /> {copied ? '已复制' : '复制摘要'}
            </button>
          </div>
        </div>

        {summary.expenseCount === 0 ? (
          <Empty>
            {month} 还没有有效账单。可以点右上角「记一笔」，或到「费用模板」按模板生成本月账单。
          </Empty>
        ) : (
          <>
            <div className="grid grid--3">
              <div className="stat">
                <div className="stat__label">本月总支出</div>
                <div className="stat__value">
                  <Amount cents={summary.totalCents} />
                </div>
                <div className="stat__foot">
                  {summary.expenseCount} 笔有效账单
                  {summary.voidedCount > 0 ? ` · ${summary.voidedCount} 笔已作废不计入` : ''}
                </div>
              </div>
              <div className="stat">
                <div className="stat__label">仍未标记付款</div>
                <div className="stat__value" style={{ color: 'var(--accent)' }}>
                  <Amount cents={summary.unpaidCents} />
                </div>
                <div className="stat__foot">债务人尚未标记付款的部分</div>
              </div>
              <div className="stat">
                <div className="stat__label">已标记付款待确认</div>
                <div className="stat__value" style={{ color: 'var(--primary)' }}>
                  <Amount cents={summary.awaitingConfirmCents} />
                </div>
                <div className="stat__foot">单列统计，不与「未付」混在一起</div>
              </div>
            </div>

            <div className="divider" />

            <div className="card__title" style={{ marginBottom: 8 }}>
              分类分布
            </div>
            <div className="list">
              {summary.categories.map((c) => (
                <div className="item" key={c.category}>
                  <div className="item__main">
                    <div className="item__title">{categoryLabel(c.category)}</div>
                    <div className="bar" aria-hidden="true">
                      <span
                        className="bar__fill"
                        style={{ width: `${maxCategory ? (c.cents / maxCategory) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="item__side">
                    <Amount cents={c.cents} />
                    <div className="tiny muted">
                      {summary.totalCents
                        ? `${((c.cents / summary.totalCents) * 100).toFixed(0)}%`
                        : '0%'}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="divider" />

            <div className="card__title" style={{ marginBottom: 8 }}>
              各人承担与垫付
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>本月承担</th>
                    <th>本月垫付</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.members.map((m) => (
                    <tr key={m.memberId}>
                      <td>{nameOf(m.memberId)}</td>
                      <td>
                        <Amount cents={m.shareCents} />
                      </td>
                      <td>
                        <Amount cents={m.paidCents} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tiny muted" style={{ marginTop: 6 }}>
              个人承担包含本人作为垫付人时自己分摊的那部分；垫付是实际先付出去的金额。
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card__head">
          <div className="card__title">
            <IconAlert size={17} /> 未结清：债务人 → 垫付人
          </div>
          <span className="card__hint">点击金额可追溯原账单，不做债务抵消</span>
        </div>
        {summary.unsettled.length === 0 ? (
          <Empty>本月账单已全部结清。</Empty>
        ) : (
          <div className="list">
            {summary.unsettled.map((pair) => {
              const key = `${pair.debtorId}->${pair.creditorId}`;
              const open = openPair === key;
              return (
                <div className="item" key={key}>
                  <div className="item__main">
                    <div className="item__title">
                      {nameOf(pair.debtorId)} 应付 {nameOf(pair.creditorId)}
                    </div>
                    <div className="item__meta">
                      {pair.unpaidCents > 0 ? (
                        <span className="badge badge--unpaid">
                          待付款 <Amount cents={pair.unpaidCents} />
                        </span>
                      ) : null}{' '}
                      {pair.awaitingCents > 0 ? (
                        <span className="badge badge--awaiting">
                          待确认 <Amount cents={pair.awaitingCents} />
                        </span>
                      ) : null}
                    </div>
                    {open ? (
                      <div className="list" style={{ marginTop: 8 }}>
                        {pair.items.map((item) => (
                          <div className="item" key={`${item.expenseId}-${item.status}`}>
                            <div className="item__main">
                              <div className="item__title">{item.name}</div>
                              <div className="item__meta">
                                {item.date} ·{' '}
                                {item.status === 'awaiting_confirm' ? '已标记付款待确认' : '待付款'}
                              </div>
                            </div>
                            <div className="item__side">
                              <button
                                type="button"
                                className="btn btn--sm"
                                onClick={() => onOpenExpense(item.expenseId, month)}
                              >
                                查看账单 <Amount cents={item.cents} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="item__side">
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-expanded={open}
                      onClick={() => setOpenPair(open ? null : key)}
                    >
                      {open ? '收起' : `${pair.items.length} 笔明细`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/** 模板面板用到的金额输入（元 → 分） */
export function AmountInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={value}
      placeholder={placeholder ?? '0.00'}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
