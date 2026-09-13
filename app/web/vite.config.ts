import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 前端构建产物由 app/server（Node 内置 http）静态托管：
//   cd app/web && pnpm build   →  app/web/dist  →  node app/server/index.mjs
// 开发模式（pnpm dev）下 /api 反向代理到本地 API 服务
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
