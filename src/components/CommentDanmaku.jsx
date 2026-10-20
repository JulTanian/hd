import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DANMAKU_SETTINGS, normalizeDanmakuSettings, createCommentFeed, appendCommentPage, commentIsBlocked, advanceDanmaku } from './danmakuModel.mjs';
import './CommentDanmaku.css';

const STORAGE_KEY = 'hongguo:comment-danmaku:v1';
const EMPTY = [];
const readPreferences = () => {
  try { const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY)); return { enabled: value?.enabled === true, ...normalizeDanmakuSettings(value) }; }
  catch { return { enabled: false, ...DEFAULT_DANMAKU_SETTINGS }; }
};

export function useCommentDanmaku({ seriesId, episodeId, active }) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [saveError, setSaveError] = useState('');
  const [visible, setVisible] = useState(() => !document.hidden);
  const [, refresh] = useState(0);
  const feed = useMemo(() => createCommentFeed(seriesId, episodeId), [seriesId, episodeId]);
  const currentFeed = useRef(feed);
  currentFeed.current = feed;
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const supported = /^\d{6,30}$/.test(String(seriesId || '')) && /^\d{6,30}$/.test(String(episodeId || ''));
  const enabled = preferences.enabled && supported;
  const running = enabled && active && visible;

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (!running) return;
    const fetchNext = async () => {
      if (document.hidden || feed.loading || !feed.hasMore || feed.error || feed.comments.length - feed.animation.cursor >= 10 || Date.now() - feed.lastRequest < 1500) return;
      feed.loading = true;
      feed.lastRequest = Date.now();
      refresh(value => value + 1);
      try {
        const data = await window.electronAPI?.getEpisodeComments?.({ seriesId: feed.seriesId, episodeId: feed.episodeId, cursor: feed.cursor, limit: 30 });
        if (currentFeed.current !== feed) return;
        appendCommentPage(feed, data, preferencesRef.current);
      } catch {
        if (currentFeed.current === feed) feed.error = 'Tải bình luận tập này thất bại, có thể thử lại để tiếp tục tải';
      } finally {
        feed.loading = false;
        if (currentFeed.current === feed) refresh(value => value + 1);
      }
    };
    fetchNext();
    const timer = window.setInterval(fetchNext, 1500);
    return () => window.clearInterval(timer);
  }, [running, feed]);

  const update = patch => {
    const next = { enabled: preferences.enabled, ...preferences, ...patch };
    const validated = { enabled: next.enabled === true, ...normalizeDanmakuSettings(next) };
    setPreferences(validated);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validated)); setSaveError(''); }
    catch { setSaveError('Cài đặt đã có hiệu lực, nhưng lưu trên máy thất bại'); }
  };
  const settings = useMemo(() => normalizeDanmakuSettings(preferences), [preferences]);
  const status = !supported ? 'Chỉ tập hiện tại từ nguồn Hồng Quả mới hỗ trợ đạn bình luận' : !enabled ? 'Bật để hiển thị bình luận công khai của tập này' : !active ? 'Phát tập này để hiển thị đạn bình luận'
    : !visible ? '' : feed.error || (feed.loading ? 'Đang tải bình luận tiếp theo của tập này…' : feed.notice) || (!feed.loaded ? 'Đang tải bình luận tập này…'
      : feed.comments.length ? `Đã đọc ${feed.comments.length} bình luận của tập này${feed.hasMore ? ', sẽ tiếp tục tải khi phát' : ', bình luận hiện có đã đọc hết'}` : 'Tập này chưa có bình luận công khai nào để hiển thị');
  return { enabled, supported, running, settings, feed, comments: feed.comments, status, saveError, error: feed.error,
    loading: running && feed.loading, toggle: () => update({ enabled: !preferences.enabled }), update,
    reset: () => update(DEFAULT_DANMAKU_SETTINGS), retry: () => { feed.error = ''; feed.emptyPages = 0; refresh(value => value + 1); } };
}

export default function CommentDanmaku({ videoRef, source, available, danmaku }) {
  const layerRef = useRef(null);
  const nodes = useRef(new Map());
  const [items, setItems] = useState([]);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const { running, settings, comments, feed } = danmaku;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const state = feed.animation;
    state.items = state.items.filter(item => !commentIsBlocked(item.content, settings));
    let nextY = 12;
    for (const item of [...state.items].sort((a, b) => a.y - b.y)) {
      item.width = (Array.from(item.text).length + 1) * settings.fontSize;
      item.y = Math.max(item.y, nextY);
      nextY = item.y + settings.fontSize + 12;
    }
    setItems([...state.items]);
    const layer = layerRef.current;
    const video = videoRef.current;
    if (!running || !available || !layer || !video) return;
    let frame = 0;
    let previous = 0;
    let width = layer.clientWidth;
    let height = layer.clientHeight;
    const controls = layer.parentElement?.querySelector('.player-controls');
    const options = () => ({ width, height, settings, reducedMotion, bottomInset: Math.max(76, (controls?.clientHeight || 0) + 8) });
    const reset = () => {
      state.items = [];
      state.cooldown = 0;
      previous = 0;
      setItems([...state.items]);
    };
    const paint = () => state.items.forEach(item => {
      const node = nodes.current.get(item.id);
      if (node) node.style.transform = `translate(${item.x}px, ${item.y}px)`;
    });
    const canAdvance = () => !video.paused && !video.ended && !video.seeking && video.readyState >= 2 && !document.hidden;
    const tick = now => {
      frame = 0;
      if (!canAdvance()) { previous = 0; return; }
      const delta = previous ? Math.min((now - previous) / 1000, 0.1) * video.playbackRate : 0.001;
      previous = now;
      if (advanceDanmaku(state, comments, delta, options())) setItems([...state.items]);
      paint();
      frame = requestAnimationFrame(tick);
    };
    const start = () => { if (!frame && canAdvance()) { previous = 0; frame = requestAnimationFrame(tick); } };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; };
    const seek = () => { stop(); reset(); };
    const resize = () => {
      const nextWidth = layer.clientWidth;
      const nextHeight = layer.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth; height = nextHeight;
      reset(); start();
    };
    // Cài đặt giữ nguyên quỹ đạo và mức tiêu thụ hiện tại; chỉ bình luận mới dùng làn mới.
    start();
    const observer = new ResizeObserver(resize);
    observer.observe(layer);
    const events = { playing: start, play: start, seeked: start, canplay: start, pause: stop, ended: stop, waiting: stop, seeking: seek, emptied: seek };
    Object.entries(events).forEach(([name, handler]) => video.addEventListener(name, handler));
    return () => { stop(); observer.disconnect(); Object.entries(events).forEach(([name, handler]) => video.removeEventListener(name, handler)); };
  }, [running, available, comments, settings, reducedMotion, source, videoRef, feed]);

  if (!running || !available) return null;
  return <div ref={layerRef} className={`comment-danmaku ${reducedMotion ? 'comment-danmaku-static' : ''}`}>
    <div aria-hidden="true" style={{ opacity: settings.opacity / 100, fontSize: settings.fontSize }}>
      {(comments.length ? items : EMPTY).map(item => <span className="comment-danmaku-item" key={item.id} ref={node => { if (node) nodes.current.set(item.id, node); else nodes.current.delete(item.id); }}
        style={{ transform: `translate(${item.x}px, ${item.y}px)` }}>{item.text}</span>)}
    </div>
  </div>;
}

export function DanmakuSettings({ danmaku, onClose, panelRef, maxHeight }) {
  const { settings, update } = danmaku;
  return <div className="danmaku-settings" ref={panelRef} role="dialog" aria-label="Cài đặt đạn bình luận" data-player-menu style={{ maxHeight }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="danmaku-settings-heading"><strong>Đạn bình luận</strong><button type="button" aria-label="Đóng cài đặt đạn" onClick={onClose}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button></div>
    <p>Bình luận công khai của tập này hiển thị lần lượt, không tương ứng với thời gian video. Xem toàn văn trong "Đánh giá & Yêu thích".</p>
    <label>Độ mờ <output>{settings.opacity}%</output><input autoFocus aria-label="Độ mờ đạn" type="range" min="20" max="100" step="5" value={settings.opacity} onChange={event => update({ opacity: Number(event.target.value) })} /></label>
    <label>Cỡ chữ <output>{settings.fontSize}px</output><input aria-label="Cỡ chữ đạn" type="range" min="16" max="32" step="2" value={settings.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })} /></label>
    <label>Tốc độ cuộn <output>{settings.speed}×</output><input aria-label="Tốc độ cuộn đạn" type="range" min="0.5" max="2" step="0.25" value={settings.speed} onChange={event => update({ speed: Number(event.target.value) })} /></label>
    <label>Vùng hiển thị<select aria-label="Vùng hiển thị đạn" value={settings.area} onChange={event => update({ area: event.target.value })}><option value="quarter">Một phần tư màn hình</option><option value="half">Nửa màn hình</option><option value="full">Toàn màn hình</option></select></label>
    <label>Mật độ đạn<select aria-label="Mật độ đạn" value={settings.density} onChange={event => update({ density: event.target.value })}><option value="sparse">Thưa</option><option value="normal">Vừa phải</option><option value="dense">Dày</option></select></label>
    <label className="danmaku-filter-toggle">Lọc từ nhạy cảm tích hợp<input aria-label="Lọc từ nhạy cảm tích hợp" type="checkbox" checked={settings.sensitiveFilter} onChange={event => update({ sensitiveFilter: event.target.checked })} /></label>
    <label>Từ chặn tùy chỉnh<textarea aria-label="Từ chặn tùy chỉnh" rows="3" maxLength="10000" value={settings.blockedWords} placeholder="Mỗi dòng một từ, có thể phân tách bằng dấu phẩy" onChange={event => update({ blockedWords: event.target.value })} /></label>
    <p>Từ tích hợp gồm các từ chính trị và xúc phạm phổ biến; từ tùy chỉnh luôn có hiệu lực. Khi trúng sẽ ẩn cả bình luận, chỉ lưu trên máy này. Từ điển không bao phủ được mọi cách diễn đạt hoặc biến thể.</p>
    <p>Mặc định hiển thị ở nửa trên màn hình. Theo dõi tạm dừng và tốc độ phát; khi hệ thống bật giảm hiệu ứng chuyển động, chuyển sang luân phiên tĩnh.</p>
    <p role="status">{danmaku.saveError || danmaku.status}</p>
    <div className="danmaku-settings-actions">{danmaku.error && <button type="button" onClick={danmaku.retry}>Tiếp tục tải</button>}<button type="button" onClick={danmaku.reset}>Khôi phục mặc định</button></div>
  </div>;
}
