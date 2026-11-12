// Vite-плагин сборки расширения под один браузер:
//  * manifest.json из src/manifest.ts (Chrome или Firefox);
//  * sidebar.html — копия popup.html для боковой панели (вид страницы выбирает theme-init.js по имени файла);
//  * проверка, что в dist/<браузер> есть всё, на что ссылается манифест;
//  * при обычной сборке (не --watch) — zip для магазина в dist/.
import type { Plugin } from 'vite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildManifest, type Target } from '../src/manifest.ts';
import { readTree, zip } from './zip.ts';

export interface ExtensionOptions { target: Target; version: string; outDir: string; zipName: string }

/** Файлы, на которые ссылается манифест */
export function manifestFiles(m: Record<string, unknown>): string[] {
  const files: string[] = [];
  const a = m.action as { default_popup?: string } | undefined;
  if (a?.default_popup) files.push(a.default_popup);
  const sp = m.side_panel as { default_path?: string } | undefined;
  if (sp?.default_path) files.push(sp.default_path);
  const sa = m.sidebar_action as { default_panel?: string } | undefined;
  if (sa?.default_panel) files.push(sa.default_panel);
  return files.map(f => f.split('?')[0]);
}

export function extension(o: ExtensionOptions): Plugin {
  const manifest = buildManifest(o.target, o.version);
  let watch = false;
  return {
    name: 'vin-extension',
    enforce: 'post',
    apply: 'build',
    buildStart() { watch = !!this.meta.watchMode; },
    generateBundle: { order: 'post', handler(_opts, bundle) {
      const popup = bundle['popup.html'];
      if (!popup || popup.type !== 'asset') throw new Error('extension: в сборке нет popup.html');
      this.emitFile({ type: 'asset', fileName: 'sidebar.html', source: popup.source });
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) + '\n' });
    } },
    writeBundle() {
      const need = [...new Set(['manifest.json', 'theme-init.js', 'nhtsa/index.json', ...manifestFiles(manifest)])];
      const missing = need.filter(f => !existsSync(join(o.outDir, f)));
      if (missing.length) throw new Error(`extension: в ${o.outDir} нет файлов: ${missing.join(', ')}`);
      if (watch) return;
      const file = resolve(o.outDir, '..', o.zipName);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, zip(readTree(o.outDir)));
    },
  };
}
