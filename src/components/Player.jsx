import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useDialogKeyboard from './useDialogKeyboard';
import PlayerControls from './PlayerControls';
import CommentDanmaku, { useCommentDanmaku } from './CommentDanmaku';
import { SHORTCUT_ACTIONS, formatShortcut, ignoresPlaybackShortcut, readShortcuts, shortcutKey, subscribeShortcuts } from '../shortcuts';
import CommunityPanel from './CommunityPanel';
import VideoEnhancement, { useVideoEnhancement } from './VideoEnhancement';
import './Player.css';
import { Play, Film, Download, Check, RefreshCw, Layers, X, Trash2, ChevronDown, Zap } from './icons';

const localMediaKey = (seriesId, episode) => JSON.stringify([seriesId, episode?.vid, episode?.fileUrl, episode?.fileSize, episode?.taskId]);

/**
 * Player —— Trình phát tích hợp
 *
 * Điểm thiết kế:
 *  - Phát trực tiếp file file:// cục bộ (đã test hỗ trợ seek), không cần server stream
 *  - "Vừa tải vừa xem": nếu tập tiếp theo đang tải, hiện trạng thái chờ và polling, tải xong tự phát tiếp
 *  - Tiếp tục từ điểm dừng: nhớ theo series_id đang xem tập mấy, giây thứ bao nhiêu
 */
function Player({ target, onNavigate, onSeriesSelected, active = true, portrait = false, actionsHidden = false, episodesOpen = false, setEpisodesOpen }) {
  const enhancement = useVideoEnhancement();
  const [shortcuts, setShortcuts] = useState(readShortcuts);
  const [showDanmakuControls, setShowDanmakuControls] = useState(false);
  useEffect(() => subscribeShortcuts(setShortcuts), []);
  const [portraitActionsOpen, setPortraitActionsOpen] = useState(false);
  const [windowFill, setWindowFill] = useState(false);
  useEffect(() => { if (!portrait || !active) setWindowFill(false); }, [portrait, active]);
  const [seriesList, setSeriesList] = useState([]);
  const [activeSeriesId, setActiveSeriesId] = useState('');
  const [pictureChoice, setPictureChoice] = useState(null);
  const savedPictureMode = useMemo(() => {
    try { return window.localStorage.getItem(`hongguo:picture-mode:${activeSeriesId}`) === 'width' ? 'width' : 'fit'; }
    catch { return 'fit'; }
  }, [activeSeriesId]);
  const pictureMode = pictureChoice?.seriesId === activeSeriesId ? pictureChoice.mode : savedPictureMode;
  const changePictureMode = mode => {
    if (!activeSeriesId || !['fit', 'width'].includes(mode)) return;
    setPictureChoice({ seriesId: activeSeriesId, mode });
    try { window.localStorage.setItem(`hongguo:picture-mode:${activeSeriesId}`, mode); }
    catch { showToast('Chế độ hình ảnh đã đổi, nhưng chưa lưu được; lần sau mở có thể về mặc định'); }
  };
  const [detail, setDetail] = useState(null); // { series_title, episodes: [...], total, completedCount }
  const [currentIndex, setCurrentIndex] = useState(1);
  const [autoNext, setAutoNext] = useState(true);
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const [cacheNext, setCacheNext] = useState(true);
  const [cacheNextSaving, setCacheNextSaving] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [downloadQuality, setDownloadQuality] = useState('auto');
  const [onlineQualityChoice, setOnlineQualityChoice] = useState(() => {
    try { const value = window.localStorage.getItem('hongguo:online-quality'); return ['720p', '1080p'].includes(value) ? value : 'auto'; }
    catch { return 'auto'; }
  });
  const supportsOnlineQuality = !/^(xifan|hema|custom):/.test(activeSeriesId);
  const onlineQuality = supportsOnlineQuality ? onlineQualityChoice : 'auto';
  const [qualityLoading, setQualityLoading] = useState(true);
  const [waitingFor, setWaitingFor] = useState(null); // Tập đang chờ tải
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);   // Bảng chọn tập
  const [pickerQuery, setPickerQuery] = useState('');
  const [dismissedCount, setDismissedCount] = useState(0);

  // Phát trực tuyến (stream theo nhu cầu hoặc chuẩn bị tạm rồi cache)
  const [onlineVid, setOnlineVid] = useState(null);
  const [onlineUrl, setOnlineUrl] = useState('');
  const [mediaBuffering, setMediaBuffering] = useState(false);
  const [onlineProgress, setOnlineProgress] = useState(null); // {percent, phase}
  const [cacheInfo, setCacheInfo] = useState({ count: 0, bytes: 0 });
  const [downloadedMap, setDownloadedMap] = useState({}); // series_id -> {completed,total}
  const [storageMap, setStorageMap] = useState({});       // series_id -> {files,bytes}
  const [storageTotal, setStorageTotal] = useState({ files: 0, bytes: 0 });
  const [autoDelete, setAutoDelete] = useState(false);    // Xem xong tự xóa file cục bộ
  const [confirmAsk, setConfirmAsk] = useState(null);     // {title, message, danger, onOk}

  // Chế độ tương thích: khi máy không giải mã được HEVC, chuyển mã sang H.264
  const [autoCompat, setAutoCompat] = useState(true);
  const [compatMap, setCompatMap] = useState({});         // vidIndex -> url sau chuyển mã
  const [compatProgress, setCompatProgress] = useState(null); // {vidIndex, percent}
  const [compatError, setCompatError] = useState('');
  const [decodeFailed, setDecodeFailed] = useState(false);    // Tập hiện tại không giải mã được hình
  const [playbackError, setPlaybackError] = useState('');
  const [playbackVersion, setPlaybackVersion] = useState(0);
  const [compatCache, setCompatCache] = useState({ files: 0, bytes: 0 });
  const [mergeAsk, setMergeAsk] = useState(false);            // Chọn định dạng gộp

  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const playbackRateRef = useRef(1);
  const toastTimer = useRef(null);
  const pendingSeekRef = useRef(0); // Số giây cần nhảy đến sau khi đổi tập
  const pendingAutoplayRef = useRef(true);
  const lastSavedRef = useRef(0);
  const stateRef = useRef({ currentIndex, autoNext, activeSeriesId });
  stateRef.current = { currentIndex, autoNext, activeSeriesId, waitingFor, downloadQuality, onlineQuality, qualityLoading, detail };
  const selectedSeriesRef = useRef('');
  const selectionVersion = useRef(0);
  const onlineRequestRef = useRef(null);
  const prefetchRef = useRef(null);
  const mediaVersion = useRef(0);
  const compatRequestRef = useRef(null);
  const decodeTimer = useRef(null);
  const pendingTargetRef = useRef(null);
  const loadedMediaRef = useRef(null);
  const autoCompatAttemptRef = useRef(null);
  const reconnectAttemptRef = useRef(null);
  const onlineSourceRef = useRef(null);
  const lastVideoSrcRef = useRef('');
  const lastLoadRef = useRef(null);
  const fallbackRef = useRef(null);
  const fallbackAttemptRef = useRef(null);
  const rejectedLocalRef = useRef(null);

  // Chỉ lưu khi đã nhận metadata của nguồn hiện tại, tránh pause của element cũ ghi đè điểm dừng tập mới.
  const persistPosition = useCallback((force = false) => {
    const media = loadedMediaRef.current;
    if (!media?.played || media.version !== mediaVersion.current) return;
    const seconds = media.element.currentTime;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    if (!force && Math.abs(seconds - lastSavedRef.current) < 3) return;
    lastSavedRef.current = seconds;
    window.electronAPI.savePlaybackPosition(media.seriesId, media.vidIndex, seconds).catch(() => {});
  }, []);

  const currentPosition = useCallback(() => {
    const media = loadedMediaRef.current;
    return media?.version === mediaVersion.current && Number.isFinite(media.element.currentTime)
      ? media.element.currentTime : pendingSeekRef.current;
  }, []);

  const releaseOnline = useCallback(() => {
    const request = onlineRequestRef.current;
    onlineRequestRef.current = null;
    if (request) window.electronAPI.releaseOnlinePlay({ requestId: request.requestId, streamId: request.streamId }).catch(() => {});
  }, []);

  const releasePrefetch = useCallback(() => {
    const request = prefetchRef.current;
    prefetchRef.current = null;
    if (request) window.electronAPI.releaseOnlinePlay({ requestId: request.requestId }).catch(() => {});
  }, []);

  const cancelCompat = useCallback(() => {
    const request = compatRequestRef.current;
    compatRequestRef.current = null;
    if (request && window.electronAPI.cancelTranscodeForPlayback) {
      window.electronAPI.cancelTranscodeForPlayback({ ...request }).catch(() => {});
    }
  }, []);

  const resetPlayback = useCallback((autoplay = true) => {
    fallbackRef.current = null;
    pendingAutoplayRef.current = autoplay;
    setAutoAdvancing(false);
    persistPosition(true);
    const previous = loadedMediaRef.current;
    loadedMediaRef.current = null;
    previous?.element.pause();
    mediaVersion.current++;
    setPlaybackVersion(mediaVersion.current);
    autoCompatAttemptRef.current = null;
    clearTimeout(decodeTimer.current);
    cancelCompat();
    releaseOnline();
    releasePrefetch();
    setOnlineVid(null);
    setOnlineUrl('');
    setOnlineProgress(null);
    setMediaBuffering(false);
    setCompatProgress(null);
    setDecodeFailed(false);
    setCompatError('');
    setPlaybackError('');
    lastSavedRef.current = 0;
  }, [persistPosition, releaseOnline, cancelCompat, releasePrefetch]);

  const stopPlayback = (message = 'Đã dừng phát, có thể thử lại tập này để tiếp tục xem') => {
    const seekTo = currentPosition();
    resetPlayback();
    pendingSeekRef.current = seekTo;
    setWaitingFor(null);
    setPlaybackError(message);
  };

  useEffect(() => () => {
    persistPosition(true);
    selectionVersion.current++;
    mediaVersion.current++;
    selectedSeriesRef.current = '';
    cancelCompat();
    releaseOnline();
    releasePrefetch();
    clearTimeout(decodeTimer.current);
    clearTimeout(toastTimer.current);
  }, [persistPosition, releaseOnline, cancelCompat, releasePrefetch]);

  const showToast = useCallback((text) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const changePlaybackRate = useCallback((value, notify = true) => {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return;
    const next = Math.max(0.25, Math.min(4, rate));
    playbackRateRef.current = next;
    setPlaybackRate(next);
    const v = videoRef.current;
    if (v) {
      v.defaultPlaybackRate = next;
      v.playbackRate = next;
    }
    if (notify) showToast(`Tốc độ phát ${next}×`);
  }, [showToast]);

  // Tải danh sách phim đã đăng ký
  const loadSeriesList = useCallback(async () => {
    const list = (await window.electronAPI.getSeriesList()) || [];
    setSeriesList(list);
    return list;
  }, []);

  // Tải trạng thái tập của một phim
  const loadDetail = useCallback(async (seriesId) => {
    if (!seriesId) return null;
    const version = selectionVersion.current;
    const res = await window.electronAPI.getSeriesEpisodes(seriesId);
    if (version !== selectionVersion.current || String(seriesId) !== selectedSeriesRef.current) return null;
    if (!res || !res.success) return null;
    setDetail(res.data);
    return res.data;
  }, []);

  const usableLocal = useCallback((ep, seriesId) => ep && !ep.locked && ep.status === 'completed' && ep.fileUrl
    && localMediaKey(seriesId, ep) !== rejectedLocalRef.current
    && (stateRef.current.onlineQuality === 'auto' || /^(xifan|hema|custom):/.test(seriesId)
      || Number.parseInt(ep.actualQuality, 10) >= Number.parseInt(stateRef.current.onlineQuality, 10)), []);

  const resumeLocal = useCallback((ep, seekTo, autoplay = true) => {
    resetPlayback(autoplay);
    onlineSourceRef.current = null;
    setCompatMap(prev => { const next = { ...prev }; delete next[ep.vid_index]; return next; });
    pendingSeekRef.current = seekTo;
    setCurrentIndex(ep.vid_index);
    setWaitingFor(null);
  }, [resetPlayback]);

  const isCurrentFallback = useCallback(intent => fallbackRef.current === intent
    && intent.selection === selectionVersion.current && intent.media === mediaVersion.current
    && intent.seriesId === selectedSeriesRef.current && intent.vidIndex === stateRef.current.currentIndex, []);

  const recoverOnlineFailure = useCallback(async (ep, message) => {
    const seekTo = currentPosition();
    const autoplay = loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current;
    resetPlayback(autoplay);
    pendingSeekRef.current = seekTo;
    const intent = { seriesId: selectedSeriesRef.current, vidIndex: ep.vid_index, vid: ep.vid,
      selection: selectionVersion.current, media: mediaVersion.current, seekTo, autoplay, submitting: true };
    fallbackRef.current = intent;
    setPlaybackError(message);
    try {
      const data = await loadDetail(intent.seriesId);
      if (!isCurrentFallback(intent)) return;
      const latest = data?.episodes.find(item => item.vid_index === intent.vidIndex && item.vid === intent.vid);
      if (!latest || latest.locked) throw new Error(latest?.locked ? 'Tập này đã bị khóa, vui lòng xác nhận trên nền tảng nguồn' : 'Không thể làm mới trạng thái tập này, vui lòng thử lại');
      if (usableLocal(latest, intent.seriesId)) { resumeLocal(latest, intent.seekTo, intent.autoplay); return; }
      const key = `${intent.selection}:${intent.seriesId}:${intent.vid}`;
      if (fallbackAttemptRef.current === key) throw new Error('Tập này đã thử tải, vui lòng kiểm tra trong quản lý tải xuống hoặc thử tải lại thủ công');
      const settings = stateRef.current.qualityLoading ? await window.electronAPI.getSettings() : null;
      if (!isCurrentFallback(intent)) return;
      const quality = stateRef.current.onlineQuality !== 'auto' ? stateRef.current.onlineQuality : stateRef.current.qualityLoading
        ? (['1080p', '720p'].includes(settings?.download_quality) ? settings.download_quality : 'auto') : stateRef.current.downloadQuality;
      fallbackAttemptRef.current = key;
      setPlaybackError(''); setWaitingFor(intent.vidIndex);
      // Enqueue sẽ xác thực chất lượng và tái sử dụng tác vụ có sẵn; hủy phát không dừng tải chung đó.
      const result = await window.electronAPI.downloadSingleEpisode(intent.seriesId, intent.vidIndex, quality);
      if (!isCurrentFallback(intent)) return;
      if (!result?.success) throw new Error(result?.error || 'Thêm vào tải thất bại');
      intent.submitting = false;
    } catch (error) {
      if (!isCurrentFallback(intent)) return;
      intent.submitting = false;
      setWaitingFor(null); setPlaybackError(`${message}; ${error.message}`);
    }
  }, [currentPosition, resetPlayback, loadDetail, isCurrentFallback, usableLocal, resumeLocal]);

  const refreshCacheInfo = useCallback(async () => {
    try {
      const res = await window.electronAPI.onlineCacheStatus();
      if (res && res.success) setCacheInfo({ count: res.count, bytes: res.bytes });
      const dc = await window.electronAPI.dismissedCount();
      setDismissedCount(dc || 0);
      const st = await window.electronAPI.getStorageUsage();
      if (st && st.success) {
        const map = {};
        for (const s of st.series) map[String(s.series_id)] = { files: s.files, bytes: s.bytes, merged: s.merged };
        setStorageMap(map);
        setStorageTotal({ files: st.totalFiles, bytes: st.totalBytes });
      }
    } catch (_) {}
  }, []);

  const fmtSize = (b) => {
    if (!b || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  };

  useEffect(() => {
    refreshCacheInfo();
    window.electronAPI.getSettings().then((s) => {
      if (s) {
        setAutoDelete(s.auto_delete_watched === true);
        setCacheNext(s.cache_next_episode !== false);
        setAutoCompat(s.compat_mode !== false); // Mặc định bật
      }
    });
    window.electronAPI.compatCacheStatus().then((r) => {
      if (r && r.success) setCompatCache({ files: r.files, bytes: r.bytes });
    });
  }, [refreshCacheInfo]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setQualityLoading(true);
    window.electronAPI.getSettings().then((settings) => {
      if (!cancelled) {
        setDownloadQuality(['1080p', '720p'].includes(settings?.download_quality) ? settings.download_quality : 'auto');
        setShowDanmakuControls(settings?.show_danmaku_controls !== false);
      }
    }).catch(() => {
      if (!cancelled) showToast('Đọc độ phân giải tải mặc định thất bại, vui lòng xác nhận độ phân giải trước khi tải');
    }).finally(() => { if (!cancelled) setQualityLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    if (!window.electronAPI.onTranscodeProgress) return undefined;
    return window.electronAPI.onTranscodeProgress((d) => {
      const request = compatRequestRef.current;
      if (!request || d.requestId !== request.requestId || request.version !== mediaVersion.current || String(d.seriesId) !== request.seriesId || d.vidIndex !== request.vidIndex || d.done) return;
      setCompatProgress({ vidIndex: d.vidIndex, percent: d.percent || 0 });
    });
  }, []);

  /**
   * Lưu ý: ba hàm dùng episodes dưới đây phải được định nghĩa SAU episodes.
   * Mảng phụ thuộc của useCallback được đánh giá "lúc định nghĩa", nếu tham chiếu const khai báo sau
   * sẽ kích hoạt TDZ (Cannot access 'X' before initialization) làm trắng cả trang.
   */
  const toggleCacheNext = async () => {
    const next = !cacheNext;
    setCacheNext(next);
    setCacheNextSaving(true);
    if (!next) releasePrefetch();
    try {
      const settings = await window.electronAPI.getSettings();
      const result = await window.electronAPI.saveSettings({ ...settings, cache_next_episode: next });
      if (!result?.success) throw new Error(result?.error || 'Lưu cài đặt thất bại');
      showToast(next ? 'Đã bật: bắt đầu phát sẽ cache tập tiếp theo' : 'Đã tắt cache tập tiếp theo');
    } catch (error) {
      showToast(`Lần này đã ${next ? 'bật' : 'tắt'}, nhưng chưa lưu được cài đặt: ${error.message}`);
    } finally { setCacheNextSaving(false); }
  };

  const toggleAutoCompat = async () => {
    const next = !autoCompat;
    setAutoCompat(next);
    try {
      const s = await window.electronAPI.getSettings();
      await window.electronAPI.saveSettings({ ...s, compat_mode: next });
      showToast(next ? 'Đã bật chế độ tương thích: tự động chuyển mã khi không giải mã được' : 'Đã tắt chế độ tương thích');
    } catch (_) {}
  };

  const toggleAutoDelete = async () => {
    const next = !autoDelete;
    setAutoDelete(next);
    try {
      const s = await window.electronAPI.getSettings();
      await window.electronAPI.saveSettings({ ...s, auto_delete_watched: next });
      showToast(next ? 'Đã bật: xem xong một tập sẽ tự xóa file cục bộ' : 'Đã tắt tự động xóa');
    } catch (_) {}
  };

  // Khi mở bảng tập, bổ sung tiến độ tải từng phim (chỉ gọi một lần)
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    (async () => {
      const map = {};
      for (const s of seriesList) {
        try {
          const res = await window.electronAPI.getSeriesEpisodes(s.series_id);
          if (res && res.success) map[String(s.series_id)] = { completed: res.data.completedCount, total: res.data.total };
        } catch (_) {}
        if (cancelled) return;
      }
      if (!cancelled) setDownloadedMap(map);
    })();
    return () => { cancelled = true; };
  }, [pickerOpen, seriesList]);

  useEffect(() => {
    if (!window.electronAPI.onOnlinePlayProgress) return undefined;
    return window.electronAPI.onOnlinePlayProgress((d) => {
      const request = onlineRequestRef.current;
      if (!request || d.requestId !== request.requestId) return;
      if (d.code === 'MEDIA_TOO_LARGE') { showToast(d.error); return; }
      if (request.prepared) return;
      setOnlineProgress({
        vid: d.vid,
        percent: d.percent || 0,
        phase: d.phase || 'downloading',
        received: d.received,
        total: d.total,
      });
    });
  }, []);

  // Polling: cập nhật realtime tập "đang tải" và tự phát tiếp khi chờ xong
  useEffect(() => {
    if (!activeSeriesId || (!active && waitingFor == null)) return;
    let busy = false, dirty = true;
    const unsubscribe = ['onDownloadTaskAdded', 'onDownloadCompleted', 'onDownloadFailed', 'onDownloadStopped', 'onDownloadQueueChanged', 'onWatchHistoryUpdated']
      .map(name => window.electronAPI[name]?.(() => { dirty = true; }));
    const timer = setInterval(async () => {
      if (busy) return;
      const pending = stateRef.current.detail?.episodes.some(ep => ['pending', 'downloading'].includes(ep.status) || ep.retryAt);
      if (!dirty && !pending && stateRef.current.waitingFor == null && !fallbackRef.current) return;
      dirty = false;
      busy = true;
      const version = mediaVersion.current;
      const submitting = fallbackRef.current?.submitting;
      let d;
      try { d = await loadDetail(activeSeriesId); } catch (_) {} finally { busy = false; }
      if (!d) dirty = true;
      if (!d || version !== mediaVersion.current) return;
      const intent = fallbackRef.current;
      const recovery = intent && isCurrentFallback(intent) ? intent : null;
      const wf = stateRef.current.waitingFor ?? recovery?.vidIndex;
      if (wf != null) {
        const ep = d.episodes.find((e) => e.vid_index === wf);
        if (usableLocal(ep, String(activeSeriesId)) && (!recovery || ep.vid === recovery.vid)) {
          // Tập tiếp theo đang chờ đã tải xong -> tự chuyển sang
          setWaitingFor(null);
          const sameEpisode = wf === stateRef.current.currentIndex;
          const seekTo = recovery ? recovery.seekTo : sameEpisode ? currentPosition() : 0;
          resumeLocal(ep, seekTo, recovery ? recovery.autoplay : !sameEpisode || !loadedMediaRef.current?.element.paused);
        } else if (stateRef.current.waitingFor != null && !submitting && !recovery?.submitting
          && (!ep || ep.locked || (ep.status === 'failed' && !ep.retryAt) || ['stopped', 'cancelled', 'missing', 'completed'].includes(ep.status))) {
          setWaitingFor(null);
          setPlaybackError(ep?.error || (ep?.status === 'stopped' || ep?.status === 'cancelled' ? 'Tập này đã dừng tải, có thể thử lại trong quản lý tải xuống'
            : ep?.status === 'completed' ? 'File cục bộ không phát được, vui lòng kiểm tra file trong quản lý tải xuống' : 'Tải tập này thất bại hoặc tác vụ đã bị xóa, vui lòng kiểm tra trong quản lý tải xuống rồi thử lại'));
        }
      }
    }, 2000);
    return () => { clearInterval(timer); unsubscribe.forEach(off => off?.()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeSeriesId, waitingFor, loadDetail, currentPosition, isCurrentFallback, usableLocal, resumeLocal]);

  const episodes = detail ? detail.episodes : [];
  const current = useMemo(
    () => episodes.find((e) => e.vid_index === currentIndex) || null,
    [episodes, currentIndex]
  );

  const compatUrl = current ? compatMap[current.vid_index] : null;
  const isOnlinePlaying = onlineVid && current && current.vid === onlineVid && onlineUrl;
  const canPlay = !!(!playbackError && !onlineProgress && current && !current.locked && (compatUrl || usableLocal(current, String(activeSeriesId)) || isOnlinePlaying));
  const playableSource = compatUrl || (isOnlinePlaying ? onlineUrl : current?.fileUrl) || '';
  // Fullscreen native bám vào node video. Khi chuẩn bị tập tiếp theo giữ nguyên khung kết thúc, đổi nguồn không đổi node.
  if (canPlay) lastVideoSrcRef.current = playableSource;
  const videoSrc = compatProgress ? '' : lastVideoSrcRef.current;
  const danmaku = useCommentDanmaku({ seriesId: activeSeriesId, episodeId: current?.vid, active: active && canPlay && showDanmakuControls, source: videoSrc });

  useEffect(() => {
    const v = videoRef.current;
    if (loading || !canPlay || !v) return;
    const previous = lastLoadRef.current;
    lastLoadRef.current = { source: videoSrc, version: playbackVersion };
    v.defaultPlaybackRate = playbackRateRef.current;
    // Thử lại rõ ràng trên cùng địa chỉ sẽ không kích hoạt đổi src, chỉ cần load native để reset media.
    if (previous?.source === videoSrc && previous.version !== playbackVersion) { v.src = videoSrc; v.load(); }
    v.playbackRate = playbackRateRef.current;
  }, [loading, canPlay, videoSrc, playbackVersion]);

  const playableCount = episodes.filter((e) => e.status === 'completed').length;

  /** Chuyển mã tập hiện tại sang H.264 để phát (giải quyết màn hình đen do máy không giải mã được HEVC) */
  const startCompatPlay = useCallback(
    async (vidIndex, force = false) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep || ep.locked) return;
      const request = { requestId: crypto.randomUUID(), seriesId: String(activeSeriesId), vidIndex, quality: onlineQuality, version: mediaVersion.current };
      if (compatRequestRef.current?.version === request.version && compatRequestRef.current?.vidIndex === vidIndex) return;
      autoCompatAttemptRef.current = { version: request.version, force };
      pendingSeekRef.current = currentPosition();
      if (loadedMediaRef.current) pendingAutoplayRef.current = !loadedMediaRef.current.element.paused;
      fallbackRef.current = null;
      setWaitingFor(null);
      setPlaybackError('');
      persistPosition(true);
      videoRef.current?.pause();
      loadedMediaRef.current = null;
      // Windows phải giải phóng cache lỗi trước khi FFmpeg thay thế. Giữ nguyên node fullscreen.
      videoRef.current?.removeAttribute('src');
      videoRef.current?.load();
      compatRequestRef.current = request;
      setCompatError('');
      setCompatProgress({ vidIndex, percent: 0 });
      try {
        const res = await window.electronAPI.transcodeForPlayback({
          requestId: request.requestId,
          seriesId: activeSeriesId,
          vidIndex,
          vid: ep.vid,
          quality: request.quality,
          filePath: onlineSourceRef.current === `${activeSeriesId}:${vidIndex}` ? null : ep.savePath || null,
          force,
        });
        if (compatRequestRef.current !== request || request.version !== mediaVersion.current) return;
        compatRequestRef.current = null;
        if (res && res.success) {
          loadedMediaRef.current = null;
          // Kết quả cùng URL nhanh có thể bị gộp với trạng thái loading; khôi phục src DOM rõ ràng.
          if (videoRef.current) { videoRef.current.src = res.url; videoRef.current.load(); }
          setCompatMap((prev) => ({ ...prev, [vidIndex]: res.url }));
          setDecodeFailed(false);
          setCompatProgress(null);
          showToast(res.cached ? 'Đã chuyển sang định dạng tương thích' : `Đã chuyển mã sang định dạng tương thích (mất ${res.elapsed}s), bắt đầu phát`);
          window.electronAPI.compatCacheStatus().then((r) => {
            if (r && r.success) setCompatCache({ files: r.files, bytes: r.bytes });
          });
        } else {
          setCompatProgress(null);
          if (res?.code === 'MEDIA_TOO_LARGE') showToast(res.error);
          if (autoCompat && !res?.cancelled && reconnectOnce()) return;
          const message = (res && res.error) || 'Chuyển mã thất bại';
          if (!res?.cancelled && onlineSourceRef.current === `${activeSeriesId}:${vidIndex}`) {
            await recoverOnlineFailure(ep, message);
            return;
          }
          setDecodeFailed(true);
          setCompatError(message);
          showToast(message);
        }
      } catch (e) {
        if (compatRequestRef.current !== request || request.version !== mediaVersion.current) return;
        compatRequestRef.current = null;
        setCompatProgress(null);
        if (autoCompat && reconnectOnce()) return;
        if (onlineSourceRef.current === `${activeSeriesId}:${vidIndex}`) {
          await recoverOnlineFailure(ep, 'Lỗi chuyển mã: ' + e.message);
          return;
        }
        setDecodeFailed(true);
        setCompatError('Lỗi chuyển mã: ' + e.message);
        showToast('Lỗi chuyển mã: ' + e.message);
      }
    },
    [episodes, activeSeriesId, onlineQuality, autoCompat, reconnectOnce, showToast, currentPosition, persistPosition, recoverOnlineFailure]
  );

  const tryAutoCompat = useCallback((vidIndex) => {
    if (!autoCompat) return;
    const force = !!compatMap[vidIndex];
    const attempt = autoCompatAttemptRef.current;
    if (attempt?.version === mediaVersion.current && (!force || attempt.force)) return;
    startCompatPlay(vidIndex, force);
  }, [autoCompat, compatMap, startCompatPlay]);

  const clearCompatCache = async () => {
    const affected = !!compatMap[currentIndex] || !!compatRequestRef.current;
    if (affected) stopPlayback('Phát tương thích đã dừng, có thể thử lại tập này để tiếp tục xem');
    try {
      const r = await window.electronAPI.clearCompatCache();
      if (!r?.success) { showToast(r?.error || 'Dọn cache chuyển mã thất bại'); return; }
      setCompatMap({});
      setCompatCache({ files: 0, bytes: 0 });
      showToast(r.count > 0 ? `Đã dọn cache chuyển mã, giải phóng ${fmtSize(r.freed)}` : 'Cache chuyển mã đã trống');
    } catch (e) { showToast('Dọn cache chuyển mã thất bại: ' + e.message); }
  };

  // Nếu khi phát luôn không ra hình (videoWidth mãi bằng 0), coi như không tương thích giải mã.
  // Phải định nghĩa trước early return —— hooks không được xuất hiện sau nhánh điều kiện.
  const handlePlaying = useCallback((event) => {
    const media = loadedMediaRef.current;
    const element = event.currentTarget;
    if (playbackVersion !== mediaVersion.current || !canPlay || media?.version !== mediaVersion.current || media.element !== element) return;
    if (element.currentSrc && element.currentSrc !== videoSrc) return;
    if (!media.played) {
      media.played = true;
      persistPosition(true);
    }
    setAutoAdvancing(false);
    setDecodeFailed(false);
    setMediaBuffering(false);
    const idx = currentIndex;
    const version = mediaVersion.current;
    clearTimeout(decodeTimer.current);
    decodeTimer.current = setTimeout(() => {
      if (version !== mediaVersion.current) return;
      const v = videoRef.current;
      if (!v) return;
      if (v.videoWidth === 0 && !v.paused && v.currentTime > 0.3) {
        setDecodeFailed(true);
        tryAutoCompat(idx);
      }
    }, 2600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, tryAutoCompat, playbackVersion, canPlay, videoSrc, persistPosition]);

  /**
   * Phát trực tuyến: nguồn rõ tải theo nhu cầu, nguồn mã hóa chuẩn bị xong trả địa chỉ phát.
   * Không chiếm thư mục tải xuống; file chuẩn bị của nguồn mã hóa sẽ tự dọn.
   */
  const startOnlinePlay = useCallback(
    async (vidIndex, resumeAt, force = false, autoplay = true) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (ep?.locked) { showToast('Tập này cần mở khóa trên nền tảng nguồn'); return; }
      if (!ep || !ep.vid) {
        showToast('Tập này tạm thời không phát được, vui lòng lấy lại tập phim rồi thử lại');
        return;
      }
      const quality = stateRef.current.onlineQuality;
      onlineSourceRef.current = `${activeSeriesId}:${vidIndex}`;
      const seekTo = resumeAt ?? (vidIndex === stateRef.current.currentIndex ? currentPosition() : 0);
      const prefetched = !force && prefetchRef.current?.vid === ep.vid && prefetchRef.current?.seriesId === activeSeriesId && prefetchRef.current?.quality === quality ? prefetchRef.current : null;
      if (prefetched) prefetchRef.current = null;
      resetPlayback(autoplay);
      setCompatMap(prev => { const next = { ...prev }; delete next[vidIndex]; return next; });
      const request = prefetched || { requestId: crypto.randomUUID(), vid: ep.vid };
      onlineRequestRef.current = request;
      pendingSeekRef.current = seekTo;
      setCurrentIndex(vidIndex);
      setWaitingFor(null);
      setOnlineProgress({ vid: ep.vid, percent: 0, phase: 'preparing' });
      setOnlineVid(ep.vid);
      setOnlineUrl('');
      try {
        let res = prefetched ? await prefetched.promise : null;
        if (onlineRequestRef.current !== request) return;
        if (!res?.success) res = await window.electronAPI.prepareOnlinePlay({
          requestId: request.requestId,
          vid: ep.vid,
          seriesId: activeSeriesId,
          vidIndex,
          quality,
          force,
        });
        if (onlineRequestRef.current !== request) {
          window.electronAPI.releaseOnlinePlay({ requestId: request.requestId, streamId: res?.streamId }).catch(() => {});
          return;
        }
        if (!res || !res.success) {
          if (res?.code === 'MEDIA_TOO_LARGE') showToast(res.error);
          await recoverOnlineFailure(ep, (res && res.error) || 'Chuẩn bị phát trực tuyến thất bại');
          return;
        }
        request.streamId = res.streamId;
        request.prepared = true;
        setMediaBuffering(true);
        setOnlineUrl(res.url);
        setOnlineProgress(null);
        refreshCacheInfo();
      } catch (e) {
        if (onlineRequestRef.current !== request) return;
        await recoverOnlineFailure(ep, 'Phát trực tuyến thất bại: ' + e.message);
      }
    },
    [episodes, activeSeriesId, showToast, refreshCacheInfo, resetPlayback, releaseOnline, currentPosition, recoverOnlineFailure]
  );

  function reconnectOnce() {
    const key = `${activeSeriesId}:${currentIndex}`;
    if (!current?.vid || current.locked || reconnectAttemptRef.current === key) return false;
    reconnectAttemptRef.current = key;
    if (onlineSourceRef.current !== key && current.status === 'completed') rejectedLocalRef.current = localMediaKey(String(activeSeriesId), current);
    showToast('Đang lấy lại nguồn phát cho tập này…');
    startOnlinePlay(currentIndex, currentPosition(), true, loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current);
    return true;
  }

  // Đổi tập
  const goToEpisode = useCallback(
    (vidIndex, resumeAt) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep || ep.locked) return;
      fallbackAttemptRef.current = null;
      reconnectAttemptRef.current = null;
      if (!usableLocal(ep, String(activeSeriesId))) {
        startOnlinePlay(vidIndex, resumeAt);
        return;
      }
      onlineSourceRef.current = null;
      const seekTo = resumeAt ?? (vidIndex === stateRef.current.currentIndex ? currentPosition() : 0);
      resetPlayback();
      setCurrentIndex(vidIndex);
      setWaitingFor(null);
      pendingSeekRef.current = seekTo;
    },
    [episodes, activeSeriesId, resetPlayback, startOnlinePlay, currentPosition, usableLocal]
  );

  const retryPlayback = async () => {
    const version = mediaVersion.current, selection = selectionVersion.current;
    let data;
    try { data = await loadDetail(activeSeriesId); } catch (_) {}
    if (version !== mediaVersion.current || selection !== selectionVersion.current) return;
    const latest = data?.episodes.find(ep => ep.vid_index === currentIndex && ep.vid === current?.vid);
    if (usableLocal(latest, String(activeSeriesId))) { resumeLocal(latest, currentPosition()); return; }
    setCompatMap(prev => { const next = { ...prev }; delete next[currentIndex]; return next; });
    if (onlineSourceRef.current === `${activeSeriesId}:${currentIndex}` || current?.status !== 'completed') {
      reconnectAttemptRef.current = null;
      startOnlinePlay(currentIndex, currentPosition(), true);
    } else goToEpisode(currentIndex, currentPosition());
  };

  const changeOnlineQuality = (quality) => {
    if (!['auto', '720p', '1080p'].includes(quality) || !supportsOnlineQuality) return;
    const seekTo = currentPosition();
    const autoplay = loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current;
    setOnlineQualityChoice(quality);
    stateRef.current.onlineQuality = quality;
    try { window.localStorage.setItem('hongguo:online-quality', quality); } catch { showToast('Đã đổi độ phân giải lần này, nhưng chưa lưu được'); }
    fallbackAttemptRef.current = null;
    reconnectAttemptRef.current = null;
    setCompatMap({});
    if (current && !current.locked) startOnlinePlay(currentIndex, seekTo, true, autoplay);
  };

  // Tìm tập tiếp theo (theo thứ tự số tập)
  const findNext = useCallback(
    (fromIndex) => {
      const idx = episodes.findIndex((e) => e.vid_index === fromIndex);
      if (idx === -1 || idx + 1 >= episodes.length) return null;
      return episodes.slice(idx + 1).find((ep) => !ep.locked) || null;
    },
    [episodes]
  );
  const findPrev = useCallback(
    (fromIndex) => {
      const idx = episodes.findIndex((e) => e.vid_index === fromIndex);
      if (idx <= 0) return null;
      return episodes.slice(0, idx).reverse().find((ep) => !ep.locked) || null;
    },
    [episodes]
  );

  const prepareNextEpisode = (event) => {
    const video = event.currentTarget;
    const media = loadedMediaRef.current;
    if (!cacheNext || !canPlay || video.paused || !media?.played || media.version !== mediaVersion.current
      || media.element !== video || (video.currentSrc && video.currentSrc !== videoSrc)) return;
    const next = findNext(currentIndex);
    if (!next?.vid || usableLocal(next, String(activeSeriesId)) || prefetchRef.current) return;
    const request = { requestId: crypto.randomUUID(), vid: next.vid, seriesId: activeSeriesId, vidIndex: next.vid_index, quality: onlineQuality };
    prefetchRef.current = request;
    request.promise = window.electronAPI.prepareOnlinePlay({ ...request, prefetch: true })
      .catch(error => ({ success: false, error: error.message }))
      .then(result => {
        if (prefetchRef.current !== request && onlineRequestRef.current !== request) {
          window.electronAPI.releaseOnlinePlay({ requestId: request.requestId, streamId: result?.streamId }).catch(() => {});
        } else if (prefetchRef.current === request) refreshCacheInfo();
        return result;
      });
  };

  // Phát xong -> tự phát tiếp (tập chưa tải tự chuyển sang phát trực tuyến, để "không tải cũng xem liên tục được")
  const handleEnded = useCallback(() => {
    const { currentIndex: ci, autoNext: an, activeSeriesId: sid } = stateRef.current;
    const finished = episodes.find((e) => e.vid_index === ci);

    // Xem xong tự xóa: xóa file cục bộ của tập vừa xem trước, rồi quyết định tập tiếp theo phát thế nào
    if (autoDelete && sid && usableLocal(finished, String(sid))) {
      window.electronAPI.deleteEpisodeFile(sid, ci).then((r) => {
        if (r && r.success && r.count > 0) {
          showToast(`Tập ${ci} đã xem xong, tự xóa file cục bộ (giải phóng ${fmtSize(r.freed)})`);
          refreshCacheInfo();
          loadDetail(sid);
        }
      });
    }

    if (!an) return;
    const next = findNext(ci);
    if (!next) {
      showToast(episodes.some((ep) => ep.locked) ? 'Đã phát hết các tập có thể phát, các tập còn lại cần mở khóa trên nền tảng nguồn' : 'Đã là tập cuối cùng');
      return;
    }
    goToEpisode(next.vid_index, 0);
    setAutoAdvancing(true);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findNext, goToEpisode, showToast, startOnlinePlay, autoDelete, episodes, refreshCacheInfo, loadDetail]);

  // Phát tiếp ở nền vẫn lưu tiến độ; rời trang, tạm dừng và đóng cửa sổ buộc lưu giây cuối.
  useEffect(() => {
    const timer = setInterval(persistPosition, 5000);
    const save = () => persistPosition(true);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [persistPosition]);

  useEffect(() => {
    if (!active) persistPosition(true);
  }, [active, persistPosition]);

  const handleMetadata = (event) => {
    const v = event.currentTarget;
    if (!canPlay || playbackVersion !== mediaVersion.current || v !== videoRef.current || !current || current.locked) return;
    if (v.currentSrc && v.currentSrc !== videoSrc) return;
    loadedMediaRef.current = { element: v, seriesId: activeSeriesId, vidIndex: currentIndex, version: mediaVersion.current, played: false };
    v.defaultPlaybackRate = playbackRateRef.current;
    v.playbackRate = playbackRateRef.current;
    const seekTo = Math.max(0, Number(pendingSeekRef.current) || 0);
    if (seekTo > 0 && (!Number.isFinite(v.duration) || seekTo < v.duration - 3)) {
      v.currentTime = seekTo;
      showToast(`Tiếp tục phát từ ${Math.floor(seekTo / 60)}:${String(Math.floor(seekTo % 60)).padStart(2, '0')}`);
    }
    pendingSeekRef.current = 0;
    if (compatMap[currentIndex]) releaseOnline();
    if (pendingAutoplayRef.current) v.play().catch(() => { if (playbackVersion === mediaVersion.current) setAutoAdvancing(false); });
  };

  const toggleFullscreen = useCallback(async () => {
    if (document.querySelector('.stealth-mode')) { showToast('Vui lòng thoát cửa sổ ẩn danh trước'); return; }
    try {
      if (portrait) { setWindowFill(fill => !fill); return; }
      if (document.fullscreenElement === stageRef.current) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch { showToast('Không thể vào hoặc thoát toàn màn hình, vui lòng thử lại'); }
  }, [portrait, showToast]);

  // Bắt các phím đã xử lý trước khi media controls; hủy cả keyup để nút đang focus không toggle hai lần.
  useEffect(() => {
    if (!active || confirmAsk || mergeAsk || pickerOpen) return;
    const held = new Set();
    const onKey = (event) => {
      const video = videoRef.current;
      if (!video || event.defaultPrevented || ignoresPlaybackShortcut(event.target)) return;
      const key = shortcutKey(event);
      const action = SHORTCUT_ACTIONS.find(item => shortcuts[item.id] === key);
      if (!action) return;
      event.preventDefault(); event.stopPropagation?.();
      held.add(event.code || event.key);
      if (event.repeat && !action.repeat) return;
      const { currentIndex: index, autoNext: nextEnabled } = stateRef.current;
      if (action.id === 'play') {
        if (video.paused) video.play().catch(() => showToast('Tạm thời không phát được, vui lòng thử lại tập này'));
        else video.pause();
      } else if (action.id === 'forward' || action.id === 'backward') {
        const limit = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
        try { video.currentTime = Math.max(0, Math.min(limit, video.currentTime + (action.id === 'forward' ? 5 : -5))); }
        catch { showToast('Tạm thời không nhảy được, vui lòng thử lại sau'); }
      } else if (action.id === 'previous' || action.id === 'next') {
        const episode = action.id === 'previous' ? findPrev(index) : findNext(index);
        if (episode) { goToEpisode(episode.vid_index); setAutoAdvancing(true); }
        else showToast(action.id === 'previous' ? 'Đã là tập đầu tiên' : 'Đã là tập cuối cùng');
      } else if (action.id === 'autoNext') setAutoNext(!nextEnabled);
      else if (action.id === 'fullscreen') toggleFullscreen();
      else changePlaybackRate(playbackRateRef.current + (action.id === 'slower' ? -0.25 : 0.25));
    };
    const onKeyUp = event => {
      if (!held.delete(event.code || event.key)) return;
      event.preventDefault(); event.stopPropagation?.();
    };
    const onBlur = () => held.clear();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [active, confirmAsk, mergeAsk, pickerOpen, findNext, findPrev, goToEpisode, changePlaybackRate, showToast, shortcuts, toggleFullscreen]);

  const switchSeries = useCallback(async (sid, requestedIndex = 0, resume = false) => {
    persistPosition(true);
    const version = ++selectionVersion.current;
    selectedSeriesRef.current = String(sid);
    fallbackAttemptRef.current = null;
    rejectedLocalRef.current = null;
    onSeriesSelected?.(String(sid));
    pendingTargetRef.current = null;
    reconnectAttemptRef.current = null;
    onlineSourceRef.current = null;
    resetPlayback();
    setCompatMap({});
    setActiveSeriesId(String(sid));
    setDetail(null);
    setWaitingFor(null);
    setLoading(true);
    try {
      const d = await loadDetail(sid);
      if (!d || version !== selectionVersion.current) return;
      const saved = requestedIndex && !resume ? null : await window.electronAPI.getPlaybackPosition(sid);
      if (version !== selectionVersion.current) return;
      const wantedIndex = requestedIndex || saved?.vid_index;
      const selected = d.episodes.find(e => e.vid_index === wantedIndex && !e.locked) || d.episodes.find(e => !e.locked);
      setCurrentIndex(selected?.vid_index || 1);
      pendingSeekRef.current = selected?.vid_index === saved?.vid_index ? saved.currentTime || 0 : 0;
      if ((requestedIndex || saved || stateRef.current.onlineQuality !== 'auto') && selected && !usableLocal(selected, String(sid))) {
        pendingTargetRef.current = { seriesId: String(sid), vidIndex: selected.vid_index, seekTo: pendingSeekRef.current };
      }
    } catch (e) {
      if (version === selectionVersion.current) showToast('Tải tập phim thất bại: ' + e.message);
    } finally {
      if (version === selectionVersion.current) setLoading(false);
    }
  }, [persistPosition, resetPlayback, loadDetail, showToast, onSeriesSelected, usableLocal]);

  // Lần đầu vào và duyệt phát dùng chung một lần tải, tránh hai yêu cầu khởi tạo ghi đè lẫn nhau.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await loadSeriesList();
        if (cancelled) return;
        const wanted = target?.seriesId && list.find(s => String(s.series_id) === String(target.seriesId));
        const selected = wanted || [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (selected) await switchSeries(selected.series_id, wanted ? target.vidIndex : 0, !!(wanted && target.resume));
        else setLoading(false);
      } catch (e) {
        if (!cancelled) { setLoading(false); showToast('Tải thư viện phim thất bại: ' + e.message); }
      }
    })();
    return () => { cancelled = true; };
  }, [target?.ts, loadSeriesList, switchSeries, showToast]);

  useEffect(() => {
    const pending = pendingTargetRef.current;
    if (loading || !pending || pending.seriesId !== String(activeSeriesId) || String(detail?.series_id) !== pending.seriesId) return;
    pendingTargetRef.current = null;
    startOnlinePlay(pending.vidIndex, pending.seekTo);
  }, [loading, detail, activeSeriesId, startOnlinePlay]);

  // Xóa một phim ngắn khỏi danh sách (chỉ hủy đăng ký, không xóa file cục bộ)
  const removeSeries = async (sid, title) => {
    const res = await window.electronAPI.removeSeries(sid);
    if (!res || !res.success) {
      showToast((res && res.error) || 'Xóa thất bại');
      return;
    }
    showToast(`Đã xóa khỏi danh sách《${title}》(file cục bộ giữ lại)`);
    const list = await loadSeriesList();
    refreshCacheInfo();
    if (String(sid) === String(activeSeriesId)) {
      const next = list[0];
      if (next) await switchSeries(next.series_id);
      else {
        selectionVersion.current++;
        selectedSeriesRef.current = '';
        resetPlayback();
        setActiveSeriesId('');
        setDetail(null);
      }
    }
  };

  const purgeEmpty = async () => {
    const res = await window.electronAPI.purgeEmptySeries();
    if (res && res.success) {
      showToast(res.count > 0 ? `Đã dọn ${res.count} bộ chưa tải` : 'Không có bộ nào cần dọn');
      const list = await loadSeriesList();
      refreshCacheInfo();
      if (!list.some((s) => String(s.series_id) === String(activeSeriesId))) {
        if (list[0]) await switchSeries(list[0].series_id);
        else { selectionVersion.current++; selectedSeriesRef.current = ''; resetPlayback(); setActiveSeriesId(''); setDetail(null); }
      }
    }
  };

  const restoreDismissed = async () => {
    const res = await window.electronAPI.restoreDismissedSeries();
    if (res && res.success) {
      showToast(res.count > 0 ? `Đã khôi phục ${res.count} bộ đã xóa` : 'Không có bộ nào bị xóa');
      await loadSeriesList();
      refreshCacheInfo();
    }
  };

  const clearCache = async () => {
    releasePrefetch();
    if (onlineRequestRef.current && !compatMap[currentIndex]) {
      stopPlayback('Phát trực tuyến đã dừng, có thể thử lại tập này để tiếp tục xem');
    }
    try {
      const r = await window.electronAPI.clearOnlineCache();
      if (!r?.success) { showToast(r?.error || 'Dọn cache phát thất bại'); return; }
      refreshCacheInfo();
      showToast('Đã xóa cache phát trực tuyến');
    } catch (e) { showToast('Dọn cache phát thất bại: ' + e.message); }
  };

  const downloadEpisode = async (vidIndex) => {
    if (qualityLoading || !episodes.some((ep) => ep.vid_index === vidIndex && !ep.locked)) return;
    const selection = selectionVersion.current;
    const media = mediaVersion.current;
    try {
      const res = await window.electronAPI.downloadSingleEpisode(activeSeriesId, vidIndex, downloadQuality);
      if (res && res.success) {
        showToast(res.count > 0 ? `Tập ${vidIndex} đã thêm vào hàng đợi tải` : `Tập ${vidIndex} đã có trong hàng đợi`);
        if (selection === selectionVersion.current && media === mediaVersion.current
          && String(activeSeriesId) === selectedSeriesRef.current && stateRef.current.currentIndex === vidIndex) setWaitingFor(vidIndex);
      } else {
        showToast((res && res.error) || 'Thêm vào tải thất bại');
      }
    } catch (error) { showToast(error.message || 'Thêm vào tải thất bại, vui lòng thử lại'); }
  };

  const downloadMissing = async () => {
    if (qualityLoading) return;
    const missing = episodes.filter((e) => !e.locked && e.status !== 'completed');
    if (!missing.length) {
      showToast('Tất cả tập có thể tải đều đã tải');
      return;
    }
    let ok = 0;
    let firstError = '';
    for (const ep of missing) {
      try {
        const r = await window.electronAPI.downloadSingleEpisode(activeSeriesId, ep.vid_index, downloadQuality);
        if (r?.success) ok++;
        else if (!firstError) firstError = r?.error || 'Thêm vào tải thất bại';
      } catch (error) { if (!firstError) firstError = error.message || 'Thêm vào tải thất bại'; }
    }
    showToast(firstError ? `${ok} tập gửi thành công, ${missing.length - ok} tập thất bại: ${firstError}` : `Đã thêm ${ok} tập vào hàng đợi tải`);
  };

  // Gộp nhanh bộ phim hiện tại (hiện hộp chọn định dạng)
  const mergeThisSeries = async (compatible) => {
    setMerging(true);
    setMergeAsk(false);
    try {
      const res = await window.electronAPI.mergeSeries(activeSeriesId, '', { compatible });
      if (!res || !res.success) {
        showToast((res && res.error) || 'Gộp thất bại');
        return;
      }
      const tip = compatible
        ? `Bắt đầu gộp định dạng tương thích ${res.count} tập (H.264, mất nhiều thời gian)`
        : `Bắt đầu gộp ${res.count} tập, khoảng ${(res.totalBytes / 1073741824).toFixed(2)} GB`;
      showToast(`${tip}, có thể xem tiến độ trong "Quản lý tải xuống"`);
      if (res.codecWarning) showToast(res.codecWarning);
    } catch (e) {
      showToast('Lỗi gộp: ' + e.message);
    } finally {
      setMerging(false);
    }
  };

  useDialogKeyboard(active && !!(confirmAsk || mergeAsk), () => { setConfirmAsk(null); setMergeAsk(false); }, '.player-confirm');

  useEffect(() => {
    if (actionsHidden || !active || !portrait) {
      setPortraitActionsOpen(false);
      setEpisodesOpen(false);
    }
    if (actionsHidden || !active) setPickerOpen(false);
  }, [actionsHidden, active, portrait]);

  useEffect(() => {
    window.electronAPI.setEpisodePanelOpen?.(active && portrait && episodesOpen && !loading).catch(() => {
      setEpisodesOpen(false);
      showToast('Không thể mở danh sách tập, vui lòng thử lại');
    });
  }, [active, portrait, episodesOpen, loading, showToast]);
  useEffect(() => () => { window.electronAPI.setEpisodePanelOpen?.(false).catch(() => {}); }, []);

  // ===== Render =====
  if (loading) {
    return <div className="player-container"><div className="player-empty">Đang tải…</div></div>;
  }

  if (!seriesList.length) {
    return (
      <div className="player-container">
        <div className="player-header">
          <div className="player-title"><Play size={22} /><h2>Thư viện phim của tôi</h2></div>
        </div>
        <div className="player-empty">
          <Film size={40} />
          <p>Chưa có phim ngắn nào để phát</p>
          <p className="player-empty-sub">Hãy khám phá hoặc tìm một phim ngắn, tại đây chọn tập, xem và quản lý.</p>
          <div className="player-empty-actions">
            {onNavigate && (
              <button className="btn btn-primary" onClick={() => onNavigate('browse')}>
                Khám phá phim ngắn
              </button>
            )}
            {onNavigate && (
              <button className="btn btn-outline" onClick={() => onNavigate('download')}>
                Tìm phim
              </button>
            )}
          </div>
          {dismissedCount > 0 && (
            <button className="btn btn-outline btn-sm" onClick={restoreDismissed}>
              Khôi phục {dismissedCount} bộ đã xóa
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`player-container ${portraitActionsOpen ? 'portrait-actions-open' : ''} ${episodesOpen ? '' : 'episodes-collapsed'}`}>
      <div className="player-header" hidden={actionsHidden}>
        <div className="player-title">
          <Play size={22} />
          <h2>Thư viện phim của tôi</h2>
        </div>
        <div className="player-header-right" id="player-management">
          <p className="player-download-quality-hint" id="player-online-quality-hint">Độ phân giải phát trực tuyến dùng cho phát hiện tại, chuyển tập và tải xuống dự phòng khi phát thất bại. Chỉ định chất lượng chỉ hỗ trợ nguồn Hồng Quả; các nguồn khác do nguồn quyết định. File độ phân giải thấp đã có sẽ được giữ lại và chuyển sang phát trực tuyến.</p>
          <p className="player-download-quality-hint" id="player-download-quality-hint">Tải thủ công sử dụng tùy chọn này; khi phát trực tuyến chọn "Tự động", tải xuống dự phòng cũng dùng tùy chọn này. Chất lượng không khả dụng sẽ có thông báo, không tự động hạ cấp; file đã có được giữ lại.</p>
          <span className="player-stat">Đã tải {playableCount} / {episodes.length || 0} tập</span>

          <button
            aria-pressed={cacheNext}
            className={`btn btn-outline ${cacheNext ? 'btn-autonext-on' : ''}`}
            onClick={toggleCacheNext}
            disabled={cacheNextSaving}
            title="Tập hiện tại bắt đầu phát sẽ cache trước tập tiếp theo, giảm thời gian chờ khi chuyển tập; sẽ dùng lưu lượng mạng"
          >
            <Download size={15} />
            Cache tập tiếp theo {cacheNext ? 'bật' : 'tắt'}
          </button>
          <button
            aria-pressed={autoNext}
            className={`btn btn-outline ${autoNext ? 'btn-autonext-on' : ''}`}
            onClick={() => setAutoNext(!autoNext)}
            title={`Phát xong tự động phát tập tiếp theo (${formatShortcut(shortcuts.autoNext)})`}
          >
            <Layers size={15} />
            Phát liên tục {autoNext ? 'bật' : 'tắt'}
          </button>
          <button
            aria-pressed={autoCompat}
            className={`btn btn-outline ${autoCompat ? 'btn-autonext-on' : ''}`}
            onClick={toggleAutoCompat}
            title="Khi máy không giải mã được HEVC sẽ tự động chuyển mã sang H.264 để phát (giải quyết màn hình đen có tiếng)"
          >
            <Zap size={15} />
            Chế độ tương thích {autoCompat ? 'bật' : 'tắt'}
          </button>
          <button
            aria-pressed={autoDelete}
            className={`btn btn-outline ${autoDelete ? 'btn-autonext-on' : ''}`}
            onClick={toggleAutoDelete}
            title="Sau khi xem xong một tập sẽ tự xóa file cục bộ của tập đó (vừa xem vừa dọn, không chiếm ổ đĩa)"
          >
            <Trash2 size={15} />
            Xem xong tự xóa {autoDelete ? 'bật' : 'tắt'}
          </button>
          <label className="player-download-quality">
            <span>Độ phân giải phát trực tuyến</span>
            <select className="input-field" aria-label="Độ phân giải phát trực tuyến" value={onlineQuality}
              disabled={!supportsOnlineQuality} aria-describedby="player-online-quality-hint"
              onChange={event => changeOnlineQuality(event.target.value)}>
              <option value="auto">{supportsOnlineQuality ? 'Tự động (ưu tiên tương thích)' : 'Do nguồn quyết định'}</option>
              <option value="720p">720P</option>
              <option value="1080p">1080P</option>
            </select>
          </label>
          <label className="player-download-quality">
            <span>Độ phân giải tải</span>
            <select className="input-field" value={downloadQuality} disabled={qualityLoading}
              aria-describedby="player-download-quality-hint"
              onChange={(event) => setDownloadQuality(event.target.value)}>
              <option value="auto">Tự động (ưu tiên tương thích)</option>
              <option value="1080p">1080P</option>
              <option value="720p">720P</option>
            </select>
          </label>
          <button className="btn btn-outline" onClick={downloadMissing} disabled={qualityLoading}>
            <Download size={15} />
            Tải các tập chưa xong
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setMergeAsk(true)}
            disabled={merging || playableCount === 0}
            title="Gộp các tập đã tải thành một file mp4, tiện xem một lần"
          >
            <Layers size={15} />
            {merging ? 'Đang gửi...' : 'Gộp xuất toàn bộ tập'}
          </button>
        </div>
      </div>

      {/* Chọn tập: phim hiện tại + panel quản lý dropdown (thay cho thanh ngang ngày càng dài) */}
      <div className="player-series-row" hidden={actionsHidden}>
        <div className="player-series-current">
          <span className="player-series-label">Đang phát</span>
          <span className="player-series-name" title={detail ? detail.series_title : ''}>
            {detail ? detail.series_title : '—'}
          </span>
        </div>
        <div className="player-series-actions">
        <button className="btn btn-outline portrait-management-toggle" aria-expanded={portraitActionsOpen}
          aria-controls="player-management" onClick={() => setPortraitActionsOpen((open) => !open)}>Quản lý</button>
        <button
          aria-expanded={pickerOpen}
          className={`btn btn-outline series-picker-btn ${pickerOpen ? 'open' : ''}`}
          onClick={() => setPickerOpen((v) => !v)}
        >
          Đổi phim
          <span className="series-count">{seriesList.length}</span>
          <ChevronDown size={15} />
        </button>
        </div>
      </div>

      {pickerOpen && !actionsHidden && (
        <div className="series-picker">
          <div className="series-picker-head">
            <input
              type="text"
              className="input-field"
              aria-label="Tìm trong thư viện phim của tôi"
              placeholder="Tìm tên phim…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
            />
            <button className="icon-btn" title="Đóng" onClick={() => setPickerOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="series-picker-list">
            {seriesList.length === 0 && <div className="series-picker-empty">Chưa có phim nào</div>}
            {seriesList
              .filter((s) => !pickerQuery.trim() || (s.series_title || '').includes(pickerQuery.trim()))
              .map((s) => {
                const isActive = String(s.series_id) === String(activeSeriesId);
                const dl = downloadedMap[String(s.series_id)];
                return (
                  <div
                    key={s.series_id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Chọn phim ${s.series_title}`}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || !['Enter', ' '].includes(e.key)) return;
                      e.preventDefault();
                      if (!isActive) switchSeries(s.series_id);
                      setPickerOpen(false);
                    }}
                    className={`series-row ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      if (!isActive) switchSeries(s.series_id);
                      setPickerOpen(false);
                    }}
                  >
                    <div className="series-row-cover">
                      {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <Film size={14} />}
                    </div>
                    <div className="series-row-body">
                      <div className="series-row-title">{s.series_title}</div>
                      <div className="series-row-sub">
                        {dl && dl.completed > 0 ? `Đã tải ${dl.completed}/${dl.total} tập` : `Tổng ${(s.episodes || []).length} tập · chưa tải`}
                      </div>
                    </div>
                    {isActive && <span className="series-row-cur">Đang phát</span>}
                    {(() => {
                      const st = storageMap[String(s.series_id)];
                      const hasFiles = st && st.files > 0;
                      return (
                        <>
                          {hasFiles && (
                            <button
                              className="icon-btn icon-btn-danger series-row-del"
                              title={`Xóa file cục bộ (${st.files} file · ${fmtSize(st.bytes)})`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmAsk({
                                  title: 'Xóa file cục bộ',
                                  message: `Sẽ xóa ${st.files} file đã tải của《${s.series_title}》, giải phóng ${fmtSize(st.bytes)}.\nPhim vẫn giữ trong danh sách, sau này có thể phát trực tuyến hoặc tải lại bất cứ lúc nào.`,
                                  okText: 'Xóa file',
                                  danger: true,
                                  onOk: async () => {
                                    if (String(s.series_id) === selectedSeriesRef.current && !onlineUrl && !compatMap[currentIndex]) stopPlayback('Phát cục bộ đã dừng, có thể kết nối lại nguồn để xem');
                                    const r = await window.electronAPI.deleteSeriesFiles(s.series_id);
                                    if (r && r.success) {
                                      showToast(`Đã xóa ${r.count} file, giải phóng ${fmtSize(r.freed)}`);
                                      await loadDetail(activeSeriesId);
                                      refreshCacheInfo();
                                    } else {
                                      showToast((r && r.error) || 'Xóa thất bại');
                                    }
                                  },
                                });
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                          <button
                            className="icon-btn series-row-del"
                            title="Xóa khỏi danh sách (không xóa file cục bộ)"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSeries(s.series_id, s.series_title);
                            }}
                          >
                            <X size={15} />
                          </button>
                        </>
                      );
                    })()}
                  </div>
                );
              })}
          </div>

          <div className="series-picker-foot">
            {storageTotal.files > 0 && (
              <span className="series-picker-usage">
                Cục bộ đã dùng <b>{fmtSize(storageTotal.bytes)}</b> / {storageTotal.files} file
              </span>
            )}
            <button className="btn btn-outline btn-sm" onClick={purgeEmpty} title="Xóa khỏi danh sách những phim chưa tải tập nào">
              <Trash2 size={14} />
              Dọn phim chưa tải
            </button>
            {dismissedCount > 0 && (
              <button className="btn btn-outline btn-sm" onClick={restoreDismissed}>
                Khôi phục đã xóa ({dismissedCount})
              </button>
            )}
            {storageTotal.files > 0 && (
              <button
                className="btn btn-outline btn-sm btn-danger-text"
                title="Xóa tất cả file cục bộ đã tải"
                onClick={() => {
                  setConfirmAsk({
                    title: 'Xóa tất cả file cục bộ',
                    message: `Sẽ xóa tất cả file tập phim đã tải, tổng ${storageTotal.files} file, ${fmtSize(storageTotal.bytes)}.\nDanh sách phim và thông tin tập sẽ giữ lại, sau này vẫn có thể phát trực tuyến hoặc tải lại.`,
                    okText: 'Xóa tất cả',
                    danger: true,
                    onOk: async () => {
                      if (current?.fileUrl && !onlineUrl && !compatMap[currentIndex]) stopPlayback('Phát cục bộ đã dừng, có thể kết nối lại nguồn để xem');
                      const r = await window.electronAPI.deleteAllDownloaded();
                      if (r && r.success) {
                        showToast(`Đã xóa ${r.count} file, giải phóng ${fmtSize(r.freed)}`);
                        await loadDetail(activeSeriesId);
                        refreshCacheInfo();
                      } else {
                        showToast((r && r.error) || 'Xóa thất bại');
                      }
                    },
                  });
                }}
              >
                Xóa tất cả đã tải
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={clearCache} title="Giải phóng bộ nhớ phát trực tuyến đang chiếm">
              <Zap size={14} />
              Xóa cache phát{cacheInfo.count > 0 ? ` (${cacheInfo.count})` : ''}
            </button>
            {compatCache.files > 0 && (
              <button className="btn btn-outline btn-sm" onClick={clearCompatCache} title="Xóa file định dạng tương thích do chuyển mã">
                <Trash2 size={14} />
                Xóa cache chuyển mã ({fmtSize(compatCache.bytes)})
              </button>
            )}
          </div>
        </div>
      )}

      <div className="player-viewing-layout">
      {/* Khu vực phát */}
      <div className={`player-stage ${windowFill ? 'player-window-fill' : ''}`} data-picture-mode={pictureMode} ref={stageRef}>
          <video
            ref={videoRef}
            crossOrigin="anonymous"
            src={videoSrc || undefined}
            className="player-video"
            aria-busy={!canPlay || mediaBuffering}
            tabIndex={0}
            aria-label={`Khung hình video, ${formatShortcut(shortcuts.play)} để phát hoặc tạm dừng`}
            onClick={() => {
              const video = videoRef.current;
              if (!canPlay || !video) return;
              video.focus({ preventScroll: true });
              if (video.paused) video.play().catch(() => showToast('Tạm thời không phát được, vui lòng thử lại tập này'));
              else video.pause();
            }}
            onLoadedMetadata={handleMetadata}
            onTimeUpdate={prepareNextEpisode}
            onPlay={(event) => {
              const media = loadedMediaRef.current;
              if (!canPlay || playbackVersion !== mediaVersion.current || !media || media.version !== mediaVersion.current || media.element !== event.currentTarget) {
                event.currentTarget.pause();
                return;
              }
            }}
            onRateChange={(event) => {
              const v = event.currentTarget;
              if (!canPlay || v !== videoRef.current || v.readyState === 0 || loadedMediaRef.current?.version !== mediaVersion.current) return;
              if (v.currentSrc && v.currentSrc !== videoSrc) return;
              if (v.playbackRate !== playbackRateRef.current) changePlaybackRate(v.playbackRate);
            }}
            onEnded={() => { if (canPlay && playbackVersion === mediaVersion.current && (!videoRef.current || loadedMediaRef.current?.version === mediaVersion.current)) handleEnded(); }}
            onPause={() => persistPosition(true)}
            onPlaying={(event) => { handlePlaying(event); prepareNextEpisode(event); }}
            onWaiting={() => { if (canPlay && playbackVersion === mediaVersion.current) setMediaBuffering(true); }}
            onCanPlay={() => { if (canPlay && playbackVersion === mediaVersion.current) setMediaBuffering(false); }}
            onError={(event) => {
              if (!canPlay || compatRequestRef.current || playbackVersion !== mediaVersion.current) return;
              if (videoRef.current && event.currentTarget !== videoRef.current) return;
              if (event.currentTarget.currentSrc && event.currentTarget.currentSrc !== videoSrc) return;
              const errorCode = event.currentTarget.error?.code;
              // Chromium cũng báo stream HTTP không khả dụng là unsupported source (4).
              const unavailableOnline = errorCode === 4 && videoSrc === onlineUrl;
              if (unavailableOnline && reconnectOnce()) return;
              const failedDecode = [3, 4].includes(errorCode);
              if (!failedDecode && errorCode === 2 && reconnectOnce()) return;
              if (isOnlinePlaying && (errorCode === 2 || unavailableOnline)) {
                recoverOnlineFailure(current, 'Phát trực tuyến thất bại, đang thử file cục bộ hoặc tải xuống');
                return;
              }
              if (!failedDecode) {
                const seekTo = currentPosition(); resetPlayback(); pendingSeekRef.current = seekTo;
                setPlaybackError('Tải video thất bại, vui lòng thử lại tập này hoặc kiểm tra mạng');
              }
              setMediaBuffering(false);
              setDecodeFailed(failedDecode);
              showToast(failedDecode ? 'Nguồn phát tạm thời không phát được, vui lòng kết nối lại nguồn' : 'Tải video thất bại, vui lòng thử lại tập này hoặc kiểm tra mạng');
              if (failedDecode && !unavailableOnline) tryAutoCompat(currentIndex);
            }}
          />
        <VideoEnhancement videoRef={videoRef} source={videoSrc} available={canPlay && active} enhancement={enhancement} />
        <CommentDanmaku videoRef={videoRef} source={videoSrc} available={canPlay && active} danmaku={danmaku} />
        <PlayerControls danmaku={showDanmakuControls ? danmaku : null} enhancement={enhancement} continuing={autoAdvancing && !playbackError && !decodeFailed} autoContinue={autoNext && !!findNext(currentIndex)} shortcuts={shortcuts} onToggleFullscreen={toggleFullscreen} portrait={portrait} windowFill={windowFill} onWindowFill={setWindowFill} videoRef={videoRef} stageRef={stageRef} source={videoSrc} available={canPlay}
          pictureMode={pictureMode} onPictureModeChange={changePictureMode} rate={playbackRate} onRateChange={changePlaybackRate} onError={showToast} />
        {!canPlay && (
          <div className="player-placeholder" style={{ position: 'absolute', inset: 0 }}>
            {playbackError ? (
              <><Film size={34} /><p role="alert">{playbackError}</p><div className="player-placeholder-actions">
                <button className="btn btn-primary" onClick={retryPlayback}>{current?.status === 'completed' ? 'Thử lại tập này' : 'Thử lại tập này (phát trực tuyến)'}</button>
                {current?.vid && <button className="btn btn-outline" onClick={() => startOnlinePlay(currentIndex, undefined, true)}>Kết nối lại nguồn</button>}
                {fallbackRef.current && !fallbackRef.current.submitting && <button className="btn btn-outline" onClick={() => startCompatPlay(currentIndex, true)}>Chuyển mã rồi phát</button>}
              </div></>
            ) : onlineProgress && onlineProgress.vid && (!current || current.vid === onlineProgress.vid) ? (
              <>
                <RefreshCw size={30} className="spin" />
                <p>{onlineProgress.phase === 'preparing' ? 'Đang kết nối nguồn phát…' : onlineProgress.phase === 'decrypting' ? 'Đang chuẩn bị phát…' : 'Đang đệm phát trực tuyến…'}</p>
                {onlineProgress.phase !== 'preparing' && <div className="player-wait-bar">
                  <div className="player-wait-fill" style={{ width: `${onlineProgress.percent || 0}%` }} />
                </div>}
                <span className="player-placeholder-sub">
                  {onlineProgress.phase === 'preparing' ? 'Lấy địa chỉ phát được' : `${onlineProgress.percent || 0}%`}
                  {onlineProgress.total ? ` · ${(onlineProgress.received / 1048576).toFixed(1)} / ${(onlineProgress.total / 1048576).toFixed(1)} MB` : ''}
                  {' · không ghi vào thư mục tải xuống'}
                </span>
                <button className="btn btn-outline" onClick={() => stopPlayback()}>Hủy phát</button>
              </>
            ) : waitingFor != null ? (
              <>
                <RefreshCw size={30} className="spin" />
                <p>Tập {waitingFor} đang tải, tải xong sẽ tự phát…</p>
                {(() => {
                  const ep = episodes.find((e) => e.vid_index === waitingFor);
                  return ep && ep.status === 'downloading' ? (
                    <div className="player-wait-bar">
                      <div className="player-wait-fill" style={{ width: `${ep.progress || 0}%` }} />
                    </div>
                  ) : null;
                })()}
                <span className="player-placeholder-sub">Tải xong sẽ tiếp tục tập này; hủy chờ không dừng tải</span>
                <button className="btn btn-outline" onClick={() => stopPlayback('Đã hủy chờ, tải vẫn tiếp tục; có thể xem trong quản lý tải xuống')}>Hủy chờ</button>
              </>
            ) : current?.locked || (episodes.length > 0 && episodes.every((ep) => ep.locked)) ? (
              <><Film size={34} /><p>Cần mở khóa trên nền tảng nguồn để xem</p><span className="player-placeholder-sub">Ứng dụng này không cung cấp mở khóa</span></>
            ) : current ? (
              <>
                <Film size={34} />
                <p>
                  Tập {current.vid_index}
                  {current.status === 'downloading' ? ' đang tải' : current.status === 'pending' ? ' đang chờ' : ' chưa tải'}
                </p>
                {current.status === 'downloading' && (
                  <div className="player-wait-bar">
                    <div className="player-wait-fill" style={{ width: `${current.progress || 0}%` }} />
                  </div>
                )}
                <div className="player-placeholder-actions">
                  <button className="btn btn-primary" onClick={() => startOnlinePlay(current.vid_index)}>
                    <Play size={15} />
                    Phát trực tuyến (không tải)
                  </button>
                  <button className="btn btn-outline" disabled={qualityLoading} onClick={() => downloadEpisode(current.vid_index)}>
                    <Download size={15} />
                    Tải tập này
                  </button>
                </div>
                <span className="player-placeholder-sub">Phát trực tuyến không lưu vào thư mục tải xuống, file tạm chuẩn bị sẽ tự dọn</span>
              </>
            ) : (
              <>
                <Film size={34} />
                <p>Vui lòng chọn một tập để bắt đầu phát</p>
              </>
            )}
          </div>
        )}

        {canPlay && mediaBuffering && !compatProgress && (
          <div className="compat-overlay" role="status">
            <RefreshCw size={26} className="spin" /><p>Đang tải video…</p>
            <button className="btn btn-outline" onClick={() => stopPlayback()}>Hủy phát</button>
          </div>
        )}

        {/* Overlay chế độ tương thích: thông báo lỗi giải mã / tiến độ chuyển mã */}
        {compatProgress && compatProgress.vidIndex === currentIndex && (
          <div className="compat-overlay">
            <RefreshCw size={26} className="spin" />
            <p>Đang chuyển mã sang định dạng tương thích (H.264)…</p>
            <div className="player-wait-bar">
              <div className="player-wait-fill" style={{ width: `${compatProgress.percent || 0}%` }} />
            </div>
            <span className="compat-overlay-sub">
              {compatProgress.percent || 0}% · đang xử lý video hiện tại, xong sẽ chuyển sang nguồn tương thích
            </span>
            <button className="btn btn-outline" onClick={() => stopPlayback('Đã hủy chuyển mã, có thể thử lại tập này để tiếp tục xem')}>Hủy chuyển mã</button>
          </div>
        )}

        {!compatProgress && decodeFailed && canPlay && (
          <div className="compat-overlay">
            <Film size={30} />
            <p>Nguồn phát hiện tại tạm thời không phát được</p>
            <span className="compat-overlay-sub" role={compatError ? 'alert' : undefined}>
              {compatError || 'Vui lòng kết nối lại nguồn; nếu vẫn có vấn đề về hình ảnh hoặc định dạng, có thể thử chuyển mã sang H.264.'}
            </span>
            <div className="player-placeholder-actions">
              <button className="btn btn-primary" onClick={retryPlayback}>Thử lại tập này</button>
              <button className="btn btn-outline" onClick={() => startOnlinePlay(currentIndex, undefined, true)}>Kết nối lại nguồn</button>
              <button className="btn btn-outline" onClick={() => startCompatPlay(currentIndex, true)}>
                <Zap size={15} />
                Chuyển mã lại rồi phát
              </button>
              <button className="btn btn-outline" onClick={toggleAutoCompat}>
                {autoCompat ? 'Tắt tự động chuyển mã' : 'Bật tự động chuyển mã'}
              </button>
            </div>
          </div>
        )}
      </div>

      <section className="player-episode-panel" id="player-episode-panel" aria-label="Chọn tập">
      <h3 className="portrait-episode-heading">Chọn tập</h3>
      {/* Thông tin tập đang phát */}
      {current && (
        <div className="player-now">
          <span className="player-now-title">
            《{detail ? detail.series_title : ''}》Tập {current.vid_index}
          </span>
          {current.title && <span className="player-now-sub">{current.title}</span>}
          <span className={`player-now-status status-${current.status}`}>
            {current.locked ? 'Khóa' : current.status === 'completed' ? 'Có thể phát' : current.status === 'downloading' ? `Đang tải ${current.progress || 0}%` : current.status === 'pending' ? 'Đang chờ' : 'Chưa tải'}
          </span>
        </div>
      )}

      {detail?.web_accessible_episodes != null && detail.web_accessible_episodes < detail.total && (
        <p className="player-tips">Nguồn web cung cấp {detail.web_accessible_episodes} tập đầu, các tập sau sẽ tự động thử nguồn App.</p>
      )}

      {episodes.some((ep) => ep.locked) && <p className="player-tips">Tập khóa cần mở khóa trên nền tảng nguồn, ứng dụng này không cung cấp mở khóa; phát liên tục sẽ bỏ qua tập khóa.</p>}

      {/* Danh sách tập */}
      <div className="player-episodes">
        {episodes.map((ep) => {
          const isCurrent = ep.vid_index === currentIndex;
          return (
            <button
              key={ep.vid_index}
              disabled={ep.locked === true}
              aria-label={`Tập ${ep.vid_index}`}
              aria-pressed={isCurrent}
              className={`ep-chip ep-${ep.status} ${isCurrent ? 'ep-current' : ''}`}
              onClick={() => goToEpisode(ep.vid_index)}
              title={
                ep.locked ? 'Cần mở khóa trên nền tảng nguồn' : ep.status === 'completed'
                  ? 'Nhấp để phát (cục bộ)'
                  : ep.status === 'downloading' || ep.status === 'pending'
                  ? 'Tải tiếp tục, nhấp để phát trực tuyến'
                  : 'Nhấp để phát trực tuyến (không tải) · nhấp đúp để thêm vào tải'
              }
              onDoubleClick={() => ep.status !== 'completed' && downloadEpisode(ep.vid_index)}
            >
              <span className="ep-num">{ep.vid_index}</span>{ep.locked && <span className="ep-lock-label">Khóa</span>}
              {ep.status === 'completed' && <Check size={11} className="ep-badge" />}
              {ep.status === 'downloading' && (
                <span className="ep-progress" style={{ width: `${ep.progress || 0}%` }} />
              )}
              {onlineVid === ep.vid && <span className="ep-online-dot" />}
            </button>
          );
        })}
      </div>

      <div className="player-tips">
        Phím tắt: {SHORTCUT_ACTIONS.map(action => `${formatShortcut(shortcuts[action.id])} ${action.label}`).join(' · ')}. Có thể thay đổi trong cài đặt.
        <br />
        <b>Tập xám chưa khóa nhấp một lần là phát trực tuyến ngay</b> (không lưu vào thư mục tải xuống); nhấp đúp mới thêm vào hàng đợi tải.
        Khi phát liên tục gặp tập chưa tải sẽ tự chuyển sang phát trực tuyến.
      </div>

      </section>
      </div>

      {/^[0-9]{6,30}$/.test(String(activeSeriesId)) && <CommunityPanel seriesId={activeSeriesId} episodeId={current?.vid} title={detail?.series_title || ''} />}
      {toast && <div className="dm-toast dm-toast-success" onClick={() => setToast(null)}>{toast}</div>}

      {/* Chọn định dạng gộp */}
      {mergeAsk && (
        <div className="player-confirm-mask" onClick={() => setMergeAsk(false)}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : 'Gộp xuất'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title" style={{ color: 'var(--accent)' }}>
              <Layers size={17} />
              Gộp xuất toàn bộ tập
            </div>
            <div className="player-confirm-msg">
              <p>Gộp {playableCount} tập đã tải của《{detail ? detail.series_title : ''}》thành một file mp4.</p>
              <p><b>Gộp nhanh</b>: giữ nguyên chất lượng và codec gốc, xử lý nhanh; một số thiết bị có thể không phát được.</p>
              <p><b>Gộp tương thích</b>: chuyển sang định dạng H.264 tương thích tốt hơn, mất nhiều thời gian hơn.</p>
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setMergeAsk(false)}>Hủy</button>
              <button className="btn btn-outline" onClick={() => mergeThisSeries(true)} disabled={merging}>
                Gộp tương thích (H.264)
              </button>
              <button className="btn btn-primary" onClick={() => mergeThisSeries(false)} disabled={merging}>
                Gộp nhanh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Xác nhận xóa */}
      {confirmAsk && (        <div className="player-confirm-mask" onClick={() => setConfirmAsk(null)}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : 'Gộp xuất'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title">
              <Trash2 size={17} />
              {confirmAsk.title}
            </div>
            <div className="player-confirm-msg">
              {String(confirmAsk.message).split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setConfirmAsk(null)}>Hủy</button>
              <button
                className={`btn ${confirmAsk.danger ? 'btn-danger-solid' : 'btn-primary'}`}
                onClick={async () => {
                  const fn = confirmAsk.onOk;
                  setConfirmAsk(null);
                  await fn();
                }}
              >
                {confirmAsk.okText || 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Player;
