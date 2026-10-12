const STORAGE_KEY = 'hongguo-experience-preview:theme';
const PREFERENCES = ['system', 'light', 'dark'];

export function getThemePreference() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return PREFERENCES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(preference) {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemePreference(preference) {
  if (!PREFERENCES.includes(preference)) throw new Error('请选择浅色、深色或跟随系统');
  window.localStorage.setItem(STORAGE_KEY, preference);
  applyTheme(preference);
}

export function initializeTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const refresh = () => applyTheme(getThemePreference());
  refresh();
  media.addEventListener('change', refresh);
  return () => media.removeEventListener('change', refresh);
}
