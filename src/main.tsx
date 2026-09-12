import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initStore } from './store/store';

// 先初始化本地数据，再渲染，避免首帧出现空态闪烁
initStore();

const container = document.getElementById('root');
if (!container) throw new Error('未找到 #root 容器');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
