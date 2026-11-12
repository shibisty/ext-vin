import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { extension } from './build/extension-plugin.ts';

// Сборка расширения под один браузер: режим (--mode) состоит из частей через «-»:
//   chrome | firefox — браузер (по умолчанию chrome), результат в dist/<браузер>, zip — в dist/;
//   mitchell — со справочником Mitchell 1 (или переменная окружения VIN_MITCHELL=1);
//   development — с source maps и без минификации (npm run dev).
// Точки входа: popup.html и src/theme-init.ts; sidebar.html и manifest.json делает build/extension-plugin.ts;
// public/ (база nhtsa/) копируется как есть. Тесты подключают справочник сами (tests/setup.ts).

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => {
  const parts = mode.split('-');
  const target = parts.includes('firefox') ? 'firefox' : 'chrome';
  const mitchell = parts.includes('mitchell') || process.env.VIN_MITCHELL === '1';
  const dev = parts.includes('development');
  const outDir = `dist/${target}`;
  return {
  base: './',                       // относительные пути: страница открывается как chrome-extension://…/popup.html
  define: { __MITCHELL__: JSON.stringify(mitchell) },
  plugins: [extension({ target, version: pkg.version, outDir, zipName: `vin-decoder-${pkg.version}-${target}${mitchell ? '-mitchell' : ''}.zip` })],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,           // CSP расширений не любит inline-полифилл preload
    sourcemap: dev,
    minify: !dev && target === 'chrome',   // для AMO код Firefox без минификации: ревьюеру не нужны исходники отдельно
    chunkSizeWarningLimit: 1024,     // основной вес — справочные таблицы; расширение грузит их локально
    rollupOptions: {
      input: { popup: 'popup.html', 'theme-init': 'src/theme-init.ts' },
      output: {
        // theme-init.js подключается обычным <script> из popup.html, поэтому лежит в корне под постоянным именем
        entryFileNames: chunk => (chunk.name === 'theme-init' ? 'theme-init.js' : 'assets/[name].js'),
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
  };
});
