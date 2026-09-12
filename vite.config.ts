import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages 子路径部署：仓库名为 roommate-life，
// 所有静态资源必须以此 base 为前缀，否则深链接/资源 404。
export default defineConfig({
  base: '/roommate-life/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // 关闭自动清空：本地沙箱环境的删除接口不可用；同名文件仍会被覆盖，
    // 仅历史哈希命名的旧资源会残留，不影响部署（CI 中为全新目录）。
    emptyOutDir: false,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
