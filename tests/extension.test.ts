// Сборка расширения: манифест для Chrome и Firefox, ZIP-писатель, открытие боковой панели.
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { buildManifest, GECKO_ID } from '../src/manifest';
import { extApi, isSidebarView, sidebarOpener } from '../src/sidebar';
import { manifestFiles } from '../build/extension-plugin';
import { crc32, zip } from '../build/zip';

describe('манифест', () => {
  it('Chrome: попап и боковая панель через side_panel', () => {
    const m = buildManifest('chrome', '1.2.3') as Record<string, any>;
    expect(m.manifest_version).toBe(3);
    expect(m.version).toBe('1.2.3');
    expect(m.side_panel).toEqual({ default_path: 'sidebar.html' });
    expect(m.permissions).toContain('sidePanel');
    expect(m.minimum_chrome_version).toBe('116');
    expect(m.sidebar_action).toBeUndefined();
    expect(m.browser_specific_settings).toBeUndefined();
    expect(manifestFiles(m)).toEqual(['popup.html', 'sidebar.html']);
  });
  it('Firefox: sidebar_action, gecko id и раскрытие сбора данных', () => {
    const m = buildManifest('firefox', '1.2.3') as Record<string, any>;
    expect(m.side_panel).toBeUndefined();
    expect(m.permissions).not.toContain('sidePanel');
    expect(m.sidebar_action.default_panel).toBe('sidebar.html');
    expect(m.browser_specific_settings.gecko.id).toBe(GECKO_ID);
    expect(m.browser_specific_settings.gecko.data_collection_permissions).toEqual({ required: ['none'] });
    expect(manifestFiles(m)).toEqual(['popup.html', 'sidebar.html']);
  });
  it('права на сеть одинаковые в обоих браузерах', () => {
    expect(buildManifest('chrome', '1').host_permissions).toEqual(buildManifest('firefox', '1').host_permissions);
  });
});

describe('ZIP', () => {
  const read = (buf: Buffer) => {
    const files: Record<string, string> = {};
    let p = 0;
    while (buf.readUInt32LE(p) === 0x04034b50) {
      const method = buf.readUInt16LE(p + 8), crc = buf.readUInt32LE(p + 14), size = buf.readUInt32LE(p + 18);
      const nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
      const name = buf.subarray(p + 30, p + 30 + nlen).toString('utf8');
      const body = buf.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
      const data = method === 8 ? inflateRawSync(body) : body;
      expect(crc32(data), name).toBe(crc);
      files[name] = data.toString('utf8');
      p += 30 + nlen + xlen + size;
    }
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
    return files;
  };
  it('файлы читаются обратно, пути через «/», архив воспроизводим', () => {
    const entries = [{ name: 'b/c.txt', data: Buffer.from('б'.repeat(500)) }, { name: 'a.json', data: Buffer.from('{}') }];
    const z1 = zip(entries), z2 = zip([...entries].reverse());
    expect(z1.equals(z2)).toBe(true);
    expect(read(z1)).toEqual({ 'a.json': '{}', 'b/c.txt': 'б'.repeat(500) });
  });
  it('обратный слэш в пути — ошибка', () => {
    expect(() => zip([{ name: 'a\\b.txt', data: Buffer.from('x') }])).toThrow(/недопустимый путь/);
  });
  it('CRC-32 по известному значению', () => expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926));
});

describe('боковая панель', () => {
  it('вид определяется по имени страницы', () => {
    expect(isSidebarView('/sidebar.html')).toBe(true);
    expect(isSidebarView('/popup.html')).toBe(false);
  });
  it('без API расширения кнопки нет', () => {
    expect(extApi({})).toBeNull();
    expect(sidebarOpener(null).available).toBe(false);
  });
  it('Firefox: sidebarAction.open() вызывается синхронно', () => {
    const open = vi.fn(() => Promise.resolve());
    const o = sidebarOpener(extApi({ browser: { sidebarAction: { open } }, chrome: {} }));
    expect(o.available).toBe(true);
    expect(o.open()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('Chrome: окно узнаётся заранее, open() без await', async () => {
    const open = vi.fn((_: { windowId: number }) => Promise.resolve());
    const o = sidebarOpener(extApi({ chrome: { sidePanel: { open }, windows: { getCurrent: async () => ({ id: 7 }) } } }));
    expect(o.open()).toBe(false);                 // окно ещё не известно
    await o.prepare();
    expect(o.open()).toBe(true);
    expect(open).toHaveBeenCalledWith({ windowId: 7 });
  });
  it('Chrome без sidePanel (старый браузер) — кнопки нет', () => {
    expect(sidebarOpener(extApi({ chrome: { windows: { getCurrent: async () => ({ id: 1 }) } } })).available).toBe(false);
  });
});
