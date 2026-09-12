import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './ui/Layout';
import { ToastProvider } from './ui/Toast';
import { useStore, recoverFromCorrupt } from './store/store';
import { downloadBackup } from './store/storage';
import { Banner } from './ui/primitives';
import { IconAlert, IconDownload, IconReset } from './ui/Icon';
import HomePage from './pages/Home';
import LedgerPage from './pages/Ledger';
import ChoresPage from './pages/Chores';
import SuppliesPage from './pages/Supplies';
import NestPage from './pages/Nest';
import { useToast } from './ui/Toast';

function RecoveryScreen() {
  const { corrupt } = useStore();
  const toast = useToast();
  if (!corrupt) return null;
  return (
    <div style={{ maxWidth: 620, margin: '48px auto', padding: '0 16px' }}>
      <div className="card">
        <h1 style={{ fontSize: 20 }}>本地数据无法读取</h1>
        <p className="small muted" style={{ marginTop: 10 }}>
          {corrupt.message}
        </p>
        <div style={{ marginTop: 12 }}>
          <Banner kind="warn" icon={<IconAlert />}>
            原始内容仍保留在浏览器本地存储中，没有被删除。建议先备份，再决定如何处理。
          </Banner>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          {corrupt.raw ? (
            <button
              type="button"
              className="btn"
              onClick={() => downloadBackup(corrupt.raw as string)}
            >
              <IconDownload size={15} /> 下载原始数据备份
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              const result = recoverFromCorrupt();
              if (result.ok) toast.success('已重置为示例数据');
              else toast.error(result.error ?? '重置失败');
            }}
          >
            <IconReset size={15} /> 重置为示例数据
          </button>
        </div>
        <div className="tiny muted" style={{ marginTop: 12 }}>
          重置只会清除本应用使用的存储项（roommate-life: 前缀），不影响其他网站的数据。
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { status } = useStore();

  if (status === 'loading') {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>正在加载…</div>
    );
  }

  if (status === 'corrupt') {
    return (
      <ToastProvider>
        <RecoveryScreen />
      </ToastProvider>
    );
  }

  return (
    <HashRouter>
      <ToastProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/chores" element={<ChoresPage />} />
            <Route path="/supplies" element={<SuppliesPage />} />
            <Route path="/nest" element={<NestPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </ToastProvider>
    </HashRouter>
  );
}
