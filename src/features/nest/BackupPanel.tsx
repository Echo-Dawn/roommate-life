import { useRef, useState } from 'react';
import { backupToJson, checkBackup, parseBackup, type ImportCheck } from '../../store/backup';
import { restoreFromBackup } from '../../store/store';
import { downloadBackup } from '../../store/storage';
import { useAppState } from '../../store/hooks';
import { useToast } from '../../ui/Toast';
import { Modal } from '../../ui/primitives';
import { formatTimeCN } from '../../domain/dateKey';
import type { AppState } from '../../domain/types';

/**
 * 备份与恢复入口（小窝页 · 演示设置内）：
 * - 导出：下载完整 JSON（含 schemaVersion）。
 * - 导入：校验 → 预览概要 → 用户确认整体替换；替换前自动下载当前数据备份。
 */
export default function BackupPanel() {
  const state = useAppState();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [check, setCheck] = useState<(ImportCheck & { json: string }) | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function exportBackup() {
    try {
      downloadBackup(backupToJson(state), `roommate-life-backup-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('备份文件已开始下载');
    } catch {
      toast.error('导出失败，请重试');
    }
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const json = String(reader.result ?? '');
      const result = checkBackup(json);
      setCheck({ ...result, json });
      if (!result.ok) toast.error(result.error ?? '备份校验未通过');
    };
    reader.onerror = () => toast.error('读取文件失败');
    reader.readAsText(file);
  }

  function doRestore() {
    if (!check?.ok) return;
    // 替换前把当前数据快照下载给用户，避免误操作无法回退
    downloadBackup(
      JSON.stringify({ ...state, schemaVersion: state.schemaVersion }),
      `roommate-life-before-restore-${new Date().toISOString().slice(0, 10)}.json`,
    );
    let next: AppState;
    try {
      next = parseBackup(check.json);
    } catch {
      toast.error('解析备份失败，已取消恢复');
      setConfirmOpen(false);
      return;
    }
    const result = restoreFromBackup(next);
    setConfirmOpen(false);
    setCheck(null);
    if (fileRef.current) fileRef.current.value = '';
    if (result.ok) toast.success('已从备份恢复（原数据已另存下载）');
    else toast.error(result.error ?? '恢复失败，原数据未受影响');
  }

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn btn--sm" onClick={exportBackup}>
          导出备份（JSON）
        </button>
        <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()}>
          导入恢复
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </div>
      <div className="tiny muted">
        导出包含全部演示数据；导入前会先校验结构与关联，确认后整体替换，替换前会自动下载当前数据留底。
      </div>

      {check && !check.ok ? (
        <div className="banner banner--warn">
          备份校验未通过：{check.error}。原数据未受影响。
        </div>
      ) : null}

      {check?.ok && check.summary ? (
        <div className="banner">
          <div>
            <div className="small" style={{ fontWeight: 650 }}>
              备份校验通过，可恢复
            </div>
            <div className="small muted">
              {check.summary.members} 位成员 · {check.summary.expenses} 笔账单 ·{' '}
              {check.summary.choreRules} 条值日规则 · {check.summary.supplies} 件物品 ·{' '}
              {check.summary.restocks} 条补货记录 · {check.summary.pactVersions} 个公约版本
              {check.summary.exportedAt ? ` · 导出于 ${formatTimeCN(check.summary.exportedAt)}` : ''}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn--sm btn--danger" onClick={() => setConfirmOpen(true)}>
                确认恢复（整体替换）
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setCheck(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <Modal
          title="确认从备份恢复"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn--danger" onClick={doRestore}>
                整体替换
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            恢复会用备份文件<b>整体替换</b>当前全部数据，不做合并。
          </p>
          <p className="small muted">
            点击「整体替换」前会先自动下载当前数据的备份，恢复失败也不会损坏原数据。
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
