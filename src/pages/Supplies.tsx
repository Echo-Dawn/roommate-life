import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAction, useAppState } from '../store/hooks';
import { getSnapshot } from '../store/store';
import {
  Amount,
  Avatar,
  Empty,
  Field,
  Input,
  Modal,
  Select,
  SupplyBadge,
} from '../ui/primitives';
import { ExpenseFormModal } from '../features/expenses/ExpenseForm';
import { IconCheck, IconDoc, IconPlus } from '../ui/Icon';
import { dateKeyOf, formatDateCN, todayKey } from '../domain/dateKey';
import {
  canCancelClaim,
  canClaim,
  canCompleteRestock,
  resolveStockInput,
  sortByUrgency,
  supplyRuleHint,
  supplyStatus,
} from '../domain/supplies';
import type { SupplyItem } from '../domain/types';
import type { SupplyInput } from '../store/reducer';

/** 补记/即时记账的预填信息，始终来自补货记录本身而不是当前切换的身份 */
interface LinkDraft {
  restockId: string | null;
  name: string;
  payerId: string;
  date: string;
}

export default function SuppliesPage() {
  const state = useAppState();
  const run = useAction();
  const location = useLocation();
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SupplyItem | null>(null);
  const [restockDone, setRestockDone] = useState<{ item: SupplyItem; restockId: string | null } | null>(
    null,
  );
  const [linkRestock, setLinkRestock] = useState<LinkDraft | null>(null);
  const [viewExpenseId, setViewExpenseId] = useState<string | null>(null);
  /**
   * 草稿记录「输入时的余量」作为基线：
   * 只有当物品余量仍是基线值时草稿才生效，
   * 这样补货完成、导入备份等业务更新后输入框自动显示最新余量，
   * 又不会无条件抹掉用户尚未提交的编辑。
   */
  const [stockDraft, setStockDraft] = useState<Record<string, { value: string; base: number }>>({});

  /** 取草稿值（仅当基线仍是当前余量），否则显示真实余量 */
  const stockValue = (item: SupplyItem) => resolveStockInput(stockDraft[item.id], item.stock);

  const clearDraft = (itemId: string) =>
    setStockDraft((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });

  useEffect(() => {
    const flag = (location.state as { openItemForm?: boolean } | null)?.openItemForm;
    if (flag) setItemFormOpen(true);
  }, [location.state]);

  const me = state.currentMemberId;
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const initialOf = (id: string) => state.members.find((m) => m.id === id)?.initial ?? '?';

  const [showArchived, setShowArchived] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string>('all');
  const [historyLimit, setHistoryLimit] = useState(8);

  const activeSupplies = useMemo(
    () => state.supplies.filter((i) => !i.archived),
    [state.supplies],
  );
  const archivedSupplies = useMemo(
    () => state.supplies.filter((i) => i.archived),
    [state.supplies],
  );

  const ordered = useMemo(() => sortByUrgency(activeSupplies), [activeSupplies]);

  /** 完整补货历史：按物品筛选 + 加载更多，不再固定只显示 8 条 */
  const filteredRestocks = useMemo(
    () =>
      [...state.restocks]
        .filter((r) => historyFilter === 'all' || r.itemId === historyFilter)
        .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1)),
    [state.restocks, historyFilter],
  );
  const recentRestocks = useMemo(
    () => filteredRestocks.slice(0, historyLimit),
    [filteredRestocks, historyLimit],
  );

  function linkedExpense(restockId: string) {
    return (
      state.expenses.find((e) => e.linkedRestockId === restockId && !e.voided) ?? null
    );
  }

  function completeRestock(item: SupplyItem) {
    const okDone = run(
      { type: 'supply/completeRestock', itemId: item.id, by: me },
      '补货已完成，余量已恢复',
    );
    if (!okDone) return;
    clearDraft(item.id);
    const fresh = getSnapshot().state;
    const record = fresh?.restocks.find((r) => r.itemId === item.id && !r.expenseId);
    setRestockDone({ item, restockId: record?.id ?? null });
  }

  function saveStock(item: SupplyItem) {
    const raw = stockValue(item);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      run({ type: 'supply/setStock', itemId: item.id, stock: -1 });
      return;
    }
    const okDone = run({ type: 'supply/setStock', itemId: item.id, stock: value }, '余量已更新');
    // 保存成功后清除草稿，输入框回到真实余量，旧值不会覆盖新结果
    if (okDone) clearDraft(item.id);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="topbar__title">公共物品</h1>
          <div className="topbar__sub">
            {activeSupplies.length} 件在册 · 需要补货{' '}
            {activeSupplies.filter((i) => supplyStatus(i) !== 'ok').length} 件
            {archivedSupplies.length > 0 ? ` · 已归档 ${archivedSupplies.length} 件` : ''}
          </div>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setItemFormOpen(true)}>
          <IconPlus size={16} /> 登记物品
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="card">
          <Empty>还没有登记公共物品。</Empty>
        </div>
      ) : (
        <div className="list">
          {ordered.map((item) => {
            const status = supplyStatus(item);
            const claimMine = item.claim?.memberId === me;
            return (
              <div className="card" key={item.id}>
                <div className="card__head">
                  <div style={{ minWidth: 0 }}>
                    <div className="item__title">
                      {item.name}
                      <SupplyBadge status={status} />
                      {item.category ? (
                        <span className="badge badge--neutral">{item.category}</span>
                      ) : null}
                    </div>
                    <div className="item__meta">
                      {item.location || '未标注位置'} · 余量 {item.stock}
                      {item.unit} / 满量 {item.fullStock}
                      {item.unit}
                    </div>
                    <div className="item__meta">
                      最近补货：
                      {item.lastRestockedAt ? formatDateCN(item.lastRestockedAt) : '暂无记录'}
                    </div>
                  </div>
                  <div className="item__side">
                    {item.claim ? (
                      <span className="row" style={{ gap: 6 }}>
                        <Avatar text={initialOf(item.claim.memberId)} />
                        <span className="small">{nameOf(item.claim.memberId)}认领</span>
                      </span>
                    ) : (
                      <span className="tiny muted">无人认领</span>
                    )}
                  </div>
                </div>

                <div className="row">
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <Input
                      inputMode="numeric"
                      style={{ width: 76 }}
                      value={stockValue(item)}
                      onChange={(e) =>
                        setStockDraft((prev) => ({
                          ...prev,
                          [item.id]: { value: e.target.value, base: item.stock },
                        }))
                      }
                      aria-label={`${item.name} 余量`}
                    />
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={stockValue(item).trim() === String(item.stock)}
                      onClick={() => saveStock(item)}
                    >
                      更新余量
                    </button>
                  </div>
                  {canClaim(item, me) ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      onClick={() =>
                        run({ type: 'supply/claim', itemId: item.id, by: me }, '已认领补货')
                      }
                    >
                      认领补货
                    </button>
                  ) : null}
                  {canCancelClaim(item, me) ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        run({ type: 'supply/unclaim', itemId: item.id, by: me }, '已取消认领')
                      }
                    >
                      取消认领
                    </button>
                  ) : null}
                  {canCompleteRestock(item, me) ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      onClick={() => completeRestock(item)}
                    >
                      <IconCheck size={14} /> 完成补货
                    </button>
                  ) : null}
                  {item.claim && !claimMine ? (
                    <span className="tiny muted">
                      已被 {nameOf(item.claim.memberId)} 认领，不能重复认领
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setEditingItem(item)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      if (item.claim) {
                        run(
                          { type: 'supply/archive', itemId: item.id, by: me },
                          '该物品已被认领，请先取消或完成认领再归档',
                        );
                        return;
                      }
                      run({ type: 'supply/archive', itemId: item.id, by: me }, '物品已归档');
                    }}
                  >
                    归档
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {archivedSupplies.length > 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card__head">
            <div className="card__title">已归档物品</div>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? '收起' : `展开（${archivedSupplies.length}）`}
            </button>
          </div>
          {showArchived ? (
            <div className="list">
              {archivedSupplies.map((item) => (
                <div className="item" key={item.id}>
                  <div className="item__main">
                    <div className="item__title">{item.name}</div>
                    <div className="item__meta">
                      {item.location || '未标注位置'} · 归档后仍保留补货与费用历史
                    </div>
                  </div>
                  <div className="item__side">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        run({ type: 'supply/unarchive', itemId: item.id }, '物品已恢复')
                      }
                    >
                      恢复
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="small muted">归档只隐藏补货提醒，不删除任何历史记录。</div>
          )}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card__head">
          <div className="card__title">
            <IconDoc /> 补货记录
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Select
              aria-label="按物品筛选补货历史"
              value={historyFilter}
              onChange={(e) => {
                setHistoryFilter(e.target.value);
                setHistoryLimit(8);
              }}
            >
              <option value="all">全部物品</option>
              {state.supplies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.archived ? '（已归档）' : ''}
                </option>
              ))}
            </Select>
            <span className="card__hint">
              共 {filteredRestocks.length} 条，已显示 {recentRestocks.length} 条
            </span>
          </div>
        </div>
        {recentRestocks.length === 0 ? (
          <Empty>
            {historyFilter === 'all'
              ? '还没有补货记录。'
              : '该物品还没有补货记录，换个物品看看。'}
          </Empty>
        ) : (
          <div className="list">
            {recentRestocks.map((record) => {
              const expense = linkedExpense(record.id);
              const doneDate = dateKeyOf(record.completedAt);
              return (
                <Fragment key={record.id}>
                  <div className="item">
                    <Avatar text={initialOf(record.memberId)} />
                    <div className="item__main">
                      <div className="item__title">{record.itemName}</div>
                      <div className="item__meta">
                        {nameOf(record.memberId)} 补货 · {formatDateCN(doneDate)}
                      </div>
                    </div>
                    <div className="item__side">
                      {expense ? (
                        <button
                          type="button"
                          className="btn btn--sm"
                          aria-expanded={viewExpenseId === expense.id}
                          onClick={() =>
                            setViewExpenseId((prev) => (prev === expense.id ? null : expense.id))
                          }
                        >
                          查看账单 <Amount cents={expense.amountCents} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--sm btn--primary"
                          onClick={() =>
                            setLinkRestock({
                              restockId: record.id,
                              name: `${record.itemName}补货`,
                              payerId: record.memberId,
                              date: doneDate,
                            })
                          }
                        >
                          补记费用
                        </button>
                      )}
                    </div>
                  </div>
                  {expense && viewExpenseId === expense.id ? (
                    <div style={{ marginTop: 10, width: '100%' }}>
                      <div className="divider" />
                      <div className="small muted">
                        {expense.name} · {expense.date} · {nameOf(expense.payerId)}垫付
                      </div>
                      <div className="table-scroll">
                        <table className="table" style={{ marginTop: 6 }}>
                          <thead>
                            <tr>
                              <th>成员</th>
                              <th>承担金额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {expense.shares.map((share) => (
                              <tr key={share.memberId}>
                                <td>
                                  {nameOf(share.memberId)}
                                  {share.memberId === expense.payerId ? '（付款人）' : ''}
                                </td>
                                <td>
                                  <Amount cents={share.amountCents} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="small muted" style={{ marginTop: 6 }}>
                        该补货记录已关联一笔有效费用，不会重复生成；若这笔账单被作废，可以重新补记。
                      </div>
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        )}
        <div className="small muted" style={{ marginTop: 10 }}>
          没有关联有效账单的记录随时可以「补记费用」；同一条补货记录最多关联一笔有效费用（业务层校验，不靠按钮隐藏）。
        </div>
        {filteredRestocks.length > recentRestocks.length ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setHistoryLimit((n) => n + 8)}
            >
              加载更多（还有 {filteredRestocks.length - recentRestocks.length} 条）
            </button>
          </div>
        ) : null}
      </div>

      {itemFormOpen ? <ItemFormModal onClose={() => setItemFormOpen(false)} /> : null}
      {editingItem ? (
        <ItemFormModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => clearDraft(editingItem.id)}
        />
      ) : null}

      {restockDone ? (
        <Modal
          title="补货已完成"
          subtitle={`${restockDone.item.name} · 余量已恢复到 ${restockDone.item.fullStock}${restockDone.item.unit}`}
          onClose={() => setRestockDone(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRestockDone(null)}>
                暂时不用
              </button>
              {restockDone.restockId ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    const id = restockDone.restockId as string;
                    setRestockDone(null);
                    setLinkRestock({
                      restockId: id,
                      name: `${restockDone.item.name}补货`,
                      payerId: me,
                      date: todayKey(),
                    });
                  }}
                >
                  同时记一笔
                </button>
              ) : null}
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            可以选择「同时记一笔」，把这次采购计入账本并自动关联到本次补货记录。
          </p>
          <p className="small muted">
            金额与参与人需要你确认后提交；直接关闭不会撤销已完成的补货，之后仍可在补货记录里「补记费用」。
          </p>
        </Modal>
      ) : null}

      {linkRestock ? (
        <ExpenseFormModal
          initial={{
            name: linkRestock.name,
            category: 'supplies',
            payerId: linkRestock.payerId,
            date: linkRestock.date,
          }}
          linkedRestockId={linkRestock.restockId}
          hint={`已按补货记录预填物品名称、购买人（${nameOf(linkRestock.payerId)}）和补货日期；金额与参与人仍需你确认。`}
          onClose={() => setLinkRestock(null)}
        />
      ) : null}
    </>
  );
}

function ItemFormModal({
  item,
  onClose,
  onSaved,
}: {
  item?: SupplyItem;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const state = useAppState();
  const run = useAction();
  const editing = Boolean(item);
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? '清洁日用');
  const [location, setLocation] = useState(item?.location ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [stock, setStock] = useState(item ? String(item.stock) : '0');
  const [fullStock, setFullStock] = useState(item ? String(item.fullStock) : '1');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit() {
    const next: Record<string, string> = {};
    if (name.trim() === '') next.name = '请填写名称';
    const stockValue = Number(stock);
    const fullValue = Number(fullStock);
    if (!Number.isInteger(stockValue) || stockValue < 0) next.stock = '余量需为不小于 0 的整数';
    if (!Number.isInteger(fullValue) || fullValue < 1) next.fullStock = '满量需为不小于 1 的整数';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (item) {
      // 改名不会篡改历史补货记录里的名称快照
      const okDone = run(
        {
          type: 'supply/update',
          itemId: item.id,
          patch: {
            name,
            category,
            location,
            unit,
            stock: stockValue,
            fullStock: fullValue,
          },
        },
        '物品已更新',
      );
      if (okDone) {
        onSaved?.();
        onClose();
      }
      return;
    }
    const input: SupplyInput = {
      name,
      category,
      location,
      stock: stockValue,
      fullStock: fullValue,
      unit,
      createdBy: state.currentMemberId,
    };
    const okDone = run({ type: 'supply/add', input }, '物品已登记');
    if (okDone) onClose();
  }

  return (
    <Modal
      title={editing ? '编辑物品' : '登记公共物品'}
      subtitle={editing ? '改名不会改变历史补货记录中的名称快照' : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            {editing ? '保存' : '登记'}
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="名称" error={errors.name} htmlFor="item-name">
          <Input
            id="item-name"
            value={name}
            invalid={Boolean(errors.name)}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：垃圾袋"
            maxLength={20}
          />
        </Field>
        <div className="grid grid--2">
          <Field label="分类" htmlFor="item-category">
            <Input
              id="item-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="清洁日用 / 厨房 / 卫浴"
              maxLength={12}
            />
          </Field>
          <Field label="存放位置" htmlFor="item-location">
            <Input
              id="item-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例如：阳台储物柜"
              maxLength={20}
            />
          </Field>
        </div>
        <div className="grid grid--3">
          <Field label="当前余量" error={errors.stock} htmlFor="item-stock">
            <Input
              id="item-stock"
              inputMode="numeric"
              value={stock}
              invalid={Boolean(errors.stock)}
              onChange={(e) => setStock(e.target.value)}
            />
          </Field>
          <Field label="满量" error={errors.fullStock} hint="补货后恢复到此数量" htmlFor="item-full">
            <Input
              id="item-full"
              inputMode="numeric"
              value={fullStock}
              invalid={Boolean(errors.fullStock)}
              onChange={(e) => setFullStock(e.target.value)}
            />
          </Field>
          <Field label="单位" htmlFor="item-unit">
            <Input
              id="item-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="卷 / 瓶 / 提"
              maxLength={6}
            />
          </Field>
        </div>
        <div className="small muted">
          {supplyRuleHint()}补货完成后余量会恢复到满量，并自动移出「需要补货」提醒。
        </div>
      </div>
    </Modal>
  );
}
