import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAction, useAppState } from '../store/hooks';
import {
  Amount,
  Avatar,
  DisputeBadge,
  Empty,
  Field,
  Modal,
  ShareBadge,
  Textarea,
} from '../ui/primitives';
import { ExpenseFormModal } from '../features/expenses/ExpenseForm';
import MonthOverview from '../features/ledger/MonthOverview';
import TemplatePanel from '../features/ledger/TemplatePanel';
import { IconAlert, IconCheck, IconPlus, IconTrash } from '../ui/Icon';
import {
  DEFAULT_EXPENSE_FILTER,
  availableMonths,
  buildShareView,
  canVoidExpense,
  matchesFilter,
  summarizeFor,
  MINE_FILTER_LABELS,
  type ExpenseFilter,
  type MySettleFilter,
} from '../domain/expenses';
import { categoryLabel, type Expense, type ExpenseCategory, type ShareView } from '../domain/types';
import { formatMonthCN, todayKey } from '../domain/dateKey';

const MINE_FILTERS: { value: MySettleFilter; label: string }[] = [
  { value: 'all', label: MINE_FILTER_LABELS.all },
  { value: 'unpaid', label: MINE_FILTER_LABELS.unpaid },
  { value: 'awaiting_confirm', label: MINE_FILTER_LABELS.awaiting_confirm },
  { value: 'receivable', label: MINE_FILTER_LABELS.receivable },
  { value: 'settled', label: MINE_FILTER_LABELS.settled },
  { value: 'voided', label: MINE_FILTER_LABELS.voided },
];

export default function LedgerPage() {
  const state = useAppState();
  const run = useAction();
  const location = useLocation();
  const [filter, setFilter] = useState<ExpenseFilter>(DEFAULT_EXPENSE_FILTER);
  const [formOpen, setFormOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<ShareView | null>(null);
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);
  const [tab, setTab] = useState<'bills' | 'month' | 'templates'>('bills');

  // 支持从首页金额卡带着筛选条件跳转过来
  useEffect(() => {
    const incoming = (location.state as { filter?: Partial<ExpenseFilter> } | null)?.filter;
    if (incoming) setFilter((prev) => ({ ...prev, ...incoming }));
    const target = (location.state as { tab?: 'bills' | 'month' | 'templates' } | null)?.tab;
    if (target) setTab(target);
  }, [location.state]);

  const me = state.currentMemberId;
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const initialOf = (id: string) => state.members.find((m) => m.id === id)?.initial ?? '?';

  const months = useMemo(() => availableMonths(state.expenses), [state.expenses]);

  const visible = useMemo(
    () => state.expenses.filter((e) => matchesFilter(e, filter, me)),
    [state.expenses, filter, me],
  );

  const summary = useMemo(() => summarizeFor(state, me), [state, me]);
  const filteredTotal = visible
    .filter((e) => !e.voided)
    .reduce((acc, e) => acc + e.amountCents, 0);

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="topbar__title">账本</h1>
          <div className="topbar__sub">
            共 {state.expenses.filter((e) => !e.voided).length} 笔有效账单 · 当前筛选{' '}
            {visible.length} 笔 · 合计 <Amount cents={filteredTotal} />
          </div>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setFormOpen(true)}>
          <IconPlus size={16} /> 记一笔
        </button>
      </div>

      <div className="tabs" role="tablist" aria-label="账本视图">
        {(
          [
            { key: 'bills', label: '账单列表' },
            { key: 'month', label: '月度概览' },
            { key: 'templates', label: '费用模板' },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`tabs__btn${tab === item.key ? ' tabs__btn--active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'month' ? (
        <MonthOverview
          state={state}
          today={todayKey()}
          onOpenExpense={(expenseId, month) => {
            setTab('bills');
            setFilter({ month, category: 'all', mine: 'all' });
            setExpanded(expenseId);
            window.requestAnimationFrame(() => {
              document.getElementById(`expense-${expenseId}`)?.scrollIntoView({ block: 'center' });
            });
          }}
        />
      ) : null}

      {tab === 'templates' ? <TemplatePanel today={todayKey()} /> : null}

      {tab === 'bills' ? (
        <>
          <div className="card">
        <div className="grid grid--3">
          <div className="stat">
            <div className="stat__label">我的待付款</div>
            <div className="stat__value" style={{ color: 'var(--accent)' }}>
              <Amount cents={summary.payableCents} />
            </div>
            <div className="stat__foot">
              {summary.payableDisputedCents > 0
                ? `其中 ${(summary.payableDisputedCents / 100).toFixed(2)} 元处于异议，暂不能付款`
                : '尚未标记付款的部分'}
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">我的待收款</div>
            <div className="stat__value" style={{ color: 'var(--primary)' }}>
              <Amount cents={summary.receivableCents} />
            </div>
            <div className="stat__foot">
              其中待我确认 <Amount cents={summary.awaitingConfirmCents} />
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">结算链路</div>
            <div className="small" style={{ marginTop: 6 }}>
              待付款 → 标记已付 → 待收款人确认 → 确认收到 → 已结清
            </div>
            <div className="stat__foot">每一步都只由对应身份操作</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="grid grid--3">
          <div className="field">
            <label className="field__label" htmlFor="filter-month">
              月份
            </label>
            <select
              id="filter-month"
              className="select"
              value={filter.month}
              onChange={(e) => setFilter((f) => ({ ...f, month: e.target.value }))}
            >
              <option value="all">全部月份</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthCN(`${m}-01`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="filter-category">
              分类
            </label>
            <select
              id="filter-category"
              className="select"
              value={filter.category}
              onChange={(e) =>
                setFilter((f) => ({ ...f, category: e.target.value as ExpenseCategory | 'all' }))
              }
            >
              <option value="all">全部分类</option>
              <option value="rent">房租</option>
              <option value="utility">水电燃气</option>
              <option value="network">网络</option>
              <option value="supplies">公共物品</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="filter-mine">
              我的结算状态
            </label>
            <select
              id="filter-mine"
              className="select"
              value={filter.mine}
              onChange={(e) => setFilter((f) => ({ ...f, mine: e.target.value as MySettleFilter }))}
            >
              {MINE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          {filter.mine === 'receivable'
            ? '收款视角：只显示你垫付、且还有室友尚未结清的账单，与「我的待确认」不同，后者只统计已标记付款等你确认的份额。'
            : '“我的结算状态”按你本人承担的份额筛选；“我垫付待收款”是收款视角，按你垫付且他人未结清筛选。'}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <Empty>
            当前筛选（{MINE_FILTER_LABELS[filter.mine]}
            {filter.month !== 'all' ? ` · ${formatMonthCN(`${filter.month}-01`)}` : ''}）下没有账单。
            可切换到「全部账单」，或点右上角「记一笔」。
          </Empty>
        </div>
      ) : (
        <div className="list" style={{ marginTop: 14 }}>
          {visible.map((expense) => {
            const views = expense.shares.map((s) => buildShareView(expense, s, me));
            const myView = views.find((v) => v.share.memberId === me);
            const isOpen = expanded === expense.id;
            const canVoid = canVoidExpense(expense, me);
            return (
              <div className="card" key={expense.id} id={`expense-${expense.id}`} style={{ opacity: expense.voided ? 0.62 : 1 }}>
                <div className="card__head">
                  <div style={{ minWidth: 0 }}>
                    <div className="item__title">
                      <span>{expense.name}</span>
                      <span className="badge badge--neutral">{categoryLabel(expense.category)}</span>
                      {expense.voided ? <span className="badge badge--dispute">已作废</span> : null}
                      {expense.mode === 'custom' ? (
                        <span className="badge badge--neutral">自定义分摊</span>
                      ) : null}
                    </div>
                    <div className="item__meta">
                      {expense.date} · {nameOf(expense.payerId)}垫付 ·{' '}
                      {expense.participantIds.length} 人分摊
                    </div>
                  </div>
                  <div className="item__side">
                    <Amount cents={expense.amountCents} large />
                    {myView ? (
                      <div className="row" style={{ gap: 6 }}>
                        <ShareBadge status={myView.status} />
                        {myView.disputed ? <DisputeBadge /> : null}
                      </div>
                    ) : (
                      <span className="tiny muted">我未参与分摊</span>
                    )}
                  </div>
                </div>

                {myView && myView.status !== 'own' ? (
                  <div className="small muted" style={{ marginBottom: 8 }}>
                    我的份额 <Amount cents={myView.share.amountCents} /> ·{' '}
                    {myView.status === 'unpaid'
                      ? '等待我标记付款'
                      : myView.status === 'awaiting_confirm'
                        ? `已标记付款，等待 ${nameOf(expense.payerId)} 确认`
                        : '已结清'}
                  </div>
                ) : null}

                <div className="row">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setExpanded(isOpen ? null : expense.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? '收起详情' : '查看分摊详情'}
                  </button>
                  {canVoid ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() => setVoidTarget(expense)}
                    >
                      <IconTrash size={14} /> 作废
                    </button>
                  ) : null}
                </div>

                {isOpen ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="divider" />
                    <div className="small muted">
                      付款人：{nameOf(expense.payerId)} · 原始金额{' '}
                      <Amount cents={expense.amountCents} /> · 分摊方式：
                      {expense.mode === 'equal' ? '平均分摊' : '自定义金额'}
                    </div>
                    {expense.note ? (
                      <div className="small muted" style={{ marginTop: 4 }}>
                        备注：{expense.note}
                      </div>
                    ) : null}
                    <div className="table-scroll">
                      <table className="table" style={{ marginTop: 10 }}>
                        <thead>
                          <tr>
                            <th>成员</th>
                            <th>承担金额</th>
                            <th>状态</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                      <tbody>
                        {views.map((view) => (
                          <tr key={view.share.memberId}>
                            <td>
                              <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                                <Avatar text={initialOf(view.share.memberId)} />
                                {nameOf(view.share.memberId)}
                                {view.share.memberId === expense.payerId ? (
                                  <span className="tiny muted">付款人</span>
                                ) : null}
                              </span>
                            </td>
                            <td>
                              <Amount cents={view.share.amountCents} />
                            </td>
                            <td>
                              <span className="row" style={{ gap: 4 }}>
                                <ShareBadge status={view.status} />
                                {view.disputed ? <DisputeBadge /> : null}
                              </span>
                              {view.disputed ? (
                                <div className="tiny muted" style={{ marginTop: 4 }}>
                                  异议：{view.share.dispute?.reason}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              <div className="row" style={{ gap: 6 }}>
                                {view.canMarkPaid ? (
                                  <button
                                    type="button"
                                    className="btn btn--sm btn--primary"
                                    onClick={() =>
                                      run(
                                        {
                                          type: 'share/markPaid',
                                          expenseId: expense.id,
                                          memberId: view.share.memberId,
                                          by: me,
                                        },
                                        '已标记付款，等待对方确认',
                                      )
                                    }
                                  >
                                    标记已付款
                                  </button>
                                ) : null}
                                {view.canConfirm ? (
                                  <button
                                    type="button"
                                    className="btn btn--sm btn--primary"
                                    onClick={() =>
                                      run(
                                        {
                                          type: 'share/confirm',
                                          expenseId: expense.id,
                                          memberId: view.share.memberId,
                                          by: me,
                                        },
                                        '已确认收款，该份额结清',
                                      )
                                    }
                                  >
                                    <IconCheck size={14} /> 确认收到
                                  </button>
                                ) : null}
                                {view.canRaiseDispute ? (
                                  <button
                                    type="button"
                                    className="btn btn--sm"
                                    onClick={() => setDisputeTarget(view)}
                                  >
                                    <IconAlert size={14} /> 提出异议
                                  </button>
                                ) : null}
                                {view.canWithdrawDispute ? (
                                  <button
                                    type="button"
                                    className="btn btn--sm"
                                    onClick={() =>
                                      run(
                                        {
                                          type: 'share/withdrawDispute',
                                          expenseId: expense.id,
                                          memberId: view.share.memberId,
                                          by: me,
                                        },
                                        '异议已撤回，恢复原结算状态',
                                      )
                                    }
                                  >
                                    撤回异议
                                  </button>
                                ) : null}
                                {!view.canMarkPaid &&
                                !view.canConfirm &&
                                !view.canRaiseDispute &&
                                !view.canWithdrawDispute ? (
                                  <span className="tiny muted">
                                    {view.status === 'own'
                                      ? '本人份额无需结算'
                                      : view.status === 'settled'
                                        ? '已结清'
                                        : '当前身份不可操作'}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    {(expense.shares.some((s) => (s.disputeLog?.length ?? 0) > 0)) ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="small" style={{ fontWeight: 600 }}>
                          异议记录
                        </div>
                        {expense.shares.flatMap((s) =>
                          (s.disputeLog ?? []).map((entry, index) => (
                            <div className="tiny muted" key={`${s.memberId}-${index}`}>
                              {entry.action === 'raise' ? '提出' : '撤回'} · {nameOf(entry.by)} ·{' '}
                              {entry.reason}
                            </div>
                          )),
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
        </>
      ) : null}

      {formOpen ? <ExpenseFormModal onClose={() => setFormOpen(false)} /> : null}

      {disputeTarget ? (
        <DisputeModal
          view={disputeTarget}
          memberName={nameOf(disputeTarget.share.memberId)}
          onClose={() => setDisputeTarget(null)}
          onSubmit={(reason) => {
            const okDone = run(
              {
                type: 'share/dispute',
                expenseId: disputeTarget.expense.id,
                memberId: disputeTarget.share.memberId,
                by: me,
                reason,
              },
              '异议已记录，该份额暂停结算',
            );
            if (okDone) setDisputeTarget(null);
          }}
        />
      ) : null}

      {voidTarget ? (
        <Modal
          title="作废账单"
          onClose={() => setVoidTarget(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setVoidTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  const okDone = run(
                    { type: 'expense/void', expenseId: voidTarget.id, by: me },
                    '账单已作废，不再计入汇总',
                  );
                  if (okDone) setVoidTarget(null);
                }}
              >
                确认作废
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            将作废「{voidTarget.name}」（<Amount cents={voidTarget.amountCents} />）。
          </p>
          <p className="small muted">
            作废后记录仍保留在历史中，但不再计入任何汇总与待办。仅创建者在无人标记付款、无人结清时可作废。
          </p>
        </Modal>
      ) : null}
    </>
  );
}

function DisputeModal({
  view,
  memberName,
  onClose,
  onSubmit,
}: {
  view: ShareView;
  memberName: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title="提出异议"
      subtitle={`${memberName} · ${(view.share.amountCents / 100).toFixed(2)} 元`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              if (reason.trim() === '') {
                setError('请填写异议原因');
                return;
              }
              onSubmit(reason);
            }}
          >
            提交异议
          </button>
        </>
      }
    >
      <Field
        label="异议原因"
        error={error}
        hint="异议保留原有结算状态，并在解决前暂停该份额的付款与确认操作。"
      >
        <Textarea
          value={reason}
          invalid={Boolean(error)}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError('');
          }}
          placeholder="例如：这个月我有 10 天不在家，希望按实际天数调整。"
          maxLength={120}
        />
      </Field>
    </Modal>
  );
}
