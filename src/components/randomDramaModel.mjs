import { BUILTIN_MEDIA_SOURCES, CUSTOM_SOURCE_ID, normalizeMediaSources } from './mediaSourcesModel.mjs';

export const RANDOM_SOURCES = [['all', 'Tất cả nguồn'], ['hongguo', 'Hồng Quả'], ['xifan', 'Tây Phạn'], ['hema', 'Hà Mã']];
const SOURCE_IDS = {
  hongguo: /^\d{6,30}$/,
  xifan: /^xifan:[a-zA-Z0-9_-]{1,200}:[a-zA-Z0-9_-]{1,200}$/,
  hema: /^hema:\d{1,30}$/,
};

// Yêu cầu IPC không thể hủy giữa chừng; hủy bỏ chỉ dừng chờ và mọi công việc UI/trình phát tiếp theo.
export async function waitForRequest(promise, { signal, timeoutMs = 25_000, message = 'Tải quá thời gian, vui lòng thử lại' } = {}) {
  signal?.throwIfAborted();
  let timer, abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      abort = () => reject(signal.reason || new DOMException('Đã hủy', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
    })]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function loadRandomPool(browseList, { source = 'all', forceRefresh = false, signal, timeoutMs, sources: available = BUILTIN_MEDIA_SOURCES } = {}) {
  const ids = normalizeMediaSources(available).map(item => item.id);
  const sources = source === 'all' ? ids : ids.includes(source) ? [source] : [];
  if (!sources.length) throw new Error('Vui lòng chọn nguồn hợp lệ');
  const pages = await Promise.all(sources.map(async source => {
    try {
      signal?.throwIfAborted();
      const result = await waitForRequest(browseList({ source, category: 'real-drama', page: 1, forceRefresh }), { signal, timeoutMs });
      if (!result?.success) return [];
      const seen = new Set();
      return (Array.isArray(result.results) ? result.results : []).filter(item => {
        const id = String(item?.series_id || '');
        const validId = SOURCE_IDS[source]?.test(id) || (CUSTOM_SOURCE_ID.test(source) && id.startsWith(`${source}:`) && /^\d{1,30}$/.test(id.slice(source.length + 1)));
        if (!validId || typeof item.series_title !== 'string' || !item.series_title.trim() || item.locked || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, 60).map(item => ({ ...item, series_id: String(item.series_id), series_title: item.series_title.trim(), source }));
    } catch (error) {
      if (signal?.aborted) throw error;
      return [];
    }
  }));
  signal?.throwIfAborted();
  return { items: pages.flat(), unavailable: sources.filter((_, index) => !pages[index].length) };
}

export function pickRandomDrama(items, previous, random = Math.random) {
  const candidates = items.filter(item => item.series_id !== previous?.series_id && (!previous || item.series_title !== previous.series_title));
  return candidates.length ? candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))] : null;
}

export async function playRecommendedDrama(api, item, { signal } = {}) {
  signal?.throwIfAborted();
  const result = await waitForRequest(api.searchResolve(item.series_id), { signal, message: 'Tải tập phim quá thời gian, vui lòng thử lại phim này' });
  signal?.throwIfAborted();
  if (!result?.success) throw new Error(result?.error || 'Tạm thời không tải được phim này');
  if (String(result.data?.series_id) !== String(item.series_id)) throw new Error('Phim nguồn trả về không khớp, vui lòng thử lại');
  const first = result.data.episodes?.find(episode => !episode.locked && Number.isSafeInteger(episode.vid_index) && episode.vid_index > 0);
  if (!first) throw new Error('Phim này tạm thời chưa có tập nào phát miễn phí, vui lòng chọn phim khác');
  const playback = await waitForRequest(api.playSeries({ seriesId: String(item.series_id), vidIndex: first.vid_index }), { signal, message: 'Mở thư viện phim quá thời gian, vui lòng thử lại' });
  if (!playback?.success) throw new Error(playback?.error || 'Mở thư viện phim thất bại, vui lòng thử lại');
}
