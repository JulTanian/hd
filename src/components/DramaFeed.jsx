import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Play, RefreshCw } from './icons';
import RandomDrama, { DramaPoster } from './RandomDrama';
import { playRecommendedDrama, waitForRequest } from './randomDramaModel.mjs';
import './DramaFeed.css';

const RANKINGS = [
  ['hot-drama', 'BXH tổng hợp'], ['hot-real-drama', 'Phim người thật'],
  ['hot-comic-drama', 'Phim hoạt họa'], ['hot-ai-drama', 'Phim AI'],
];

function DramaFeed({ active = true, onNavigate }) {
  const [category, setCategory] = useState('hot-drama');
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [playError, setPlayError] = useState('');
  const [randomRefresh, setRandomRefresh] = useState(0);
  const listController = useRef(null);
  const playController = useRef(null);
  const selected = items[index];
  const random = category === 'random';

  const loadList = useCallback(async (forceRefresh = false) => {
    listController.current?.abort(); playController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setResolving(false); setPlayError(''); setItems([]); setIndex(0); setError(''); setLoading(true);
    try {
      const result = await waitForRequest(window.electronAPI.browseList({
        source: 'hongguo', category, page: 1, forceRefresh,
      }), { signal: controller.signal, message: 'Tải BXH hot quá thời gian, vui lòng thử lại' });
      if (controller.signal.aborted) return;
      if (!result?.success) throw new Error(result?.error || 'BXH hot tạm thời không khả dụng');
      const seen = new Set();
      setItems((Array.isArray(result.results) ? result.results : []).filter(item => {
        const id = String(item?.series_id || '');
        if (!/^\d{6,30}$/.test(id) || typeof item.series_title !== 'string' || !item.series_title.trim() || seen.has(id)) return false;
        seen.add(id); return true;
      }));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || 'Tải BXH hot thất bại, vui lòng thử lại');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [category]);

  useEffect(() => {
    if (active && !random) loadList();
    return () => { listController.current?.abort(); playController.current?.abort(); };
  }, [active, random, loadList]);

  const startItem = async () => {
    if (!active || !selected || resolving) return;
    playController.current?.abort();
    const controller = new AbortController();
    playController.current = controller;
    setPlayError(''); setResolving(true);
    try { await playRecommendedDrama(window.electronAPI, selected, { signal: controller.signal }); }
    catch (cause) { if (!controller.signal.aborted) setPlayError(cause.message || 'Tải thất bại, vui lòng thử lại phim này'); }
    finally { if (!controller.signal.aborted) setResolving(false); }
  };

  const selectItem = next => {
    if (loading || resolving || next < 0 || next >= items.length) return;
    setPlayError(''); setIndex(next);
  };

  const introduction = selected?.intro || selected?.series_intro;
  const upcoming = items.slice(index + 1, index + 5);
  return <section className="drama-feed" aria-label="Đề xuất hot">
    <header className="drama-feed-header">
      <div><h2>Đề xuất hot</h2><p className="page-description">Theo bảng xếp hạng hot, gặp gỡ câu chuyện tiếp theo.</p></div>
      <button className="btn btn-outline" disabled={!random && loading} onClick={() => random ? setRandomRefresh(value => value + 1) : loadList(true)}><RefreshCw size={15} />Làm mới danh sách</button>
    </header>
    <div className="drama-feed-categories" role="group" aria-label="Chọn cách đề xuất">
      {RANKINGS.map(([value, label]) => <button key={value} className={`browse-cat ${category === value ? 'active' : ''}`}
        aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>)}
      <button className={`browse-cat drama-random-tab ${random ? 'active' : ''}`} aria-pressed={random} onClick={() => setCategory('random')}>Lắc máy</button>
    </div>
    {random ? <RandomDrama active={active} refreshKey={randomRefresh} onNavigate={onNavigate} /> : <>
      <div className="drama-feed-list-meta"><p>BXH hot công khai của Hồng Quả{items.length > 0 ? ` · lần này ${items.length} bộ` : ''}</p><span>Theo thứ tự BXH nguồn</span></div>
      {loading && <div className="drama-feed-state" role="status"><RefreshCw size={24} className="spin" /><p>Đang tải danh sách hot thực tế…</p>
        <button className="btn btn-outline" onClick={() => { listController.current?.abort(); setLoading(false); setError('Đã hủy tải, có thể thử lại hoặc đổi BXH.'); }}>Hủy tải</button>
      </div>}
      {!loading && (error || !selected) && <div className="drama-feed-state" role={error ? 'alert' : 'status'}>
        <Film size={32} /><h3>{error ? 'Tạm thời không tải được BXH hot' : 'BXH này chưa trả về phim nào'}</h3>
        {error && <p>{error}</p>}
        <div className="drama-feed-actions"><button className="btn btn-primary" onClick={() => loadList(true)}>Tải lại</button>
          {onNavigate && <button className="btn btn-outline" onClick={() => onNavigate('download')}>Tìm theo tên phim</button>}</div>
      </div>}
      {!loading && selected && <>
        <div className="drama-feed-feature">
          <DramaPoster item={selected} />
          <div className="drama-feed-copy">
            <p className="drama-feed-rank">{selected.rank > 0 ? `Hạng ${selected.rank} BXH` : `Bộ thứ ${index + 1} trong danh sách`}{selected.heat ? ` · ${selected.heat}` : ''}</p>
            <h3>{selected.series_title}</h3>
            <p className="drama-feed-tags">{[selected.episode_count > 0 && `${selected.episode_count} tập`, ...(selected.tags || [])].filter(Boolean).join(' · ') || 'Từ danh sách công khai Hồng Quả'}</p>
            {typeof introduction === 'string' && introduction.trim() && <p className="drama-feed-intro">{introduction}</p>}
            <p className="drama-feed-play-note">Chọn tập, phát và xem tiếp từ lần trước trong "Thư viện phim của tôi".</p>
            <div className="drama-feed-actions"><button className="btn btn-primary" disabled={resolving} onClick={startItem}><Play size={16} />{resolving ? 'Đang mở thư viện…' : 'Phát trong thư viện'}</button>
              {resolving && <button className="btn btn-outline" onClick={() => { playController.current?.abort(); setResolving(false); setPlayError('Đã hủy tải, có thể thử lại phim này.'); }}>Hủy tải</button>}</div>
            {playError && <p className="drama-inline-error" role="alert">{playError}</p>}
          </div>
        </div>
        <div className="drama-feed-navigation">
          <span aria-live="polite">Bộ <strong>{index + 1}</strong> / {items.length}</span>
          <div className="drama-feed-actions" role="group" aria-label="Chuyển phim đề xuất">
            <button className="btn btn-outline" disabled={index === 0 || resolving} onClick={() => selectItem(index - 1)}>Bộ trước</button>
            <button className="btn btn-outline" disabled={index === items.length - 1 || resolving} onClick={() => selectItem(index + 1)}>Bộ tiếp theo</button>
          </div>
        </div>
        {upcoming.length > 0 ? <div className="drama-feed-upcoming"><h4>Xem tiếp</h4><div className="drama-feed-upcoming-list">
          {upcoming.map((item, offset) => <button key={item.series_id} className="drama-feed-next" disabled={resolving} onClick={() => selectItem(index + offset + 1)}>
            <DramaPoster item={item} /><span><strong>{item.series_title}</strong><small>{item.rank > 0 ? `Hạng ${item.rank} BXH` : `Bộ thứ ${index + offset + 2}`}</small></span>
          </button>)}
        </div></div> : <p className="drama-feed-hint">Đã đến cuối danh sách, hãy đổi BXH hoặc lắc máy để khám phá câu chuyện mới.</p>}
        <p className="drama-feed-source">BXH lấy từ trang công khai Hồng Quả, không phải đề xuất cá nhân hóa theo tài khoản.</p>
      </>}
    </>}
  </section>;
}

export default DramaFeed;
