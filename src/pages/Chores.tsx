import { useMemo, useState } from 'react';
import { useAction, useAppState } from '../store/hooks';
import {
  Avatar,
  ChoreBadge,
  Checkbox,
  Empty,
  Field,
  Input,
  Modal,
  Textarea,
} from '../ui/primitives';
import {
  IconChore,
  IconCheck,
  IconLeft,
  IconPlus,
  IconRight,
  IconSwap,
} from '../ui/Icon';
import {
  addDays,
  formatDateCN,
  startOfWeek,
  todayKey,
  weekdayLabel,
  weekdayOf,
} from '../domain/dateKey';
import { buildTasks } from '../domain/chores';
import type { ChoreTask } from '../domain/types';
import type { ChoreRuleInput } from '../store/reducer';

export default function ChoresPage() {
  const state = useAppState();
  const run = useAction();
  const today = todayKey();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [activeTask, setActiveTask] = useState<ChoreTask | null>(null);
  const [swapFrom, setSwapFrom] = useState<ChoreTask | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);

  const me = state.currentMemberId;
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const initialOf = (id: string) => state.members.find((m) => m.id === id)?.initial ?? '?';

  const query = useMemo(
    () => ({
      rules: state.choreRules,
      taskState: state.choreTaskState,
      assignments: state.choreAssignments,
      swaps: state.swapRequests,
      today,
    }),
    [state.choreRules, state.choreTaskState, state.choreAssignments, state.swapRequests, today],
  );

  const weekTasks = useMemo(
    () => buildTasks(query, weekStart, addDays(weekStart, 6)),
    [query, weekStart],
  );

  // 换班可选目标：未来 4 周内其他室友的未过期、未完成、无待确认换班的任务
  const swapCandidates = useMemo(() => {
    if (!swapFrom) return [];
    return buildTasks(query, weekStart, addDays(weekStart, 28)).filter(
      (t) =>
        t.assigneeId !== me &&
        t.status === 'pending' &&
        !t.pendingSwapId &&
        t.key !== swapFrom.key,
    );
  }, [query, swapFrom, weekStart, me]);

  const allPendingSwaps = useMemo(
    () => state.swapRequests.filter((s) => s.status === 'pending'),
    [state.swapRequests],
  );

  const taskLabel = (key: string) => {
    const [ruleId, date] = key.split('|');
    const rule = state.choreRules.find((r) => r.id === ruleId);
    return rule ? `${rule.area} · ${formatDateCN(date)}` : key;
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const isCurrentWeek = weekStart === startOfWeek(today);

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="topbar__title">清洁值日</h1>
          <div className="topbar__sub">
            {formatDateCN(weekStart)} — {formatDateCN(addDays(weekStart, 6))}
            {isCurrentWeek ? ' · 本周' : ''} · 负责人按起始日期轮换，翻周不会改变结果
          </div>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setRuleOpen(true)}>
          <IconPlus size={16} /> 新建规则
        </button>
      </div>

      <div className="card">
        <div className="row row--between" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              aria-label="上一周"
            >
              <IconLeft size={15} />
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setWeekStart(startOfWeek(today))}
            >
              回到本周
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              aria-label="下一周"
            >
              <IconRight size={15} />
            </button>
          </div>
          <div className="tiny muted">同一规则同一日期最多一个任务</div>
        </div>

        <div className="week-grid">
          {days.map((day) => {
            const dayTasks = weekTasks.filter((t) => t.date === day);
            return (
              <div
                className={`day${day === today ? ' day--today' : ''}`}
                key={day}
              >
                <div className="day__label">
                  <span>{weekdayLabel(weekdayOf(day))}</span>
                  <span style={{ color: 'var(--muted)', fontWeight: 500 }}>
                    {Number(day.slice(8, 10))}
                  </span>
                </div>
                {dayTasks.length === 0 ? (
                  <span className="tiny muted">无排班</span>
                ) : (
                  dayTasks.map((task) => (
                    <button
                      type="button"
                      key={task.key}
                      className={`chip${task.status === 'done' ? ' chip--done' : ''}${
                        task.status === 'overdue' ? ' chip--overdue' : ''
                      }${task.assigneeId === me ? ' chip--mine' : ''}`}
                      onClick={() => setActiveTask(task)}
                    >
                      <span className="chip__title">{task.area}</span>
                      <span className="chip__meta">
                        {nameOf(task.assigneeId)}
                        {task.status === 'done'
                          ? ' · 已完成'
                          : task.status === 'overdue'
                            ? ' · 待补做'
                            : ''}
                        {task.swapped ? ' · 换班' : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconSwap /> 换班申请
          </div>
          <span className="card__hint">接受后两项任务的负责人原子交换</span>
        </div>
        {allPendingSwaps.length === 0 ? (
          <Empty>当前没有待确认的换班申请。</Empty>
        ) : (
          <div className="list">
            {allPendingSwaps.map((swap) => {
              const incoming = swap.toMemberId === me;
              const outgoing = swap.fromMemberId === me;
              return (
                <div className="item" key={swap.id}>
                  <Avatar text={initialOf(swap.fromMemberId)} />
                  <div className="item__main">
                    <div className="item__title">
                      {nameOf(swap.fromMemberId)} → {nameOf(swap.toMemberId)}
                      <span className="badge badge--awaiting">待确认</span>
                    </div>
                    <div className="item__meta">
                      「{taskLabel(swap.fromTaskKey)}」换「{taskLabel(swap.toTaskKey)}」
                    </div>
                  </div>
                  <div className="item__side">
                    {incoming ? (
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
                    ) : outgoing ? (
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() =>
                          run({ type: 'swap/cancel', swapId: swap.id, by: me }, '已撤销申请')
                        }
                      >
                        撤销
                      </button>
                    ) : (
                      <span className="tiny muted">等待 {nameOf(swap.toMemberId)} 处理</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconChore /> 值日规则
          </div>
        </div>
        {state.choreRules.length === 0 ? (
          <Empty>还没有值日规则，点右上角新建。</Empty>
        ) : (
          <div className="list">
            {state.choreRules.map((rule) => (
              <div className="item" key={rule.id}>
                <div className="item__main">
                  <div className="item__title">{rule.area}</div>
                  <div className="item__meta">
                    每周 {rule.weekdays.map((d) => weekdayLabel(d)).join('、')} · 顺序{' '}
                    {rule.memberOrder.map((id) => nameOf(id)).join(' → ')}
                  </div>
                  <div className="item__meta">起始 {rule.startDate}</div>
                  <div className="item__meta">{rule.standard}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeTask ? (
        <TaskModal
          task={activeTask}
          isMine={activeTask.assigneeId === me}
          onClose={() => setActiveTask(null)}
          onComplete={(note) => {
            const okDone = run(
              { type: 'chore/complete', key: activeTask.key, by: me, note },
              '已标记完成',
            );
            if (okDone) setActiveTask(null);
          }}
          onStartSwap={() => {
            setSwapFrom(activeTask);
            setActiveTask(null);
          }}
        />
      ) : null}

      {swapFrom ? (
        <Modal
          title="发起换班"
          subtitle={`我的任务：${taskLabel(swapFrom.key)}`}
          onClose={() => setSwapFrom(null)}
          footer={
            <button type="button" className="btn" onClick={() => setSwapFrom(null)}>
              关闭
            </button>
          }
        >
          {swapCandidates.length === 0 ? (
            <Empty>
              暂无可换的任务。可选择的任务需属于其他室友、未完成、未过期且没有其他待确认换班。
            </Empty>
          ) : (
            <div className="list">
              {swapCandidates.map((task) => (
                <div className="item" key={task.key}>
                  <Avatar text={initialOf(task.assigneeId)} />
                  <div className="item__main">
                    <div className="item__title">
                      {task.area} · {formatDateCN(task.date)}
                    </div>
                    <div className="item__meta">负责人 {nameOf(task.assigneeId)}</div>
                  </div>
                  <div className="item__side">
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      onClick={() => {
                        const okDone = run(
                          {
                            type: 'swap/request',
                            fromTaskKey: swapFrom.key,
                            toTaskKey: task.key,
                            by: me,
                          },
                          '换班申请已发出',
                        );
                        if (okDone) setSwapFrom(null);
                      }}
                    >
                      选择
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}

      {ruleOpen ? <RuleFormModal onClose={() => setRuleOpen(false)} /> : null}
    </>
  );
}

function TaskModal({
  task,
  isMine,
  onClose,
  onComplete,
  onStartSwap,
}: {
  task: ChoreTask;
  isMine: boolean;
  onClose: () => void;
  onComplete: (note: string) => void;
  onStartSwap: () => void;
}) {
  const state = useAppState();
  const [note, setNote] = useState(task.state?.note ?? '');
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const done = task.status === 'done';
  const overdue = task.status === 'overdue';

  return (
    <Modal
      title={task.area}
      subtitle={`${formatDateCN(task.date)} · ${weekdayLabel(weekdayOf(task.date))}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          {isMine && !done ? (
            <button type="button" className="btn btn--primary" onClick={() => onComplete(note)}>
              <IconCheck size={15} /> {overdue ? '标记补做完成' : '标记完成'}
            </button>
          ) : null}
        </>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <ChoreBadge status={task.status} />
          {task.swapped ? <span className="badge badge--neutral">已换班</span> : null}
          {task.pendingSwapId ? (
            <span className="badge badge--awaiting">有待确认换班</span>
          ) : null}
        </div>
        <div>
          <div className="kv">
            <span className="kv__key">负责人</span>
            <span className="kv__value">
              {nameOf(task.assigneeId)}
              {task.swapped ? `（轮换原为 ${nameOf(task.rotationOwnerId)}）` : ''}
            </span>
          </div>
          <div className="kv">
            <span className="kv__key">完成标准</span>
            <span className="kv__value">{task.standard}</span>
          </div>
          {task.state ? (
            <div className="kv">
              <span className="kv__key">完成记录</span>
              <span className="kv__value">
                {nameOf(task.state.completedBy)}
                {task.state.note ? ` · ${task.state.note}` : ''}
              </span>
            </div>
          ) : null}
        </div>

        {isMine && !done ? (
          <>
            <div className="divider" />
            <Field label="完成备注（可选）" htmlFor="task-note">
              <Textarea
                id="task-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：已清扫并倒垃圾"
                maxLength={80}
              />
            </Field>
            {overdue ? (
              <div className="tiny muted">过期任务保留原负责人，可补做但不能发起换班。</div>
            ) : (
              <div className="row">
                <button type="button" className="btn btn--sm" onClick={onStartSwap}>
                  <IconSwap size={14} /> 发起换班
                </button>
                <span className="tiny muted">需选择另一位室友的未完成任务</span>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function RuleFormModal({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const run = useAction();
  const today = todayKey();
  const [area, setArea] = useState('');
  const [standard, setStandard] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [memberOrder, setMemberOrder] = useState<string[]>(state.members.map((m) => m.id));
  const [startDate, setStartDate] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function toggleDay(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  function submit() {
    const next: Record<string, string> = {};
    if (area.trim() === '') next.area = '请填写区域';
    if (standard.trim() === '') next.standard = '请填写完成标准';
    if (weekdays.length === 0) next.weekdays = '请至少选择一个执行日';
    if (memberOrder.length === 0) next.members = '请至少选择一位成员';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) next.startDate = '请选择起始日期';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const input: ChoreRuleInput = {
      area,
      standard,
      weekdays,
      memberOrder,
      startDate,
      createdBy: state.currentMemberId,
    };
    const okDone = run({ type: 'chore/addRule', input }, '值日规则已创建');
    if (okDone) onClose();
  }

  return (
    <Modal
      title="新建值日规则"
      subtitle="负责人按「起始日期 → 目标日期」之间的实际排班次数轮换"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            创建规则
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="区域" error={errors.area} htmlFor="rule-area">
          <Input
            id="rule-area"
            value={area}
            invalid={Boolean(errors.area)}
            onChange={(e) => setArea(e.target.value)}
            placeholder="例如：客厅与玄关"
            maxLength={20}
          />
        </Field>
        <Field label="完成标准" error={errors.standard} htmlFor="rule-standard">
          <Textarea
            id="rule-standard"
            value={standard}
            invalid={Boolean(errors.standard)}
            onChange={(e) => setStandard(e.target.value)}
            placeholder="例如：地面清扫拖净，茶几物品归位"
            maxLength={80}
          />
        </Field>
        <Field label="每周执行日" error={errors.weekdays}>
          <div className="grid grid--3">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <Checkbox
                key={day}
                checked={weekdays.includes(day)}
                onChange={() => toggleDay(day)}
                label={weekdayLabel(day)}
              />
            ))}
          </div>
        </Field>
        <Field label="参与成员顺序" error={errors.members} hint="决定轮换次序，越靠前越先轮到">
          <div className="grid grid--3">
            {state.members.map((m) => (
              <Checkbox
                key={m.id}
                checked={memberOrder.includes(m.id)}
                onChange={(checked) =>
                  setMemberOrder((prev) =>
                    checked
                      ? [...prev, m.id]
                      : prev.filter((x) => x !== m.id),
                  )
                }
                label={m.name}
              />
            ))}
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            当前顺序：{memberOrder.map((id) => state.members.find((m) => m.id === id)?.name).join(' → ') || '未选择'}
          </div>
        </Field>
        <Field
          label="起始日期"
          error={errors.startDate}
          hint="轮换起点，建议选一个周一"
          htmlFor="rule-start"
        >
          <Input
            id="rule-start"
            type="date"
            value={startDate}
            invalid={Boolean(errors.startDate)}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

