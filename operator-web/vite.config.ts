import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 4173 },
  preview: { port: 4173 },
  // 운영 Admin 번들에는 내부 API/컴포넌트 구조가 담긴 source map을 공개하지 않는다.
  build: { sourcemap: process.env.VITE_SOURCEMAP === '1', target: 'es2022' },
});
