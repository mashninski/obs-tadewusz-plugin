import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Старонкі: док, оверлеі (галасаванне, бягучы радок, музыка, інтро) і старонка вяртання са Spotify.
const pages = ['dock', 'overlay', 'ticker', 'music', 'intro', 'callback'];

/** Версія зборкі — кароткі хэш commit (відаць на ўкладцы «Стан»; па ёй адкрытыя старонкі бачаць абнаўленне). */
const version = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname }).toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  root: import.meta.dirname,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      name: 'version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
      },
    },
  ],
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Агульны код з ядром (../shared) па-за тэчкай web.
    fs: { allow: ['..'] },
    // Пры распрацоўцы API дае ядро, запушчанае побач (npm start).
    proxy: { '/api': 'http://127.0.0.1:18745', '/overlay/state': 'http://127.0.0.1:18745', '/ticker/': 'http://127.0.0.1:18745', '/intro/': 'http://127.0.0.1:18745' },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
