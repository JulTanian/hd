import React, { useCallback, useEffect, useRef, useState } from 'react';
import Player from './Player';
import { Film, Play, RefreshCw } from './icons';
import './DramaFeed.css';

const RANKINGS = [
  ['hot-drama', '热播总榜'], ['hot-real-drama', '真人短剧'],
  ['hot-comic-drama', '漫剧'], ['hot-ai-drama', 'AI 短剧'],
];

async function withDeadline(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 25_000);
    })]);
  } finally { clearTimeout(timer); }
}

function DramaFeed({ active = true, onNavigate }) {
  const [category, setCategory] = useState('hot-drama');
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [playError, setPlayError] = useState('');
  const [started, setStarted] = useState(false);
  const [target, setTarget] = useState(null);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const rootRef = useRef(null);
  const listRequest = useRef(0);
  const playRequest = useRef(0);
  const wheelState = useRef({ delta: 0, last: 0, switched: 0 });
  const selected = items[index];

  const loadList = useCallback(async (forceRefresh = false) => {
    const request = ++listRequest.current;
    playRequest.current++;
    setTarget(null);
    setStarted(false);
    setResolving(false);
    setEpisodesOpen(false);
    setPlayError('');
    setItems([]);
    setIndex(0);
    setError('');
    setLoading(true);
    try {
      const result = await withDeadline(window.electronAPI.browseList({
        source: 'hongguo', category, page: 1, forceRefresh,
      }), '热播榜加载超时，请重试');
      if (request !== listRequest.current) return;
      if (!result?.success) throw new Error(result?.error || '热播榜暂时不可用');
      const seen = new Set();
      const next = (Array.isArray(result.results) ? result.results : []).filter(item => {
        const id = String(item?.series_id || '');
        if (!/^\d{6,30}$/.test(id) || !item.series_title || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setItems(next);
    } catch (cause) {
      if (request === listRequest.current) setError(cause.message || '热播榜加载失败，请重试');
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    if (active) loadList();
    return () => { listRequest.current++; playRequest.current++; };
  }, [active, loadList]);

  const startItem = useCallback(async (nextIndex) => {
    const item = items[nextIndex];
    if (!active || !item) return;
    const request = ++playRequest.current;
    // Unmount first so the previous Player releases its source before the next one is created.
    setTarget(null);
    setIndex(nextIndex);
    setStarted(true);
    setEpisodesOpen(false);
    setPlayError('');
    setResolving(true);
    wheelState.current = { delta: 0, last: 0, switched: Date.now() };
    try {
      const result = await withDeadline(window.electronAPI.searchResolve(item.series_id), '分集加载超时，请重试本剧');
      if (request !== playRequest.current) return;
      if (!result?.success) throw new Error(result?.error || '暂时无法加载这部剧');
      if (String(result.data?.series_id) !== String(item.series_id)) throw new Error('来源返回的剧集不匹配，请重试');
      const first = result.data.episodes?.find(episode => !episode.locked && episode.vid_index > 0);
      if (!first) throw new Error('这部剧暂时没有可播放的分集');
      setTarget({ seriesId: String(item.series_id), vidIndex: first.vid_index, ts: Date.now() });
    } catch (cause) {
      if (request === playRequest.current) setPlayError(cause.message || '加载失败，请重试本剧');
    } finally {
      if (request === playRequest.current) setResolving(false);
    }
  }, [active, items]);

  const move = useCallback(direction => {
    if (loading || resolving || index + direction < 0 || index + direction >= items.length) return;
    if (started) startItem(index + direction);
    else setIndex(index + direction);
  }, [loading, resolving, index, items.length, started, startItem]);

  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;
    const onWheel = event => {
      const element = event.target instanceof Element ? event.target : null;
      if (!started || resolving || loading || event.ctrlKey || event.metaKey || !element?.closest('.player-stage')) return;
      if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (element.closest('button, input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="slider"], .player-controls')) return;
      if (root.querySelector('[role="dialog"], [role="menu"], details[open]')) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const direction = Math.sign(event.deltaY);
      if (index + direction < 0 || index + direction >= items.length) return;
      event.preventDefault();
      const now = Date.now();
      const wheel = wheelState.current;
      if (now - wheel.switched < 900) return;
      if (now - wheel.last > 180 || Math.sign(wheel.delta) !== direction) wheel.delta = 0;
      wheel.last = now;
      wheel.delta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1);
      if (Math.abs(wheel.delta) < 90) return;
      wheel.delta = 0;
      wheel.switched = now;
      move(direction);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [active, started, loading, resolving, index, items.length, move]);

  const introduction = selected?.intro || selected?.series_intro;
  return (
    <section className="drama-feed" ref={rootRef} aria-label="热播推荐">
      <header className="drama-feed-header">
        <div><h2>热播推荐</h2><p className="page-description">顺着热播榜，遇见下一部故事。</p></div>
        <button className="btn btn-outline" disabled={loading} onClick={() => loadList(true)}><RefreshCw size={15} />刷新片单</button>
      </header>
      <div className="drama-feed-categories" role="group" aria-label="选择热播榜">
        {RANKINGS.map(([value, label]) => <button key={value} className={`browse-cat ${category === value ? 'active' : ''}`}
          aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>)}
      </div>
      <p className="drama-feed-source">来自红果公开热播榜，按来源顺序展示当前返回的 {items.length} 部。不是账号个性化推荐。</p>
      {loading && <div className="drama-feed-state" role="status"><RefreshCw size={24} className="spin" /><p>正在加载真实热播片单…</p></div>}
      {!loading && (error || !selected) && <div className="drama-feed-state" role={error ? 'alert' : 'status'}>
        <Film size={32} /><h3>{error ? '暂时没能加载热播榜' : '这个榜单暂未返回剧集'}</h3>
        {error && <p>{error}</p>}
        <button className="btn btn-primary" onClick={() => loadList(true)}>重新加载</button>
        {onNavigate && <button className="btn btn-outline" onClick={() => onNavigate('download')}>按剧名搜索</button>}
      </div>}
      {!loading && selected && <>
        <div className="drama-feed-info">
          <div><h3>{selected.series_title}</h3>
            <p>第 {index + 1} / {items.length} 部{selected.rank > 0 ? ` · 榜单第 ${selected.rank} 名` : ''}{selected.heat ? ` · ${selected.heat}` : ''}</p>
            {typeof introduction === 'string' && introduction.trim() && <p className="drama-feed-intro">{introduction}</p>}
          </div>
          <div className="drama-feed-navigation" role="group" aria-label="切换推荐短剧">
            <button className="btn btn-outline" disabled={index === 0 || resolving} onClick={() => move(-1)}>上一部</button>
            <button className="btn btn-primary" disabled={index === items.length - 1 || resolving} onClick={() => move(1)}>下一部</button>
            {target && <button className="btn btn-outline" aria-expanded={episodesOpen} aria-controls="player-episode-panel" onClick={() => setEpisodesOpen(open => !open)}>{episodesOpen ? '收起选集' : '选集'}</button>}
          </div>
        </div>
        {!started && <div className="drama-feed-start">
          {selected.cover ? <img src={selected.cover} alt={`${selected.series_title}海报`} /> : <Film size={48} />}
          <div><h3>{selected.series_title}</h3><p>点击开始播放。之后在视频画面上滚轮切换上一部、下一部。</p>
            <button className="btn btn-primary" onClick={() => startItem(index)}><Play size={16} />开始刷剧</button>
          </div>
        </div>}
        {resolving && <div className="drama-feed-state" role="status"><RefreshCw size={24} className="spin" /><p>正在加载《{selected.series_title}》的分集…</p></div>}
        {playError && <div className="drama-feed-state" role="alert"><p>{playError}</p><button className="btn btn-primary" onClick={() => startItem(index)}>重试本剧</button></div>}
        {active && target && <Player key={target.seriesId} target={target} active={active} onNavigate={onNavigate}
          actionsHidden episodesOpen={episodesOpen} setEpisodesOpen={setEpisodesOpen} />}
        {started && <p className="drama-feed-hint">视频画面上滚轮切剧；播放器内切集和连播仍属于当前这部剧。{index === items.length - 1 ? '已到本次片单末尾，可切换榜单或刷新。' : ''}</p>}
      </>}
    </section>
  );
}

export default DramaFeed;
