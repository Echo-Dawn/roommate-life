import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAction, useAppState } from '../store/hooks';
import {
  Amount,
  Avatar,
  ChoreBadge,
  DisputeBadge,
  Empty,
  Modal,
  ShareBadge,
  SupplyBadge,
  Textarea,
} from '../ui/primitives';
import { ExpenseFormModal } from '../features/expenses/ExpenseForm';
import {
  IconAlert,
  IconCheck,
  IconChore,
  IconClock,
  IconDoc,
  IconPlus,
  IconSupply,
  IconSwap,
} from '../ui/Icon';
import { addDays, formatDateCN, startOfWeek, todayKey, weekdayLabel, weekdayOf } from '../domain/dateKey';
import { buildTasks } from '../domain/chores';
import { openDisputes, sharesAwaitingMyConfirm, summarizeFor } from '../domain/expenses';
import { needsMyConfirmation, pendingVersion } from '../domain/pact';
import { sortByUrgency, supplyStatus } from '../domain/supplies';
import type { ChoreTask } from '../domain/types';

export default function HomePage() {
  const state = useAppState();
  const run = useAction();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [completeTask, setCompleteTask] = useState<ChoreTask | null>(null);

  const me = state.currentMemberId;
  const today = todayKey();
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const initialOf = (id: string) => state.members.find((m) => m.id === id)?.initial ?? '?';
  const meName = nameOf(me);

  const summary = useMemo(() => summarizeFor(state, me), [state, me]);

  const { todayTasks, overdueTasks } = useMemo(() => {
    const weekStart = startOfWeek(today);
    const tasks = buildTasks(
      {
        rules: state.choreRules,
        taskState: state.choreTaskState,
        assignments: state.choreAssignments,
        swaps: state.swapRequests,
        today,
      },
      addDays(weekStart, -21),
      addDays(weekStart, 21),
    );
    return {
      todayTasks: tasks.filter((t) => t.date === today),
      overdueTasks: tasks.filter((t) => t.status === 'overdue'),
    };
  }, [state.choreRules, state.choreTaskState, state.choreAssignments, state.swapRequests, today]);

  const lowSupplies = useMemo(
    () => sortByUrgency(state.supplies).filter((item) => supplyStatus(item) !== 'ok'),
    [state.supplies],
  );

  const toConfirm = useMemo(() => sharesAwaitingMyConfirm(state, me), [state, me]);
  const incomingSwaps = useMemo(
    () => state.swapRequests.filter((s) => s.status === 'pending' && s.toMemberId === me),
    [state.swapRequests, me],
  );
  const myOutgoingSwaps = useMemo(
    () => state.swapRequests.filter((s) => s.status === 'pending' && s.fromMemberId === me),
    [state.swapRequests, me],
  );
  const disputes = useMemo(() => openDisputes(state, me), [state, me]);
  const pendingPact = pendingVersion(state);
  const pactNeedsMe = needsMyConfirmation(state, me);

  const taskLabel = (key: string) => {
    const [ruleId, date] = key.split('|');
    const rule = state.choreRules.find((r) => r.id === ruleId);
    return rule ? `${rule.area}（${formatDateCN(date)}）` : key;
  };

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="topbar__title">{state.homeName}</h1>
          <div className="topbar__sub">
            {formatDateCN(today)} · {weekdayLabel(weekdayOf(today))} · 当前身份：{meName}
          </div>
        </div>
        <span className="notice-demo">
          <IconAlert size={13} /> 本机演示 · 数据仅保存在当前浏览器
        </span>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn--primary" onClick={() => setFormOpen(true)}>
            <IconPlus size={16} /> 记一笔
          </button>
          <button type="button" className="btn" onClick={() => navigate('/chores')}>
            <IconChore size={16} /> 查看值日
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate('/supplies', { state: { openItemForm: true } })}
          >
            <IconSupply size={16} /> 登记物品
          </button>
        </div>
      </div>

      <div className="grid grid--3">
        <div className="stat">
          <div className="stat__label">我应付（待付款）</div>
          <div className="stat__value" style={{ color: 'var(--accent)' }}>
            <Amount cents={summary.payableCents} />
          </div>
          <div className="stat__foot">
            {summary.payableDisputedCents > 0
              ? `其中 ${(summary.payableDisputedCents / 100).toFixed(2)} 元有异议，暂停付款`
              : '点开账本可逐笔标记付款'}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">我应收（未结清）</div>
          <div className="stat__value" style={{ color: 'var(--primary)' }}>
            <Amount cents={summary.receivableCents} />
          </div>
          <div className="stat__foot">
            其中待我确认 <Amount cents={summary.awaitingConfirmCents} />
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">待我处理</div>
          <div className="stat__value">{toConfirm.length + incomingSwaps.length + (pactNeedsMe ? 1 : 0)}</div>
          <div className="stat__foot">
            收款确认 {toConfirm.length} · 换班 {incomingSwaps.length} · 公约{' '}
            {pactNeedsMe ? 1 : 0}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card__head">
          <div className="card__title">
            <IconChore /> 今日值日
          </div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => navigate('/chores')}>
            全部值日
          </button>
        </div>
        {todayTasks.length === 0 ? (
          <Empty>今天没有排班任务。</Empty>
        ) : (
          <div className="list">
            {todayTasks.map((task) => (
              <div className="item" key={task.key}>
                <Avatar text={initialOf(task.assigneeId)} />
                <div className="item__main">
                  <div className="item__title">
                    {task.area}
                    <ChoreBadge status={task.status} />
                    {task.assigneeId === me ? (
                      <span className="badge badge--neutral">我的任务</span>
                    ) : null}
                    {task.swapped ? <span className="badge badge--neutral">已换班</span> : null}
                  </div>
                  <div className="item__meta">
                    负责人 {nameOf(task.assigneeId)} · {task.standard}
                  </div>
                </div>
                <div className="item__side">
                  {task.assigneeId === me && task.status !== 'done' ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      onClick={() => setCompleteTask(task)}
                    >
                      完成
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {overdueTasks.length > 0 ? (
          <>
            <div className="divider" />
            <div className="card__title small" style={{ marginBottom: 8 }}>
              <IconClock size={15} /> 待补做（{overdueTasks.length}）
            </div>
            <div className="list">
              {overdueTasks.map((task) => (
                <div className="item" key={task.key}>
                  <Avatar text={initialOf(task.assigneeId)} />
                  <div className="item__main">
                    <div className="item__title">
                      {task.area} · {formatDateCN(task.date)}
                      <ChoreBadge status={task.status} />
                    </div>
                    <div className="item__meta">
                      原负责人 {nameOf(task.assigneeId)}（过期不自动转给下一位）
                    </div>
                  </div>
                  <div className="item__side">
                    {task.assigneeId === me ? (
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => setCompleteTask(task)}
                      >
                        补做
                      </button>
                    ) : (
                      <span className="tiny muted">由 {nameOf(task.assigneeId)} 补做</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconSupply /> 需要补货的物品
          </div>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => navigate('/supplies')}
          >
            物品清单
          </button>
        </div>
        {lowSupplies.length === 0 ? (
          <Empty>所有公共物品余量充足。</Empty>
        ) : (
          <div className="list">
            {lowSupplies.map((item) => (
              <div className="item" key={item.id}>
                <div className="item__main">
                  <div className="item__title">
                    {item.name}
                    <SupplyBadge status={supplyStatus(item)} />
                  </div>
                  <div className="item__meta">
                    余量 {item.stock}
                    {item.unit} / 满量 {item.fullStock}
                    {item.unit} · {item.location}
                  </div>
                </div>
                <div className="item__side">
                  {item.claim ? (
                    <span className="tiny muted">认领人：{nameOf(item.claim.memberId)}</span>
                  ) : (
                    <span className="tiny muted">暂无认领</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="tiny muted" style={{ marginTop: 8 }}>
          余量 ≤ 2 视为「快用完」，归零为「已用完」。
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconCheck /> 待我确认
          </div>
        </div>

        {toConfirm.length === 0 && incomingSwaps.length === 0 && !pactNeedsMe ? (
          <Empty>没有等待你确认的事项。</Empty>
        ) : (
          <div className="list">
            {toConfirm.map((view) => (
              <div className="item" key={`${view.expense.id}-${view.share.memberId}`}>
                <Avatar text={initialOf(view.share.memberId)} />
                <div className="item__main">
                  <div className="item__title">
                    收款确认 · {view.expense.name}
                    <ShareBadge status={view.status} />
                  </div>
                  <div className="item__meta">
                    {nameOf(view.share.memberId)} 已标记付款 <Amount cents={view.share.amountCents} />
                    ，等待你确认收到
                  </div>
                </div>
                <div className="item__side">
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={() =>
                      run(
                        {
                          type: 'share/confirm',
                          expenseId: view.expense.id,
                          memberId: view.share.memberId,
                          by: me,
                        },
                        '已确认收款',
                      )
                    }
                  >
                    确认收到
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => navigate('/ledger')}
                  >
                    查看账单
                  </button>
                </div>
              </div>
            ))}

            {incomingSwaps.map((swap) => (
              <div className="item" key={swap.id}>
                <Avatar text={initialOf(swap.fromMemberId)} />
                <div className="item__main">
                  <div className="item__title">
                    换班请求
                    <span className="badge badge--awaiting">待你处理</span>
                  </div>
                  <div className="item__meta">
                    {nameOf(swap.fromMemberId)} 想用「{taskLabel(swap.fromTaskKey)}」换你的「
                    {taskLabel(swap.toTaskKey)}」
                  </div>
                </div>
                <div className="item__side">
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      onClick={() =>
                        run({ type: 'swap/accept', swapId: swap.id, by: me }, '已接受换班')
                      }
                    >
                      接受
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        run({ type: 'swap/reject', swapId: swap.id, by: me }, '已拒绝换班')
                      }
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {pactNeedsMe && pendingPact ? (
              <div className="item">
                <span className="avatar">{initialOf(pendingPact.createdBy)}</span>
                <div className="item__main">
                  <div className="item__title">
                    室友公约 v{pendingPact.version}
                    <span className="badge badge--awaiting">待确认</span>
                  </div>
                  <div className="item__meta">
                    {nameOf(pendingPact.createdBy)} 提交了新版本，需全员确认后生效
                  </div>
                </div>
                <div className="item__side">
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={() => navigate('/nest')}
                  >
                    前往确认
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {myOutgoingSwaps.length > 0 ? (
          <>
            <div className="divider" />
            <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>
              我发起的换班（等待对方处理）
            </div>
            <div className="list">
              {myOutgoingSwaps.map((swap) => (
                <div className="item" key={swap.id}>
                  <IconSwap size={18} />
                  <div className="item__main">
                    <div className="item__meta">
                      我的「{taskLabel(swap.fromTaskKey)}」换 {nameOf(swap.toMemberId)} 的「
                      {taskLabel(swap.toTaskKey)}」
                    </div>
                  </div>
                  <div className="item__side">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        run({ type: 'swap/cancel', swapId: swap.id, by: me }, '已撤销申请')
                      }
                    >
                      撤销
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {disputes.length > 0 ? (
          <>
            <div className="divider" />
            <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>
              与我相关的异议
            </div>
            <div className="list">
              {disputes.map((view) => (
                <div className="item" key={`${view.expense.id}-${view.share.memberId}`}>
                  <IconAlert size={18} />
                  <div className="item__main">
                    <div className="item__title">
                      {view.expense.name} · {nameOf(view.share.memberId)}
                      <DisputeBadge />
                      <ShareBadge status={view.status} />
                    </div>
                    <div className="item__meta">{view.share.dispute?.reason}</div>
                  </div>
                  <div className="item__side">
                    {view.canWithdrawDispute ? (
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() =>
                          run(
                            {
                              type: 'share/withdrawDispute',
                              expenseId: view.expense.id,
                              memberId: view.share.memberId,
                              by: me,
                            },
                            '异议已撤回',
                          )
                        }
                      >
                        撤回异议
                      </button>
                    ) : (
                      <span className="tiny muted">
                        由 {nameOf(view.share.dispute?.raisedBy ?? '')} 提出
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {formOpen ? <ExpenseFormModal onClose={() => setFormOpen(false)} /> : null}

      {completeTask ? (
        <CompleteTaskModal task={completeTask} onClose={() => setCompleteTask(null)} />
      ) : null}
    </>
  );
}

function CompleteTaskModal({ task, onClose }: { task: ChoreTask; onClose: () => void }) {
  const appState = useAppState();
  const run = useAction();
  const [note, setNote] = useState('');
  return (
    <Modal
      title={task.status === 'overdue' ? '补做任务' : '完成任务'}
      subtitle={`${task.area} · ${formatDateCN(task.date)}`}
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
              const okDone = run(
                {
                  type: 'chore/complete',
                  key: task.key,
                  by: appState.currentMemberId,
                  note,
                },
                '已标记完成',
              );
              if (okDone) onClose();
            }}
          >
            确认完成
          </button>
        </>
      }
    >
      <div className="small muted" style={{ marginBottom: 10 }}>
        完成标准：{task.standard}
      </div>
      <div className="field">
        <label className="field__label" htmlFor="chore-note">
          备注（可选）
        </label>
        <Textarea
          id="chore-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如：地面已拖净，垃圾已倒"
          maxLength={80}
        />
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>
        <IconDoc size={13} /> 过期任务保留原负责人，不会自动转给下一位。
      </div>
    </Modal>
  );
}
