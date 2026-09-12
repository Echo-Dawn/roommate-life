import { useEffect, useMemo, useState } from 'react';
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
  SupplyBadge,
} from '../ui/primitives';
import { ExpenseFormModal } from '../features/expenses/ExpenseForm';
import { IconCheck, IconDoc, IconPlus } from '../ui/Icon';
import { formatDateCN, todayKey } from '../domain/dateKey';
import { canCancelClaim, canClaim, canCompleteRestock, sortByUrgency, supplyStatus } from '../domain/supplies';
import type { SupplyItem } from '../domain/types';
import type { SupplyInput } from '../store/reducer';

export default function SuppliesPage() {
  const state = useAppState();
  const run = useAction();
  const location = useLocation();
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [restockDone, setRestockDone] = useState<{ item: SupplyItem; restockId: string | null } | null>(
    null,
  );
  const [linkRestock, setLinkRestock] = useState<{
    item: SupplyItem;
    restockId: string | null;
  } | null>(null);
  const [viewExpenseId, setViewExpenseId] = useState<string | null>(null);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    const flag = (location.state as { openItemForm?: boolean } | null)?.openItemForm;
    if (flag) setItemFormOpen(true);
  }, [location.state]);

  const me = state.currentMemberId;
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? id;
  const initialOf = (id: string) => state.members.find((m) => m.id === id)?.initial ?? '?';

  const ordered = useMemo(() => sortByUrgency(state.supplies), [state.supplies]);
  const recentRestocks = useMemo(() => state.restocks.slice(0, 8), [state.restocks]);

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
    const fresh = getSnapshot().state;
    const record = fresh?.restocks.find((r) => r.itemId === item.id && !r.expenseId);
    setRestockDone({ item, restockId: record?.id ?? null });
  }

  function saveStock(item: SupplyItem) {
    const raw = stockDraft[item.id] ?? String(item.stock);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      run({ type: 'supply/setStock', itemId: item.id, stock: -1 });
      return;
    }
    const okDone = run({ type: 'supply/setStock', itemId: item.id, stock: value }, '余量已更新');
    if (okDone) setStockDraft((prev) => ({ ...prev, [item.id]: String(value) }));
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="topbar__title">公共物品</h1>
          <div className="topbar__sub">
            {state.supplies.length} 件在册 · 需要补货{' '}
            {state.supplies.filter((i) => supplyStatus(i) !== 'ok').length} 件
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
                      value={stockDraft[item.id] ?? String(item.stock)}
                      onChange={(e) =>
                        setStockDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      aria-label={`${item.name} 余量`}
                    />
                    <button type="button" className="btn btn--sm" onClick={() => saveStock(item)}>
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card__head">
          <div className="card__title">
            <IconDoc /> 补货记录
          </div>
          <span className="card__hint">每条记录最多关联一笔有效费用</span>
        </div>
        {recentRestocks.length === 0 ? (
          <Empty>还没有补货记录。</Empty>
        ) : (
          <div className="list">
            {recentRestocks.map((record) => {
              const expense = linkedExpense(record.id);
              return (
                <>
                  <div className="item" key={record.id}>
                    <Avatar text={initialOf(record.memberId)} />
                  <div className="item__main">
                    <div className="item__title">{record.itemName}</div>
                    <div className="item__meta">
                      {nameOf(record.memberId)} · {formatDateCN(record.completedAt.slice(0, 10))}
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
                      <span className="tiny muted">未关联费用</span>
                    )}
                  </div>
                </div>
                {expense && viewExpenseId === expense.id ? (
                  <div style={{ marginTop: 10, width: '100%' }}>
                    <div className="divider" />
                    <div className="small muted">
                      {expense.name} · {expense.date} · {nameOf(expense.payerId)}垫付
                    </div>
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
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                      该补货记录已关联一笔有效费用，不会重复生成。
                    </div>
                  </div>
                ) : null}
                </>
              );
            })}
          </div>
        )}
      </div>

      {itemFormOpen ? <ItemFormModal onClose={() => setItemFormOpen(false)} /> : null}

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
                    const id = restockDone.restockId;
                    setRestockDone(null);
                    setLinkRestock({ item: restockDone.item, restockId: id });
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
            金额与参与人需要你确认后提交；直接关闭不会撤销已完成的补货。
          </p>
        </Modal>
      ) : null}

      {linkRestock ? (
        <ExpenseFormModal
          initial={{
            name: `${linkRestock.item.name}补货`,
            category: 'supplies',
            payerId: me,
            date: todayKey(),
          }}
          linkedRestockId={linkRestock.restockId}
          hint="已预填名称与购买人，金额与参与人仍需你确认。"
          onClose={() => setLinkRestock(null)}
        />
      ) : null}
    </>
  );
}

function ItemFormModal({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const run = useAction();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('清洁日用');
  const [location, setLocation] = useState('');
  const [unit, setUnit] = useState('');
  const [stock, setStock] = useState('0');
  const [fullStock, setFullStock] = useState('1');
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
      title="登记公共物品"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            登记
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
        <div className="tiny muted">
          余量 ≤ 2 视为「快用完」，归零为「已用完」；补货完成后余量会恢复到满量。
        </div>
      </div>
    </Modal>
  );
}
