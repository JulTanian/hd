import React, { useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, Clock } from './icons';
import './WatchHistory.css';

export default function WatchHistory({ active = true, onNavigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const request = useRef(0);
  const openingRef = useRef(false);

  const load = async () => {
    const version = ++request.current;
    try {
      const result = await window.electronAPI.getWatchHistory();
      if (version !== request.current) return;
      if (!result?.success) throw new Error(result?.error || 'Tải lịch sử xem thất bại');
      setRows(result.results || []);
      setError('');
    } catch (failure) {
      if (version === request.current) setError(failure.message || 'Tải lịch sử xem thất bại, vui lòng thử lại');
    } finally { if (version === request.current) setLoading(false); }
  };

  useEffect(() => {
    if (active) load();
    return () => { request.current++; };
  }, [active]);
  useEffect(() => window.electronAPI.onWatchHistoryUpdated?.(() => { if (active) load(); }), [active]);

  const checkUpdates = async () => {
    setChecking(true); setStatus(''); setError('');
    try {
      const result = await window.electronAPI.refreshWatchHistory();
      if (!result?.success) throw new Error(result?.error || 'Kiểm tra thất bại, vui lòng thử lại');
      await load();
      setStatus(`Đã kiểm tra ${result.checked} bộ${result.failed ? `, ${result.failed} bộ kiểm tra chưa đầy đủ, có thể thử lại sau` : ''}${result.remaining ? `; còn ${result.remaining} bộ, nhấp để tiếp tục kiểm tra` : ''}`);
    } catch (failure) { setError(failure.message || 'Kiểm tra thất bại, vui lòng thử lại'); }
    finally { setChecking(false); }
  };

  const resume = async (row, sequel = null) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(row.series_id); setError('');
    try {
      if (sequel) {
        const detail = await window.electronAPI.searchResolve(sequel.series_id);
        if (!detail?.success) throw new Error(detail?.error || 'Chi tiết phần tiếp theo tạm thời không khả dụng');
        const episode = detail.data?.episodes?.find(item => !item.locked);
        if (!episode) throw new Error('Phần tiếp theo tạm thời chưa có tập nào phát được');
        const result = await window.electronAPI.playSeries({ seriesId: sequel.series_id, vidIndex: episode.vid_index });
        if (!result?.success) throw new Error(result?.error || 'Mở trình phát thất bại');
      } else {
        const result = await window.electronAPI.playSeries({ seriesId: row.series_id, vidIndex: row.vid_index, resume: true });
        if (!result?.success) throw new Error(result?.error || 'Mở trình phát thất bại');
      }
      const acknowledged = await window.electronAPI.acknowledgeWatchUpdates(row.series_id, { total: row.total, sequelIds: (row.sequels || []).map(item => item.series_id) });
      if (!acknowledged?.success) throw new Error(acknowledged?.error || 'Lưu đánh dấu cập nhật thất bại');
      setRows(current => current.map(item => item.series_id === row.series_id ? { ...item, hasUpdates: false, unreadEpisodes: 0 } : item));
    } catch (failure) { setError(failure.message || 'Mở thất bại, vui lòng thử lại'); }
    finally { setOpening(''); openingRef.current = false; }
  };

  return <section className="history-container" aria-labelledby="history-title">
    <div className="history-header">
      <div><h1 id="history-title">Lịch sử xem</h1><p>Tiếp tục câu chuyện lần trước. Lịch sử chỉ lưu trên máy này.</p></div>
      <button className="btn btn-outline" onClick={checkUpdates} disabled={checking || loading || !rows.length}>
        <RefreshCw size={15} className={checking ? 'spin' : ''} />{checking ? 'Đang kiểm tra cập nhật…' : 'Kiểm tra cập nhật'}
      </button>
    </div>
    <p className="history-hint">Trong thời gian chạy tự động kiểm tra tập mới; phần mới cùng tên nhưng khác mã phim sẽ được đánh dấu "nghi ngờ phần tiếp theo". Có thể tắt kiểm tra hoặc bật thông báo hệ thống trong cài đặt.</p>
    {error && <div className="history-error" role="alert"><span>{error}</span><button className="btn btn-outline btn-sm" onClick={load}>Tải lại</button></div>}
    {status && <p className="history-hint" role="status">{status}</p>}
    {loading ? <p role="status">Đang đọc lịch sử xem…</p> : !rows.length ? <div className="history-empty">
      <Clock size={30} /><h2>Chưa có lịch sử xem</h2><p>Sau khi thực sự bắt đầu phát, phim ngắn và tiến độ sẽ xuất hiện ở đây.</p>
      <button className="btn btn-primary" onClick={() => onNavigate?.('browse')}>Khám phá phim ngắn</button>
    </div> : <ul className="history-list">{rows.map(row => <li className="history-row" key={row.series_id}>
      <button className="history-resume" onClick={() => resume(row)} disabled={!!opening} aria-label={`Tiếp tục xem ${row.series_title} tập ${row.vid_index}${row.hasUpdates ? `, có cập nhật${row.unreadEpisodes ? `, thêm ${row.unreadEpisodes} tập` : ', phát hiện phần tiếp theo nghi ngờ'}` : ''}`}>
        {row.cover ? <img className="history-cover" src={row.cover} alt="" loading="lazy" /> : <span className="history-cover history-cover-empty"><Play size={20} /></span>}
        <span className="history-copy">
          <span className="history-name">{row.hasUpdates && <span className="history-dot" role="img" aria-label="Có cập nhật" />}{row.series_title}</span>
          <span className="history-progress">Đang xem tập {row.vid_index} / tổng {row.total} tập · {Math.floor((row.currentTime || 0) / 60)}:{String(Math.floor((row.currentTime || 0) % 60)).padStart(2, '0')}</span>
          <span className="history-time">Xem gần nhất {new Date(row.updatedAt).toLocaleString('vi-VN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
          {row.unreadEpisodes > 0 && <span className="history-update">Thêm {row.unreadEpisodes} tập</span>}
        </span>
        <span className="history-action"><Play size={15} />{opening === row.series_id ? 'Đang mở…' : 'Tiếp tục xem'}</span>
      </button>
      {!!row.sequels?.length && <div className="history-sequels"><span>Phần tiếp theo nghi ngờ</span>{row.sequels.map(sequel => <button key={sequel.series_id} className="btn btn-outline btn-sm" disabled={!!opening} onClick={() => resume(row, sequel)}>{sequel.series_title}</button>)}</div>}
      {row.lastCheckError && <p className="history-check-error">Kiểm tra cập nhật chưa xong: {row.lastCheckError}</p>}
    </li>)}</ul>}
  </section>;
}
