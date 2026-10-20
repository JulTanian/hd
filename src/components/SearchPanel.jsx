import React, { useState, useRef, useEffect } from 'react';
import './HongguoDownload.css';
import { Search, Film, RefreshCw, ExternalLink } from './icons';
import { isSubmitKey } from './episodeRange';
import { readSearchHistory, saveSearchTerm, clearSearchHistory, rememberCatalogTitles, getSearchSuggestions } from '../searchHistory';

import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';

/**
 * SearchPanel —— Tìm phim ngắn theo nguồn đã chọn
 * Sau khi lấy series_id sẽ chuyển cho component cha chạy luồng "lấy toàn bộ tập + chọn tập tải" có sẵn.
 */
function SearchPanel({ onSelectSeries, onSwitchToInput, active = true }) {
  const [source, setSource] = useState('all');
  const { sources: mediaSources, revision: sourceRevision, loading: sourcesLoading, error: sourcesError } = useMediaSources();
  const requestVersion = useRef(0);
  const pendingSearch = useRef(null);
  useEffect(() => () => { requestVersion.current++; }, []);
  const [keyword, setKeyword] = useState('');
  const [history, setHistory] = useState(readSearchHistory);
  const [historyError, setHistoryError] = useState('');
  const inputRef = useRef(null);
  const suggestions = getSearchSuggestions(keyword, history);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); // null=chưa tìm, []=không có kết quả
  const [error, setError] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [pickingId, setPickingId] = useState('');

  useEffect(() => {
    if (!active) {
      requestVersion.current++;
      pendingSearch.current = null;
      setPickingId('');
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    requestVersion.current++; pendingSearch.current = null;
    setLoading(false); setPickingId(''); setResults(null); setError(''); setPageTitle('');
    if (source !== 'all' && !mediaSources.some(item => item.id === source)) setSource('all');
  }, [sourceRevision, mediaSources]);

  const switchSource = (next) => {
    if (next === source) return;
    requestVersion.current++;
    pendingSearch.current = null;
    setSource(next);
    setLoading(false);
    setPickingId('');
    setResults(null);
    setError('');
    setPageTitle('');
  };

  const changeKeyword = (value) => {
    requestVersion.current++;
    pendingSearch.current = null;
    setKeyword(value);
    setLoading(false);
    setPickingId('');
    setResults(null);
    setError('');
  };

  const clearHistory = () => {
    try {
      clearSearchHistory();
      setHistory([]);
      setHistoryError('');
    } catch {
      setHistoryError('Xóa lịch sử tìm kiếm thất bại, vui lòng thử lại.');
    }
  };

  const doSearch = async () => {
    if (sourcesLoading) return;
    const kw = keyword.trim();
    if (!kw) {
      setError('Vui lòng nhập từ khóa tên phim');
      return;
    }
    const key = JSON.stringify([source, kw]);
    if (pendingSearch.current?.key === key) return;
    const request = ++requestVersion.current;
    pendingSearch.current = { key, request };
    setPickingId('');
    setLoading(true);
    setError('');
    setResults(null);
    setPageTitle('');
    try {
      const sources = source === 'all' ? mediaSources.map(item => item.id) : [source];
      const responses = await Promise.allSettled(sources.map(async (searchSource) => {
        const res = await window.electronAPI.searchSeries(kw, { source: searchSource });
        if (!res?.success) throw new Error(res?.error || 'Tìm kiếm thất bại, vui lòng thử lại');
        return res;
      }));
      if (request !== requestVersion.current) return;
      const merged = [], failures = [];
      responses.forEach((response, index) => {
        const searchSource = sources[index];
        if (response.status === 'fulfilled') {
          merged.push(...(response.value.results || []).map(item => ({ ...item, source: searchSource })));
          if (sources.length === 1) setPageTitle(response.value.pageTitle || '');
        } else {
          failures.push(`${mediaSourceLabel(searchSource, mediaSources)}: ${response.reason?.message || 'Tìm kiếm thất bại'}`);
        }
      });
      rememberCatalogTitles(merged);
      if (responses.some((response) => response.status === 'fulfilled')) {
        try {
          setHistory(saveSearchTerm(kw));
          setHistoryError('');
        } catch {
          setHistoryError('Kết quả tìm kiếm đã hiển thị, nhưng lưu lịch sử tìm kiếm trên máy thất bại.');
        }
      }
      setResults(merged);
      if (failures.length) setError(`${failures.join('; ')}. ${merged.length ? 'Đã hiển thị kết quả từ nguồn khác.' : ''}Vui lòng thử lại hoặc chuyển nguồn.`);
    } catch (e) {
      if (request !== requestVersion.current) return;
      setError('Lỗi tìm kiếm: ' + e.message);
      setResults([]);
    } finally {
      if (pendingSearch.current?.request === request) pendingSearch.current = null;
      if (request === requestVersion.current) setLoading(false);
    }
  };

  // Chọn một bộ phim -> lấy toàn bộ tập -> chuyển cho trang tải
  const pick = async (item) => {
    const request = ++requestVersion.current;
    setPickingId(item.series_id);
    setError('');
    try {
      const res = await window.electronAPI.searchResolve(item.series_id);
      if (request !== requestVersion.current) return;
      if (res && res.success && res.data) {
        onSelectSeries(res.data);
      } else {
        setError((res && res.error) || 'Lấy danh sách tập thất bại');
      }
    } catch (e) {
      if (request === requestVersion.current) setError('Lấy danh sách tập lỗi: ' + e.message);
    } finally {
      if (request === requestVersion.current) setPickingId('');
    }
  };

  const showBrowser = async () => {
    try {
      const res = await window.electronAPI.searchWindowShow(true);
      if (res?.success === false) throw new Error(res.error || 'Mở trang nguồn thất bại');
    } catch (e) { setError(e.message || 'Mở trang nguồn thất bại, vui lòng thử lại'); }
  };

  return (
    <div className="hongguo-card">
      <div className="card-header-title">
        <Search size={18} />
        <span>Tìm phim ngắn</span>
        <label className="source-control">Nguồn<select className="input-field" aria-label="Nguồn phim ngắn" value={source} onChange={(e) => switchSource(e.target.value)}><option value="all">Tất cả nguồn</option>{mediaSources.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>

      {sourcesError && <p className="settings-hint" role="status">Cập nhật danh sách nguồn thất bại, tạm dùng danh sách cũ; có thể lưu lại nguồn trong cài đặt rồi thử lại.</p>}
      <div className="input-group">
        <input
          type="text"
          className="input-field"
          aria-label="Tìm tên phim ngắn"
          aria-describedby="search-suggestions-hint"
          ref={inputRef}
          list="local-search-suggestions"
          autoComplete="off"
          placeholder="Nhập tên phim, ví dụ: Một làng nuôi một vị thần"
          value={keyword}
          onChange={(e) => changeKeyword(e.target.value)}
          onKeyDown={(e) => isSubmitKey(e) && doSearch()}
        />
        <button className="btn btn-primary" onClick={doSearch} disabled={loading || sourcesLoading}>
          {loading ? (
            <>
              <RefreshCw size={16} className="spin" />
              <span>Đang tìm...</span>
            </>
          ) : (
            <>
              <Search size={16} />
              <span>Tìm kiếm</span>
            </>
          )}
        </button>
      </div>
      <datalist id="local-search-suggestions">
        {suggestions.map(({ term, source: origin }) => <option key={term} value={term} label={origin} />)}
      </datalist>
      <p className="settings-hint search-suggestions-hint" id="search-suggestions-hint">Gợi ý trên máy: khớp với lịch sử tìm kiếm và tên phim thật đã xem lần này.</p>
      {history.length > 0 && <div className="search-history">
        <div className="search-history-heading"><span>Lịch sử tìm kiếm trên máy</span><button type="button" className="btn-chip" onClick={clearHistory}>Xóa lịch sử</button></div>
        <div className="search-history-terms">{history.map((term) => <button type="button" className="btn-chip" key={term} title={term} onClick={() => { changeKeyword(term); inputRef.current?.focus(); }}>{term}</button>)}</div>
      </div>}
      {historyError && <p className="search-history-error" role="alert">{historyError}</p>}
      <p className="settings-hint" style={{ marginTop: 8 }}>
        {source === 'all' ? 'Tìm đồng thời tất cả nguồn đã bật, kết quả ghi rõ nguồn; chọn một bộ để xem toàn bộ tập.' : 'Tìm theo tên phim, chọn một bộ để xem toàn bộ tập.'}
      </p>

      {results === null && !loading && !error && (
        <div className="search-welcome"><Search size={36} /><h3>Câu chuyện hay, bắt đầu từ một cái tên</h3><p>Nhập đầy đủ tên phim hoặc từ khóa để khám phá phim ngắn bạn muốn xem.</p></div>
      )}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {loading && (
        <div className="search-loading">
          <RefreshCw size={18} className="spin" />
          <span>Đang tìm phim ngắn liên quan, lần đầu tải có thể mất vài giây…</span>
        </div>
      )}

      {results && results.length === 0 && !loading && !error && (
        <div className="search-empty">
          <p>Không tìm thấy phim ngắn liên quan{pageTitle ? ` (tiêu đề trang: ${pageTitle})` : ''}</p>
          <div className="search-empty-actions">
            {source === 'hongguo' && <button className="btn btn-outline" onClick={showBrowser}>
              <ExternalLink size={15} />
              Mở trang nguồn
            </button>}
            {source === 'hongguo' && onSwitchToInput && (
              <button className="btn btn-outline" onClick={onSwitchToInput}>
                Chuyển sang tải bằng link / ID
              </button>
            )}
          </div>
        </div>
      )}

      {results && results.length > 0 && (
        <>
          <div className="search-count">Tìm thấy {results.length} bộ phim ngắn liên quan</div>
          <div className="search-grid">
            {results.map((item) => (
              <button
                type="button"
                disabled={pickingId !== ''}
                key={`${item.source}:${item.series_id}`}
                className={`search-card ${pickingId === item.series_id ? 'picking' : ''}`}
                onClick={() => pickingId === '' && pick(item)}
                title={`Nhấp để xem và tải: ${item.series_title}`}
              >
                <div className="search-cover">
                  {item.cover ? (
                    <img src={item.cover} alt={item.series_title} loading="lazy" />
                  ) : (
                    <div className="cover-placeholder">
                      <Film size={22} />
                    </div>
                  )}
                </div>
                <div className="search-card-body">
                  <div className="search-card-title">{item.series_title}</div>
                  <div className="search-card-sub">
                    {pickingId === item.series_id ? (
                      <>
                        <RefreshCw size={13} className="spin" /> Đang lấy danh sách tập…
                      </>
                    ) : (
                      <><span className="badge">{mediaSourceLabel(item.source, mediaSources)}</span>Xem tập phim</>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default SearchPanel;
