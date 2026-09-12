import { useMemo, useState } from 'react';
import { useAction, useAppState } from '../store/hooks';
import { resetStore } from '../store/store';
import { Avatar, Empty, Field, Modal, PactBadge, Textarea } from '../ui/primitives';
import { useToast } from '../ui/Toast';
import { IconCheck, IconDoc, IconEdit, IconNest, IconReset } from '../ui/Icon';
import {
  activeVersion,
  confirmedCount,
  countFilled,
  emptyPactContent,
  hasContent,
  pendingVersion,
  sortedVersions,
} from '../domain/pact';
import { PACT_CLAUSES, type PactContent } from '../domain/types';
import { formatTimeCN } from '../domain/dateKey';

export default function NestPage() {
  const state = useAppState();
  const run = useAction();
  const toast = useToast();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const me = state.currentMemberId;
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const initialOf = (id: string) => state.members.find((m) => m.id === id)?.initial ?? '?';

  const active = useMemo(() => activeVersion(state), [state]);
  const pending = useMemo(() => pendingVersion(state), [state]);
  const versions = useMemo(() => sortedVersions(state), [state]);

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="topbar__title">小窝</h1>
          <div className="topbar__sub">
            {state.homeName} · {state.members.length} 位成员
          </div>
        </div>
        <span className="notice-demo">
          <IconNest size={13} /> 本机演示 · 数据仅保存在当前浏览器
        </span>
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconNest /> 成员
          </div>
          <span className="card__hint">虚构演示成员，不含真实个人信息</span>
        </div>
        <div className="list">
          {state.members.map((member) => (
            <div className="item" key={member.id}>
              <Avatar text={member.initial} large />
              <div className="item__main">
                <div className="item__title">
                  {member.name}
                  {member.id === me ? <span className="badge badge--neutral">当前身份</span> : null}
                </div>
                <div className="item__meta">演示身份，可随时切换查看对应待办</div>
              </div>
              <div className="item__side">
                {member.id === me ? null : (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() =>
                      run({ type: 'identity/set', memberId: member.id }, `已切换为${member.name}`)
                    }
                  >
                    切换为{member.name}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconDoc /> 当前生效公约
          </div>
          {active ? <PactBadge status={active.status} /> : null}
        </div>
        {!active ? (
          <div className="banner banner--warn">
            当前没有生效的公约版本。可在下方编辑并提交，全员确认后生效。
          </div>
        ) : (
          <>
            <div className="small muted" style={{ marginBottom: 10 }}>
              第 {active.version} 版 · {nameOf(active.createdBy)} 发起 ·{' '}
              {active.effectiveAt ? formatTimeCN(active.effectiveAt) : ''} 生效
            </div>
            <div className="stack">
              {PACT_CLAUSES.map((clause) => (
                <div key={clause.key}>
                  <div className="small" style={{ fontWeight: 650 }}>
                    {clause.label}
                  </div>
                  <div className="small muted">
                    {active.content[clause.key]?.trim() || '（未填写）'}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {pending ? (
        <div className="card">
          <div className="card__head">
            <div className="card__title">
              <IconCheck /> 待确认版本 v{pending.version}
            </div>
            <PactBadge status={pending.status} />
          </div>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {nameOf(pending.createdBy)} 提交于 {formatTimeCN(pending.createdAt)} · 已确认{' '}
            {confirmedCount(pending)}/{pending.memberIds.length}
          </div>
          <div className="stack">
            {PACT_CLAUSES.map((clause) => (
              <div key={clause.key}>
                <div className="small" style={{ fontWeight: 650 }}>
                  {clause.label}
                </div>
                <div className="small muted">
                  {pending.content[clause.key]?.trim() || '（未填写）'}
                </div>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="list">
            {pending.memberIds.map((id) => (
              <div className="item" key={id}>
                <Avatar text={initialOf(id)} />
                <div className="item__main">
                  <div className="item__title">{nameOf(id)}</div>
                  <div className="item__meta">
                    {pending.confirmations[id]
                      ? `已于 ${formatTimeCN(pending.confirmations[id])} 确认`
                      : '尚未确认'}
                  </div>
                </div>
                <div className="item__side">
                  {id === me && !pending.confirmations[id] ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      onClick={() =>
                        run({ type: 'pact/confirm', versionId: pending.id, by: me }, '已确认该版本')
                      }
                    >
                      我确认
                    </button>
                  ) : (
                    <span className="tiny muted">
                      {pending.confirmations[id]
                        ? '已确认'
                        : `等待${nameOf(id)}本人确认`}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {pending.createdBy === me ? (
            <div className="row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() =>
                  run({ type: 'pact/withdraw', versionId: pending.id, by: me }, '已撤回，可重新编辑')
                }
              >
                撤回该版本
              </button>
              <span className="tiny muted">撤回后可重新编辑并提交</span>
            </div>
          ) : null}
          <div className="tiny muted" style={{ marginTop: 8 }}>
            待确认版本不可直接修改；全员确认后新版本生效，旧版本在生效前继续有效。
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconEdit /> 编辑公约草稿
          </div>
          {pending ? <span className="badge badge--awaiting">存在待确认版本，暂不可提交</span> : null}
        </div>
        <PactEditor
          key={`${pending?.id ?? 'none'}-${active?.id ?? 'none'}`}
          base={state.pactDraft ?? active?.content ?? emptyPactContent()}
          disabled={Boolean(pending)}
          onSaveDraft={(content) => run({ type: 'pact/saveDraft', content }, '草稿已保存')}
          onSubmit={() => run({ type: 'pact/submit', by: me }, '新版本已提交，等待全员确认')}
        />
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">
            <IconDoc /> 版本历史
          </div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setHistoryOpen(true)}>
            查看全部
          </button>
        </div>
        <div className="small muted">
          共 {versions.length} 个版本，最新为 v{versions[0]?.version ?? 0}。
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">演示设置</div>
        </div>
        <div className="stack">
          <div className="small muted">
            数据保存在本机浏览器的 localStorage（roommate-life: 前缀）。刷新后保留；换浏览器或清除站点数据会丢失。
          </div>
          <div className="row">
            <button type="button" className="btn btn--sm" onClick={() => setConfirmReset(true)}>
              <IconReset size={14} /> 重置演示数据
            </button>
            <span className="tiny muted">只清除本应用的存储项，不会调用浏览器整体清空</span>
          </div>
        </div>
      </div>

      {historyOpen ? (
        <Modal
          title="公约版本历史"
          onClose={() => setHistoryOpen(false)}
          wide
          footer={
            <button type="button" className="btn" onClick={() => setHistoryOpen(false)}>
              关闭
            </button>
          }
        >
          {versions.length === 0 ? (
            <Empty>还没有任何版本。</Empty>
          ) : (
            <div className="list">
              {versions.map((version) => (
                <div className="item" key={version.id}>
                  <div className="item__main">
                    <div className="item__title">
                      v{version.version}
                      <PactBadge status={version.status} />
                    </div>
                    <div className="item__meta">
                      {nameOf(version.createdBy)} 发起 · {formatTimeCN(version.createdAt)} · 确认{' '}
                      {confirmedCount(version)}/{version.memberIds.length}
                    </div>
                    <div className="small muted" style={{ marginTop: 6 }}>
                      已填写 {countFilled(version.content)}/{PACT_CLAUSES.length} 条 ·{' '}
                      {version.memberIds.map((id) => nameOf(id)).join('、')}
                    </div>
                    <div className="small muted" style={{ marginTop: 6 }}>
                      {PACT_CLAUSES.filter((c) => version.content[c.key]?.trim())
                        .map((c) => `${c.label}：${version.content[c.key]}`)
                        .join(' ｜ ') || '（无内容）'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}

      {confirmReset ? (
        <Modal
          title="重置演示数据"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  const result = resetStore();
                  setConfirmReset(false);
                  if (result.ok) toast.success('已重置为示例数据');
                  else toast.error(result.error ?? '重置失败');
                }}
              >
                确认重置
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            将删除本机保存的全部演示数据，并恢复为初始示例（向阳小窝 · 小林 / 小周 / 小陈）。
          </p>
          <p className="small muted">此操作不可撤销。</p>
        </Modal>
      ) : null}
    </>
  );
}

function PactEditor({
  base,
  disabled,
  onSaveDraft,
  onSubmit,
}: {
  base: PactContent;
  disabled: boolean;
  onSaveDraft: (content: PactContent) => boolean;
  onSubmit: () => boolean;
}) {
  const [content, setContent] = useState<PactContent>({ ...base });
  const [error, setError] = useState('');
  const filled = countFilled(content);

  return (
    <div className="stack">
      {PACT_CLAUSES.map((clause) => (
        <Field key={clause.key} label={clause.label} hint={clause.hint}>
          <Textarea
            value={content[clause.key] ?? ''}
            disabled={disabled}
            onChange={(e) =>
              setContent((prev) => ({ ...prev, [clause.key]: e.target.value }))
            }
            maxLength={120}
            placeholder={clause.hint}
          />
        </Field>
      ))}
      {error ? <div className="field__error">{error}</div> : null}
      <div className="row">
        <button
          type="button"
          className="btn btn--sm"
          disabled={disabled}
          onClick={() => onSaveDraft(content)}
        >
          保存草稿
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={disabled}
          onClick={() => {
            if (!hasContent(content)) {
              setError('请至少填写一条公约内容');
              return;
            }
            setError('');
            if (onSaveDraft(content)) onSubmit();
          }}
        >
          提交新版本
        </button>
        <span className="tiny muted">已填写 {filled}/{PACT_CLAUSES.length} 条</span>
      </div>
      {disabled ? (
        <div className="tiny muted">已有待确认版本，需等其生效或由发起人撤回后才能提交新版本。</div>
      ) : null}
    </div>
  );
}
