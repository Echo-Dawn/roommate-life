import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useStore, resetStore, dispatch, dismissNotice } from '../store/store';
import {
  IconAlert,
  IconChore,
  IconClose,
  IconHome,
  IconLedger,
  IconNest,
  IconReset,
  IconSupply,
} from './Icon';
import { Avatar, Banner, Modal } from './primitives';
import { useToast } from './Toast';
import { buildTasks } from '../domain/chores';
import { addDays, startOfWeek, todayKey } from '../domain/dateKey';
import { needsMyConfirmation } from '../domain/pact';
import { needsRestock } from '../domain/supplies';
import { sharesAwaitingMyConfirm, sharesAwaitingMyPayment } from '../domain/expenses';

const NAV = [
  { to: '/', label: '首页', Icon: IconHome },
  { to: '/ledger', label: '账本', Icon: IconLedger },
  { to: '/chores', label: '值日', Icon: IconChore },
  { to: '/supplies', label: '物品', Icon: IconSupply },
  { to: '/nest', label: '小窝', Icon: IconNest },
];

/** 侧栏徽标 = 该页全部待办（含付款与值日），与首页「待我确认」口径不同 */
function badgeHint(to: string, badge: number): string {
  const scope: Record<string, string> = {
    '/': '我的待付款 + 待我确认 + 我的未完成值日',
    '/ledger': '我的待付款 + 待我确认收款',
    '/chores': '我的未完成值日 + 待我处理的换班',
    '/supplies': '需要补货的物品',
    '/nest': '待我确认的公约',
  };
  return `全部待办 ${badge} 项：${scope[to] ?? ''}`;
}

export function AppShell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  const { state, saveError, notice, unavailableMessage } = useStore();
  const location = useLocation();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);

  const badges = useMemo(() => {
    if (!state) return {} as Record<string, number>;
    const me = state.currentMemberId;
    const today = todayKey();
    const weekStart = startOfWeek(today);
    const tasks = buildTasks(
      {
        rules: state.choreRules,
        taskState: state.choreTaskState,
        assignments: state.choreAssignments,
        swaps: state.swapRequests,
        today,
      },
      addDays(weekStart, -7),
      addDays(weekStart, 13),
    );
    const myOpenTasks = tasks.filter(
      (t) => t.assigneeId === me && t.status !== 'done' && t.date <= today,
    ).length;
    const swapsForMe = state.swapRequests.filter(
      (s) => s.status === 'pending' && s.toMemberId === me,
    ).length;
    const pactPending = needsMyConfirmation(state, me) ? 1 : 0;
    return {
      '/':
        sharesAwaitingMyConfirm(state, me).length +
        sharesAwaitingMyPayment(state, me).length +
        swapsForMe +
        pactPending +
        myOpenTasks,
      '/ledger': sharesAwaitingMyConfirm(state, me).length + sharesAwaitingMyPayment(state, me).length,
      '/chores': myOpenTasks + swapsForMe,
      '/supplies': state.supplies.filter(needsRestock).length,
      '/nest': pactPending,
    };
  }, [state]);

  const currentMember = state?.members.find((m) => m.id === state.currentMemberId);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F6F4ED" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
              <path d="M9.5 21v-6h5v6" />
            </svg>
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="brand__name" style={{ display: 'block' }}>
              合租小窝
            </span>
            <span className="brand__home" style={{ display: 'block' }}>
              {state?.homeName ?? '—'}
            </span>
          </span>
        </div>

        <nav className="nav" aria-label="主导航">
          {NAV.map(({ to, label, Icon }) => {
            const badge = badges[to] ?? 0;
            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
              >
                <Icon />
                <span>{label}</span>
                {badge > 0 ? (
                  <span className="nav__badge" title={badgeHint(to, badge)}>
                    {badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="identity">
          <div className="small muted">当前演示身份</div>
          <div className="row" style={{ marginTop: 6, gap: 8 }}>
            <Avatar text={currentMember?.initial ?? '?'} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650 }}>{currentMember?.name ?? '—'}</div>
              <div className="tiny muted">
                切换身份可以体验对方视角下能做什么、不能做什么
              </div>
            </div>
          </div>
          <div className="identity__list">
            {state?.members.map((member) => (
              <button
                key={member.id}
                type="button"
                className={`identity__btn${member.id === state.currentMemberId ? ' identity__btn--active' : ''}`}
                onClick={() => dispatch({ type: 'identity/set', memberId: member.id })}
              >
                <Avatar text={member.initial} />
                <span>{member.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar__footer">
          <div className="small muted">
            侧栏徽标 = 该页全部待办（含我的付款与值日）；首页「待我确认」只统计收款、换班、公约三类确认。
          </div>
          <div className="small muted">本机演示 · 数据仅保存在当前浏览器</div>
          <button type="button" className="btn btn--sm" onClick={() => setResetOpen(true)}>
            <IconReset size={15} /> 重置演示数据
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main__inner">
          {unavailableMessage ? (
            <div style={{ marginBottom: 14 }}>
              <Banner kind="error" icon={<IconAlert />}>
                {unavailableMessage}
              </Banner>
            </div>
          ) : null}
          {saveError ? (
            <div style={{ marginBottom: 14 }}>
              <Banner kind="error" icon={<IconAlert />}>
                {saveError}
                <div className="small" style={{ marginTop: 4 }}>
                  本次改动未写入本地存储，请处理后重试。
                </div>
              </Banner>
            </div>
          ) : null}
          {notice ? (
            <div style={{ marginBottom: 14 }}>
              <Banner
                kind="info"
                actions={
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => dismissNotice()}
                  >
                    知道了
                  </button>
                }
              >
                {notice}
              </Banner>
            </div>
          ) : null}
          {header}
          <div key={location.pathname}>{children}</div>
          <div className="tiny muted" style={{ marginTop: 26, textAlign: 'center' }}>
            本机演示版 · 数据仅保存在当前浏览器，不会上传或同步到服务器
          </div>
        </div>
      </main>

      <nav className="bottom-nav" aria-label="底部导航">
        {NAV.map(({ to, label, Icon }) => {
          const badge = badges[to] ?? 0;
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `bottom-nav__item${isActive ? ' bottom-nav__item--active' : ''}`
              }
            >
              <Icon size={20} />
              <span>{label}</span>
              {badge > 0 ? <span className="bottom-nav__dot">{badge}</span> : null}
            </NavLink>
          );
        })}
      </nav>

      {resetOpen ? (
        <Modal
          title="重置演示数据"
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setResetOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  const result = resetStore();
                  setResetOpen(false);
                  if (result.ok) {
                    toast.success(
                      `已重置为示例数据（清除 ${result.removed?.length ?? 0} 个本应用的存储项）`,
                    );
                  } else {
                    toast.error(result.error ?? '重置失败');
                  }
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
          <ul className="small muted" style={{ paddingLeft: 20, margin: '8px 0 0' }}>
            <li>只清除本应用使用的存储项（roommate-life: 前缀），不会影响其他网站的数据。</li>
            <li>不会调用浏览器整体清空接口。</li>
            <li>重置后当前演示身份回到小林。</li>
          </ul>
          <div className="small" style={{ marginTop: 10 }}>
            此操作不可撤销，请确认。
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 10 }}
            onClick={() => setResetOpen(false)}
          >
            <IconClose size={14} /> 我再想想
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
