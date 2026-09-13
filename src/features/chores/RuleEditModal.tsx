import { useMemo, useState } from 'react';
import { useAction, useAppState } from '../../store/hooks';
import { Checkbox, Field, Input, Modal, Select } from '../../ui/primitives';
import { IconCheck } from '../../ui/Icon';
import { addDays, formatDateCN, todayKey, weekdayLabel } from '../../domain/dateKey';
import { isPausing, previewRuleChange } from '../../domain/chores';
import type { ChoreRule, MemberId } from '../../domain/types';

interface Props {
  rule: ChoreRule;
  onClose: () => void;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/**
 * 规则调整：只追加新版本并从「最早次日」生效，
 * 提交前展示影响范围，历史任务与历史负责人保持不变。
 */
export default function RuleEditModal({ rule, onClose }: Props) {
  const state = useAppState();
  const run = useAction();
  const today = todayKey();
  const tomorrow = addDays(today, 1);

  const [weekdays, setWeekdays] = useState<number[]>(rule.weekdays);
  const [memberOrder, setMemberOrder] = useState<MemberId[]>(rule.memberOrder);
  const [effectiveFrom, setEffectiveFrom] = useState(tomorrow);
  const [standard, setStandard] = useState(rule.standard);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;

  const impact = useMemo(
    () =>
      previewRuleChange(
        {
          rules: state.choreRules,
          taskState: state.choreTaskState,
          assignments: state.choreAssignments,
          swaps: state.swapRequests,
          today,
        },
        rule,
        { effectiveFrom, weekdays, memberOrder },
      ),
    [state, rule, effectiveFrom, weekdays, memberOrder, today],
  );

  const toggleDay = (day: number) =>
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );

  const toggleMember = (id: MemberId) =>
    setMemberOrder((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  function submit() {
    const next: Record<string, string> = {};
    if (weekdays.length === 0) next.weekdays = '请至少选择一个执行日';
    if (memberOrder.length === 0) next.memberOrder = '请至少选择一位成员';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || effectiveFrom <= today) {
      next.effectiveFrom = `生效日期最早为明天（${tomorrow}），历史排班不会被改写`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const okDone = run(
      {
        type: 'chore/updateRule',
        ruleId: rule.id,
        effectiveFrom,
        weekdays,
        memberOrder,
        standard,
        note,
        by: state.currentMemberId,
      },
      `规则已更新，${formatDateCN(effectiveFrom)} 起生效`,
    );
    if (okDone) onClose();
  }

  return (
    <Modal
      title={`调整规则：${rule.area}`}
      subtitle="修改只影响生效日及之后的任务，历史负责人与完成记录不会重新计算"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            <IconCheck size={15} /> 保存并生效
          </button>
        </>
      }
    >
      <Field label="每周执行日" error={errors.weekdays}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {WEEKDAYS.map((d) => (
            <Checkbox
              key={d}
              label={weekdayLabel(d)}
              checked={weekdays.includes(d)}
              onChange={() => toggleDay(d)}
            />
          ))}
        </div>
      </Field>
      <Field label="轮换顺序" error={errors.memberOrder} hint="按勾选顺序轮换">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {state.members.map((m) => (
            <Checkbox
              key={m.id}
              label={m.name}
              checked={memberOrder.includes(m.id)}
              onChange={() => toggleMember(m.id)}
            />
          ))}
        </div>
      </Field>
      <Field
        label="生效日期"
        error={errors.effectiveFrom}
        htmlFor="rule-effective"
        hint={`最早 ${tomorrow}；该日期之前的任务保持原样`}
      >
        <Input
          id="rule-effective"
          type="date"
          value={effectiveFrom}
          min={tomorrow}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </Field>
      <Field label="完成标准" htmlFor="rule-standard">
        <Input
          id="rule-standard"
          value={standard}
          onChange={(e) => setStandard(e.target.value)}
        />
      </Field>
      <Field label="调整说明" htmlFor="rule-note">
        <Input
          id="rule-note"
          value={note}
          placeholder="例如：小周出差两周，暂由小林、小陈轮换"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <div className="divider" />
      <div className="card__title">影响预览（{formatDateCN(effectiveFrom)} 起 4 周）</div>
      {impact.changed.length === 0 && impact.removedDates.length === 0 ? (
        <div className="small muted">这几周内的负责人没有变化。</div>
      ) : (
        <div className="list" style={{ marginTop: 8 }}>
          {impact.changed.slice(0, 12).map((c) => (
            <div className="item" key={c.date}>
              <div className="item__main">
                <div className="item__title">{formatDateCN(c.date)}</div>
                <div className="item__meta">
                  {c.before ? `${nameOf(c.before)} → ${c.after ? nameOf(c.after) : '无'}` : `新增：${nameOf(c.after!)}`}
                </div>
              </div>
            </div>
          ))}
          {impact.removedDates.slice(0, 6).map((d) => (
            <div className="item" key={`rm-${d}`}>
              <div className="item__main">
                <div className="item__title">{formatDateCN(d)}</div>
                <div className="item__meta">该日不再排班</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {impact.affectedPendingSwaps.length > 0 ? (
        <div className="banner" style={{ marginTop: 10 }}>
          <span>
            有 {impact.affectedPendingSwaps.length} 个待确认换班涉及生效日之后的任务，保存后会被标记为「已失效」并说明原因。
          </span>
        </div>
      ) : null}
    </Modal>
  );
}

/** 规则状态标签：暂停中 / 有未来版本 */
export function RuleStatus({ rule }: { rule: ChoreRule }) {
  if (isPausing(rule)) return <span className="badge badge--own">已暂停</span>;
  return null;
}

export function RuleVersionHint({ rule }: { rule: ChoreRule }) {
  const versions = rule.versions ?? [];
  if (versions.length <= 1) return null;
  const latest = versions[versions.length - 1];
  return (
    <div className="item__meta">
      {versions.length} 个版本 · 最新 {formatDateCN(latest.effectiveFrom)} 起生效（{latest.note}）
    </div>
  );
}

/** 暂停 / 恢复操作按钮 */
export function RulePauseControl({ rule }: { rule: ChoreRule }) {
  const run = useAction();
  const state = useAppState();
  const paused = isPausing(rule);
  return (
    <button
      type="button"
      className="btn btn--sm"
      onClick={() => {
        if (paused) {
          run({ type: 'chore/resume', ruleId: rule.id, to: null, by: state.currentMemberId }, '规则已恢复');
        } else {
          run({ type: 'chore/pause', ruleId: rule.id, from: null, by: state.currentMemberId }, '规则已暂停');
        }
      }}
    >
      {paused ? '恢复' : '暂停'}
    </button>
  );
}

export function RuleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const state = useAppState();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {state.choreRules.map((r) => (
        <option key={r.id} value={r.id}>
          {r.area}
        </option>
      ))}
    </Select>
  );
}
