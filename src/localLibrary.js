const STORAGE_KEY = 'hongguo:public-library:v1';
const CHANGE_EVENT = 'hongguo:public-library-changed';

export const validPublishedAt = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value).getTime());

export function readLocalLibrary() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || typeof item.favorite !== 'boolean' || (item.published_at !== null && !validPublishedAt(item.published_at)))) {
      throw new Error('Định dạng dữ liệu đã lưu không chính xác');
    }
    return { items, error: '' };
  } catch (error) {
    return { items: [], error: `Không thể đọc yêu thích và lịch trên máy: ${error.message}. Dữ liệu gốc không bị thay đổi.` };
  }
}

export function saveLocalSeries({ id, title, published_at, favorite }) {
  const current = readLocalLibrary();
  if (current.error) return current;
  const seriesId = String(id || '').trim();
  if (!seriesId || !String(title || '').trim()) return { ...current, error: 'Thiếu tên hoặc mã phim, không thể lưu vào máy.' };
  const previous = current.items.find(item => item.id === seriesId);
  const next = {
    id: seriesId,
    title: String(title).trim(),
    published_at: validPublishedAt(published_at) ? published_at : previous?.published_at ?? null,
    favorite: typeof favorite === 'boolean' ? favorite : previous?.favorite ?? false,
  };
  const items = [...current.items.filter(item => item.id !== seriesId), next];
  try {
    // Chỉ lưu tiêu đề/id/ngày công khai và cờ yêu thích cục bộ, không bao giờ lưu đánh giá.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.map(item => ({ id: item.id, title: item.title, published_at: item.published_at, favorite: item.favorite }))));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return { items, error: '' };
  } catch (error) {
    return { ...current, error: `Không thể lưu vào máy: ${error.message}. Vui lòng giải phóng dung lượng lưu trữ rồi thử lại.` };
  }
}

export function subscribeLocalLibrary(callback) {
  const refresh = event => {
    if (event.type === 'storage' && event.key !== STORAGE_KEY && event.key !== null) return;
    callback(readLocalLibrary());
  };
  window.addEventListener(CHANGE_EVENT, refresh);
  window.addEventListener('storage', refresh);
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh);
    window.removeEventListener('storage', refresh);
  };
}

export function publicDateKey(timestamp) {
  if (!validPublishedAt(timestamp)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
