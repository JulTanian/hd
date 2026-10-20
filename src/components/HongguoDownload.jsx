import React, { useState, useRef, useEffect } from 'react';
import './HongguoDownload.css';
import { Film, Download, CheckSquare, Square, RefreshCw, Folder, Link2, Search, Play } from './icons';
import SearchPanel from './SearchPanel';
import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { isSubmitKey, parseEpisodeRange } from './episodeRange';


function HongguoDownload({ onNavigate, active = true }) {
  const { sources: mediaSources, revision: sourceRevision } = useMediaSources();
  const [tab, setTab] = useState('search'); // 'search' | 'input'
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Kết quả phân tích phim ngắn
  const [seriesData, setSeriesData] = useState(null); // { series_id, series_title, cover, total, episodes: [...] }
  const [selectedVids, setSelectedVids] = useState(new Set());
  const [rangeInput, setRangeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState('auto');
  const [qualityLoading, setQualityLoading] = useState(true);
  const [openingPlayer, setOpeningPlayer] = useState(false);
  const playPending = useRef(false);
  const firstPlayable = seriesData?.episodes.find((ep) => !ep.locked);
  const resolveRequest = useRef(0);
  const pendingResolve = useRef(null);
  const searchVersion = resolveRequest.current;

  useEffect(() => () => { resolveRequest.current++; }, []);
  useEffect(() => {
    resolveRequest.current++; pendingResolve.current = null; setLoading(false);
    setSeriesData(current => current?.series_id?.startsWith('custom:') ? null : current);
  }, [sourceRevision]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setQualityLoading(true);
    window.electronAPI.getSettings().then((settings) => {
      if (!cancelled) setDownloadQuality(['1080p', '720p'].includes(settings?.download_quality) ? settings.download_quality : 'auto');
    }).catch(() => {
      if (!cancelled) setErrorMsg('Đọc độ phân giải tải mặc định thất bại, vui lòng xác nhận độ phân giải trước khi tải');
    }).finally(() => { if (!cancelled) setQualityLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  const switchTab = (next) => {
    if (next === tab) return;
    resolveRequest.current++;
    pendingResolve.current = null;
    setLoading(false);
    setTab(next);
  };

  // Sau khi tìm kiếm chọn một bộ phim: tái sử dụng giao diện chọn tập tải có sẵn
  const handleSeriesFromSearch = (data) => {
    if (searchVersion !== resolveRequest.current) return;
    resolveRequest.current++;
    setLoading(false);
    setRangeInput('');
    setErrorMsg('');
    setTab('input');
    setSeriesData(data);
    setSelectedVids(new Set(data.episodes.filter((ep) => !ep.locked).map((ep) => ep.vid)));
    setSuccessMsg(`Đã chọn《${data.series_title}》tổng ${data.total} tập, có thể phát ngay hoặc gửi yêu cầu tải`);
    document.querySelector('.main-content:not([hidden])')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Phân tích phim ngắn Hồng Quả
  const handleResolve = async () => {
    if (!inputUrl.trim()) {
      setErrorMsg('Vui lòng nhập link chia sẻ hoặc ID phim ngắn Hồng Quả');
      return;
    }
    const value = inputUrl.trim();
    if (pendingResolve.current?.value === value) return;
    const request = ++resolveRequest.current;
    pendingResolve.current = { value, request };
    setRangeInput('');
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setSeriesData(null);
    setSelectedVids(new Set());

    try {
      const res = await window.electronAPI.hongguoResolve(value);
      if (request !== resolveRequest.current) return;
      if (res?.success && res.data) {
        setSeriesData(res.data);
        // Mặc định chọn tất cả, các tập web không cung cấp sẽ tự động thử nguồn App.
        const allVids = new Set(res.data.episodes.filter((ep) => !ep.locked).map((ep) => ep.vid));
        setSelectedVids(allVids);
        setSuccessMsg(`Phân tích thành công! Tìm thấy《${res.data.series_title}》tổng ${res.data.total} tập`);
      } else {
        setErrorMsg(res?.error || 'Phân tích thất bại, vui lòng kiểm tra link hoặc mạng');
      }
    } catch (err) {
      if (request === resolveRequest.current) setErrorMsg('Quá trình phân tích gặp lỗi: ' + err.message);
    } finally {
      if (pendingResolve.current?.request === request) pendingResolve.current = null;
      if (request === resolveRequest.current) setLoading(false);
    }
  };

  // Chọn/bỏ chọn một tập
  const toggleVid = (vid) => {
    if (!seriesData?.episodes.some((ep) => ep.vid === vid && !ep.locked)) return;
    const next = new Set(selectedVids);
    if (next.has(vid)) {
      next.delete(vid);
    } else {
      next.add(vid);
    }
    setSelectedVids(next);
  };

  // Chọn tất cả
  const handleSelectAll = () => {
    if (!seriesData) return;
    setSelectedVids(new Set(seriesData.episodes.filter((ep) => !ep.locked).map((ep) => ep.vid)));
  };

  // Đảo chọn
  const handleInvertSelect = () => {
    if (!seriesData) return;
    const next = new Set();
    for (const ep of seriesData.episodes) {
      if (!ep.locked && !selectedVids.has(ep.vid)) {
        next.add(ep.vid);
      }
    }
    setSelectedVids(next);
  };

  // Xóa hết lựa chọn
  const handleDeselectAll = () => {
    setSelectedVids(new Set());
  };

  // Chọn nhanh theo tập
  const handleQuickSelect = (type) => {
    if (!seriesData || !seriesData.episodes) return;
    const eps = seriesData.episodes;
    const total = eps.length;
    let targetEps = [];
    if (type === 'first10') {
      targetEps = eps.slice(0, 10);
    } else if (type === 'first30') {
      targetEps = eps.slice(0, 30);
    } else if (type === 'last30') {
      targetEps = eps.slice(Math.max(0, total - 30));
    }
    setSelectedVids(new Set(targetEps.filter((ep) => !ep.locked).map((ep) => ep.vid)));
  };

  // Áp dụng lọc theo khoảng (như "1-30" hoặc "1,5,10-20")
  const handleApplyRange = () => {
    if (!seriesData?.episodes) return;
    try {
      const nums = parseEpisodeRange(rangeInput, seriesData.episodes.length);
      setSelectedVids(new Set(seriesData.episodes.filter((ep) => !ep.locked && nums.has(ep.vid_index)).map((ep) => ep.vid)));
      setErrorMsg('');
    } catch (error) { setErrorMsg(error.message); }
  };

  const handlePlay = async () => {
    if (!seriesData || !firstPlayable || playPending.current) return;
    const request = resolveRequest.current;
    playPending.current = true;
    setOpeningPlayer(true);
    setErrorMsg('');
    try {
      const res = await window.electronAPI.playSeries({ seriesId: seriesData.series_id, vidIndex: firstPlayable.vid_index });
      if (!res?.success && request === resolveRequest.current) setErrorMsg(res?.error || 'Mở trình phát thất bại, vui lòng thử lại');
    } catch (error) {
      if (request === resolveRequest.current) setErrorMsg('Mở trình phát thất bại: ' + error.message);
    } finally {
      playPending.current = false;
      setOpeningPlayer(false);
    }
  };

  // Gửi yêu cầu tải hàng loạt
  const handleBatchDownload = async () => {
    if (!seriesData || selectedVids.size === 0) {
      setErrorMsg('Vui lòng chọn ít nhất một tập muốn tải');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const selectedEps = seriesData.episodes.filter((ep) => !ep.locked && selectedVids.has(ep.vid));
      const res = await window.electronAPI.hongguoDownloadBatch({
        seriesId: seriesData.series_id,
        seriesTitle: seriesData.series_title,
        episodes: selectedEps,
        quality: downloadQuality,
      });
      if (res.success) {
        setSuccessMsg(`Đã gửi thành công ${res.count} tập vào hàng đợi tải! Nhấp nút bên dưới để chuyển sang "Quản lý tải xuống" xem tiến độ.`);
      } else {
        setErrorMsg(res.error || 'Gửi yêu cầu tải thất bại');
      }
    } catch (err) {
      setErrorMsg('Gửi yêu cầu tải lỗi: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="hongguo-container">
      {/* Khu vực Banner đầu trang */}
      <div className="hongguo-hero">
        <div className="hero-icon">
          <Film size={32} />
        </div>
        <div className="hero-text">
          <h2>Tìm bộ phim tiếp theo thật hay</h2>
          <p>Tìm một tên phim, hoặc dán link chia sẻ. Chọn tập bạn thích, lưu về máy xem dần.</p>
        </div>
      </div>

      {/* Chuyển chế độ */}
      <div className="mode-tabs">
        <button
          className={`mode-tab ${tab === 'search' ? 'active' : ''}`}
          onClick={() => switchTab('search')}
        >
          <Search size={16} />
          <span>Tìm phim</span>
        </button>
        <button
          className={`mode-tab ${tab === 'input' ? 'active' : ''}`}
          onClick={() => switchTab('input')}
        >
          <Link2 size={16} />
          <span>Dán link / ID</span>
        </button>
      </div>

      <div hidden={tab !== 'search'}>
        <SearchPanel
          active={active && tab === 'search'}
          onSelectSeries={handleSeriesFromSearch}
          onSwitchToInput={() => switchTab('input')}
        />
      </div>
      {tab === 'input' && (
        /* Thẻ nhập phân tích */
        <div className="hongguo-card">
          <div className="card-header-title">
            <Link2 size={18} />
            <span>Nhập link hoặc ID phim ngắn</span>
          </div>
          <div className="input-group">
            <input
              type="text"
              className="input-field"
              aria-label="Link chia sẻ hoặc ID phim ngắn"
              placeholder="Dán link chia sẻ phim ngắn, hoặc nhập ID phim"
              value={inputUrl}
              onChange={(e) => { resolveRequest.current++; pendingResolve.current = null; setLoading(false); setInputUrl(e.target.value); }}
              onKeyDown={(e) => isSubmitKey(e) && handleResolve()}
            />
            <button className="btn btn-outline" disabled={loading} onClick={async () => {
              try {
                const text = (await navigator.clipboard.readText()).trim();
                if (!text || text.length > 4096) throw new Error('Clipboard trống hoặc nội dung quá dài, vui lòng dán link thủ công');
                resolveRequest.current++;
                pendingResolve.current = null;
                setInputUrl(text);
                setErrorMsg('');
                setSuccessMsg('Đã dán, vui lòng xác nhận link rồi lấy tập phim');
              } catch (error) { setErrorMsg(error.message || 'Đọc clipboard thất bại, vui lòng dán thủ công'); }
            }}>Dán link</button>
            <button className="btn btn-primary" onClick={handleResolve} disabled={loading}>
              {loading ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  <span>Đang phân tích...</span>
                </>
              ) : (
                <>
                  <Film size={16} />
                  <span>Lấy tập phim</span>
                </>
              )}
            </button>
          </div>

          {errorMsg && <div className="alert alert-error" role="alert">{errorMsg}</div>}
          {successMsg && <div className="alert alert-success" role="status">{successMsg}</div>}
        </div>
      )}

      {/* Thông báo ở chế độ tìm kiếm (thẻ phân tích bị thay thế, hiển thị riêng ở đây) */}
      {tab === 'search' && (errorMsg || successMsg) && (
        <div className="hongguo-card" style={{ marginTop: 0 }}>
          {errorMsg && <div className="alert alert-error" role="alert">{errorMsg}</div>}
          {successMsg && <div className="alert alert-success" role="status">{successMsg}</div>}
        </div>
      )}

      {/* Danh sách tập và điều khiển chọn */}
      {seriesData && (
        <div className="hongguo-card episode-section">
          {/* Thông tin phim */}
          <div className="series-header">
            <div className="series-info">
              {seriesData.cover ? (
                <img src={seriesData.cover} alt={seriesData.series_title} className="series-cover" />
              ) : (
                <div className="series-cover-placeholder">
                  <Film size={28} />
                </div>
              )}
              <div className="series-meta">
                <h3 className="series-title">《{seriesData.series_title}》</h3>
                <div className="series-tags">
                  <span className="badge">{mediaSourceLabel(seriesData.series_id, mediaSources)}</span>
                  <span className="badge">Tổng {seriesData.total} tập</span>
                  <span className="badge badge-secondary">Đã chọn {selectedVids.size} tập</span>
                </div>
              </div>
            </div>

            <div className="batch-action-bar">
              <button className="btn btn-outline" onClick={handlePlay}
                disabled={openingPlayer || !firstPlayable}
                title={firstPlayable ? 'Phát trong thư viện phim của tôi, tập chưa tải sẽ phát trực tuyến' : 'Phim hiện tại không có tập nào phát được'}>
                {openingPlayer ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
                <span>{openingPlayer ? 'Đang mở…' : 'Phát ngay'}</span>
              </button>
              <label className="batch-quality-control">
                <span>Độ phân giải tải</span>
                <select className="input-field" value={downloadQuality}
                  aria-describedby="batch-quality-hint" disabled={qualityLoading || submitting}
                  onChange={(event) => setDownloadQuality(event.target.value)}>
                  <option value="auto">Tự động (ưu tiên tương thích)</option>
                  <option value="1080p">1080P</option>
                  <option value="720p">720P</option>
                </select>
              </label>
              <button
                className="btn btn-primary"
                onClick={handleBatchDownload}
                disabled={qualityLoading || submitting || selectedVids.size === 0}
              >
                <Download size={16} />
                <span>Tải tập đã chọn ({selectedVids.size}/{seriesData.total})</span>
              </button>
              {onNavigate && (
                <button className="btn btn-outline" onClick={() => onNavigate('manager')}>
                  <Folder size={16} />
                  <span>Xem quản lý tải xuống</span>
                </button>
              )}
            </div>
          </div>

          <p className="settings-hint batch-quality-hint" id="batch-quality-hint">Có hiệu lực cho tác vụ tải mới; nếu độ phân giải đã chọn không khả dụng sẽ có thông báo, không tự động hạ cấp. File đã có sẽ không tự động xóa hoặc ghi đè.</p>

          {seriesData.web_accessible_episodes != null && seriesData.web_accessible_episodes < seriesData.total && (
            <p className="settings-hint">Nguồn web cung cấp {seriesData.web_accessible_episodes} tập đầu, các tập sau sẽ tự động thử nguồn App.</p>
          )}

          {seriesData.episodes.some((ep) => ep.locked) && <p className="settings-hint">Tập khóa cần mở khóa trên nền tảng nguồn, ứng dụng này không cung cấp mở khóa; chọn tất cả và chọn theo khoảng sẽ tự động bỏ qua.</p>}

          {/* Thanh lọc và thao tác */}
          <div className="controls-row">
            <div className="select-buttons">
              <button className="btn-chip" onClick={handleSelectAll}>Chọn tất cả</button>
              <button className="btn-chip" onClick={handleInvertSelect}>Đảo chọn</button>
              <button className="btn-chip" onClick={handleDeselectAll}>Bỏ chọn tất cả</button>
              <span className="divider"></span>
              <button className="btn-chip" onClick={() => handleQuickSelect('first10')}>10 tập đầu</button>
              <button className="btn-chip" onClick={() => handleQuickSelect('first30')}>30 tập đầu</button>
              <button className="btn-chip" onClick={() => handleQuickSelect('last30')}>30 tập cuối</button>
            </div>

            <div className="range-filter">
              <span className="range-label">Lọc theo khoảng:</span>
              <input
                type="text"
                className="range-input"
                aria-label="Chọn khoảng tập"
                placeholder="Ví dụ 1-30 hoặc 1,5,10"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                onKeyDown={(e) => isSubmitKey(e) && handleApplyRange()}
              />
              <button className="btn-chip btn-chip-primary" onClick={handleApplyRange}>Áp dụng</button>
            </div>
          </div>

          {/* Lưới danh sách tập */}
          <div className="episode-grid">
            {seriesData.episodes.map((ep) => {
              const isChecked = selectedVids.has(ep.vid);
              return (
                <button
                  type="button"
                  disabled={ep.locked === true}
                  title={ep.locked ? 'Cần mở khóa trên nền tảng nguồn' : undefined}
                  aria-pressed={isChecked}
                  key={ep.vid}
                  className={`episode-card ${isChecked ? 'selected' : ''}`}
                  onClick={() => toggleVid(ep.vid)}
                >
                  <div className="checkbox-icon">
                    {isChecked ? <CheckSquare size={18} className="icon-checked" /> : <Square size={18} className="icon-unchecked" />}
                  </div>
                  <div className="episode-info">
                    <span className="episode-num">Tập {String(ep.vid_index).padStart(2, '0')}</span>
                    {ep.locked ? <span className="episode-title">Khóa · Cần mở trên nguồn</span> : ep.title && <span className="episode-title">{ep.title}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default HongguoDownload;
