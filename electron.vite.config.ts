import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const sharedAlias = {
  '@shared': resolve(__dirname, 'shared')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), {
      name: 'city-manifold-wasm',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'manifold.wasm', source: readFileSync(resolve('node_modules/manifold-3d/manifold.wasm')) }); }
    }],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main/index.ts')
      }
    },
    resolve: {
      alias: sharedAlias
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts')
      }
    },
    resolve: {
      alias: sharedAlias
    }
  },
  renderer: {
    root: __dirname,
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        ...sharedAlias
      }
    },
    plugins: [vue()]
  }
})
