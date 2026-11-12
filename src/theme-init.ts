// Выполняется до отрисовки: применяет сохранённую тему и язык интерфейса и отмечает вид страницы
// (sidebar.html — боковая панель, иначе попап: от вида зависит ширина, см. popup.css).
document.documentElement.dataset.view = /\/sidebar\.html$/.test(location.pathname) ? 'sidebar' : 'popup';
// Подключается обычным (не модульным) скриптом в <head>, поэтому собирается отдельно и без импортов.
try {
  const root = document.documentElement;
  const th = localStorage.getItem('theme');
  if (th === 'light' || th === 'dark') root.dataset.theme = th;
  const lg = localStorage.getItem('lang') || (/^(ru|uk|be)/i.test(navigator.language || '') ? 'ru' : 'en');
  root.lang = lg;
} catch { /* хранилище недоступно: останутся системные настройки */ }
