import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import pkg from './package.json'

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // shared 共享包：方案 B 仅铺路，前端直接吃 TS 源码（无需先 build shared）。
      // 注意：前端 OP 端口表（OP_ARG_SPECS 等）仍保留本地，已知残留漂移点，见 docs/shared接入设计.md。
      '@gipfel/engine-dsl': resolve(__dirname, '../shared/engine-dsl/src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: '',
      },
    },
  },
  server: {
    port: 5173,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
