// Открытие боковой панели из попапа: Chrome — chrome.sidePanel.open({ windowId }), Firefox — browser.sidebarAction.open().
// Оба вызова работают только в обработчике действия пользователя, поэтому id окна узнаётся заранее (prepare),
// а сам open() вызывается синхронно, без await перед ним.

interface ExtLike {
  sidePanel?: { open(o: { windowId: number }): Promise<void> };
  sidebarAction?: { open(): Promise<void> };
  windows?: { getCurrent(): Promise<{ id?: number }> };
}

/** API расширения: browser (Firefox) или chrome (Chrome); вне расширения — null */
export function extApi(g: unknown = globalThis): ExtLike | null {
  const o = g as { browser?: ExtLike; chrome?: ExtLike };
  return o.browser ?? o.chrome ?? null;
}

export interface SidebarOpener {
  /** Есть ли у браузера боковая панель для расширения */
  readonly available: boolean;
  /** Узнать окно заранее (Chrome); вызвать при открытии попапа */
  prepare(): Promise<void>;
  /** Открыть панель; true — вызов отправлен. Вызывать прямо в обработчике клика */
  open(): boolean;
}

export function sidebarOpener(api: ExtLike | null): SidebarOpener {
  if (api && api.sidebarAction) {
    const sa = api.sidebarAction;
    return { available: true, prepare: async () => {}, open: () => { sa.open().catch(() => {}); return true; } };
  }
  if (api && api.sidePanel && api.windows) {
    const sp = api.sidePanel, win = api.windows;
    let windowId: number | undefined;
    return {
      available: true,
      prepare: async () => { try { windowId = (await win.getCurrent()).id; } catch { windowId = undefined; } },
      open: () => {
        if (windowId === undefined) return false;
        sp.open({ windowId }).catch(() => {});
        return true;
      },
    };
  }
  return { available: false, prepare: async () => {}, open: () => false };
}

/** Страница открыта в боковой панели (sidebar.html), а не в попапе */
export const isSidebarView = (path: string): boolean => /\/sidebar\.html$/.test(path);
