// Манифест расширения для двух браузеров. Собирается при сборке (build/extension-plugin.ts), в public/ его нет.
// Chrome: попап + боковая панель (side_panel, API sidePanel, Chrome 116+).
// Firefox: попап + боковая панель (sidebar_action), gecko id и раскрытие сбора данных для AMO.

export type Target = 'chrome' | 'firefox';

/** Gecko id для AMO. Заглушка: при первой публикации можно заменить, после публикации менять нельзя. */
export const GECKO_ID = 'vin-decoder@shibisty';

export function buildManifest(target: Target, version: string): Record<string, unknown> {
  const base = {
    manifest_version: 3,
    name: 'VIN-декодер',
    version,
    description: 'Расшифровка VIN: локальные таблицы, офлайн-копия базы NHTSA vPIC, фото модели из Wikipedia.',
    action: { default_popup: 'popup.html', default_title: 'VIN-декодер' },
    host_permissions: ['https://api.nhtsa.gov/*', 'https://en.wikipedia.org/*', 'https://commons.wikimedia.org/*'],
    permissions: ['clipboardWrite'] as string[],
  };
  if (target === 'chrome') {
    return {
      ...base,
      permissions: [...base.permissions, 'sidePanel'],
      side_panel: { default_path: 'sidebar.html' },
      minimum_chrome_version: '116',          // chrome.sidePanel.open()
    };
  }
  return {
    ...base,
    sidebar_action: { default_panel: 'sidebar.html', default_title: 'VIN-декодер', open_at_install: false },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '142.0',          // с 140 (Android — 142) Firefox сам показывает раскрытие сбора данных
        // Расширение ничего не собирает для себя: введённый VIN уходит только в API NHTSA (отзывы, расшифровка),
        // название модели — в Wikipedia за фото; аналитики и своих серверов нет. См. README, раздел про Firefox.
        data_collection_permissions: { required: ['none'] },
      },
    },
  };
}
