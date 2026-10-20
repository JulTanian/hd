import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useDialogKeyboard from './useDialogKeyboard';
import './DownloadManager.css';
import { Download, Trash2, RefreshCw, X, Film, Square, Folder, Zap, CheckSquare, Play, Pause, Layers } from './icons';

const STATUS_TEXT = {
  pending: 'Đang chờ',
  downloading: 'Đang tải',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  stopped: 'Đã dừng',
};

const STATUS_ORDER = {
  downloading: 0,
  pending: 1,
  failed: 2,
  stopped: 3,
  completed: 4,
};

const isWaitingRetry = task => task.status === 'failed' && !!task.retryAt;
const needsManualRetry = task => task.status === 'stopped' || task.status === 'failed' && !isWaitingRetry(task);

function sortTasks(list) {
  const key = task => task.hongguoInfo?.series_id != null ? `series:${task.hongguoInfo.series_id}` : `task:${task.id}`;
  const groups = new Map();
  for (const task of list) {
    const group = groups.get(key(task)) || { rank: 99, time: 0 };
    group.rank = Math.min(group.rank, STATUS_ORDER[task.status] ?? 99);
    group.time = Math.max(group.time, task.startTime || 0);
    groups.set(key(task), group);
  }
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b), ga = groups.get(ka), gb = groups.get(kb);
    if (ka !== kb) return ga.rank - gb.rank || gb.time - ga.time || ka.localeCompare(kb, 'zh-CN', { numeric: true });
    return (Number(a.hongguoInfo?.vid_index) || 0) - (Number(b.hongguoInfo?.vid_index) || 0) || (a.startTime || 0) - (b.startTime || 0);
  });
}

function fmtElapsed(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return value < 60 ? `${value} giây` : value < 3600 ? `${Math.floor(value / 60)} phút ${value % 60} giây` : `${Math.floor(value / 3600)} giờ ${Math.floor(value % 3600 / 60)} phút`;
}

function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + units[i];
}

const PAGE_SIZE = 100;

function DownloadManager({ onNavigate, active = true }) {
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [queue, setQueue] = useState({ active: 0, queued: 0, maxConcurrent: 3 });
  const [seriesList, setSeriesList] = useState([]);
  const [mergeSeriesId, setMergeSeriesId] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeTasks, setMergeTasks] = useState([]);
  const [confirmAsk, setConfirmAsk] = useState(null); // Xác nhận xóa (có thể tick xóa file cục bộ)
  const [mergeAsk, setMergeAsk] = useState(false);    // Chọn định dạng gộp
  const [page, setPage] = useState(1);
  const [orderVersion, setOrderVersion] = useState(0);
  const [loadError, setLoadError] = useState('');
  const toastTimerRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const requests = useRef({ tasks: 0, queue: 0, series: 0, merges: 0 });
  const taskIndex = useRef(new Map());

  const refresh = useCallback(async () => {
    const request = ++requests.current.tasks;
    try {
      const list = await window.electronAPI.getDownloadTasks();
      if (!activeRef.current || request !== requests.current.tasks) return;
      if (!Array.isArray(list)) throw new Error('Đọc danh sách tải thất bại, vui lòng thử lại');
      setTasks(list);
      setOrderVersion(value => value + 1);
      const ids = new Set(list.map(task => task.id));
      setSelected(previous => new Set([...previous].filter(id => ids.has(id))));
      setLoadError('');
    } catch (error) {
      if (activeRef.current && request === requests.current.tasks) setLoadError(error.message || 'Đọc danh sách tải thất bại, vui lòng thử lại');
    }
  }, []);

  const loadQueue = useCallback(async () => {
    const request = ++requests.current.queue;
    try {
      const q = await window.electronAPI.getQueueStatus();
      if (q && activeRef.current && request === requests.current.queue) setQueue(q);
    } catch (_) {}
  }, []);

  const loadSeriesList = useCallback(async () => {
    const request = ++requests.current.series;
    try {
      const list = (await window.electronAPI.getSeriesList({ downloadedOnly: true })) || [];
      if (!activeRef.current || request !== requests.current.series) return;
      setSeriesList(list);
      setMergeSeriesId((prev) => list.some(item => String(item.series_id) === prev) ? prev : (list[0] ? String(list[0].series_id) : ''));
    } catch (_) {}
  }, []);

  // Khi danh sách làm mới và chọn phim khác, hộp xác nhận cũ không được tiếp tục gửi.
  useEffect(() => { setMergeAsk(false); }, [mergeSeriesId]);

  const loadMergeTasks = useCallback(async () => {
    const request = ++requests.current.merges;
    try {
      const list = (await window.electronAPI.getMergeTasks()) || [];
      if (activeRef.current && request === requests.current.merges) setMergeTasks(list);
    } catch (_) {}
  }, []);

  const showToast = useCallback((text, type = 'success') => {
    setToast({ text, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    loadQueue();
    loadSeriesList();
    loadMergeTasks();
    const patches = new Map();
    let batchTimer = null, fullRefresh = false, reorder = false, seriesDirty = false, queueDirty = false;
    const schedule = () => {
      if (batchTimer !== null) return;
      batchTimer = setTimeout(() => {
        batchTimer = null;
        if (fullRefresh) refresh();
        else if (patches.size) {
          const updates = new Map(patches);
          setTasks(previous => previous.map(task => updates.has(task.id) ? { ...task, ...updates.get(task.id) } : task));
          if (reorder) setOrderVersion(value => value + 1);
        }
        if (seriesDirty) loadSeriesList();
        if (queueDirty) loadQueue();
        patches.clear();
        fullRefresh = reorder = seriesDirty = queueDirty = false;
      }, 200);
    };
    const patchTask = (data, status, affectsOrder = false) => {
      if (!data?.id) return;
      patches.set(data.id, { ...patches.get(data.id), ...data, status });
      reorder ||= affectsOrder || taskIndex.current.get(data.id)?.status !== status;
      schedule();
    };
    const cleanups = [
      window.electronAPI.onDownloadProgress((data) => {
        patchTask(data, 'downloading');
      }),
      window.electronAPI.onDownloadTaskAdded(() => { fullRefresh = seriesDirty = true; schedule(); }),
      window.electronAPI.onDownloadCompleted((data) => {
        seriesDirty = true;
        patchTask({ ...data, progress: 100 }, 'completed', true);
      }),
      window.electronAPI.onDownloadFailed((data) => {
        patchTask(data, 'failed', true);
      }),
      window.electronAPI.onDownloadStopped((data) => {
        patchTask(data, 'stopped', true);
      }),
      window.electronAPI.onDownloadQueueChanged(() => {
        fullRefresh = queueDirty = seriesDirty = true;
        schedule();
      }),
      window.electronAPI.onMergeTaskAdded(() => loadMergeTasks()),
      window.electronAPI.onMergeProgress((data) => {
        setMergeTasks((prev) =>
          prev.map((t) => (t.id === data.id ? { ...t, ...data } : t))
        );
      }),
      window.electronAPI.onMergeCompleted((data) => {
        loadMergeTasks();
        showToast(data.storageWarning || ('Gộp hoàn tất: ' + (data.path ? data.path.split(/[\\/]/).pop() : '')), data.storageWarning ? 'error' : 'success');
      }),
      window.electronAPI.onMergeFailed((data) => {
        loadMergeTasks();
        showToast('Gộp thất bại: ' + (data.error || 'Lỗi không xác định'), 'error');
      }),
    ];
    const timer = setInterval(() => {
      loadQueue();
      refresh();
      loadSeriesList();
      loadMergeTasks();
    }, 15000);
    return () => {
      cleanups.forEach(cleanup => cleanup());
      clearInterval(timer);
      clearTimeout(batchTimer);
      for (const key of Object.keys(requests.current)) requests.current[key]++;
    };
  }, [active, refresh, loadQueue, loadSeriesList, loadMergeTasks, showToast]);

  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(tasks.map((task) => task.id)));
  const allSelected = tasks.length > 0 && tasks.every((task) => selected.has(task.id));

  const fmtSize = (b) => {
    if (!b || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  };

  /** Hiện xác nhận xóa: mặc định chỉ xóa bản ghi, có thể tick xóa luôn file cục bộ */
  const askDelete = (list, label) => {
    const items = (list || []).filter(Boolean);
    if (!items.length) return;
    // Dùng số byte đã tải để ước lượng dung lượng giải phóng (chỉ có ý nghĩa với task hoàn thành)
    const estBytes = items.reduce((s, t) => s + (t.totalBytes || t.receivedBytes || 0), 0);
    const withFile = items.filter((t) => t.status === 'completed').length;
    setConfirmAsk({
      title: label,
      count: items.length,
      withFile,
      estBytes,
      onOk: async (deleteFiles) => {
        try {
          const ids = items.map((t) => t.id);
          const res = await window.electronAPI.deleteTasksWithFiles(ids, deleteFiles);
          await Promise.all([refresh(), loadSeriesList()]);
          if (!res?.success) throw new Error(res?.error || 'Xóa thất bại, vui lòng thử lại');
          showToast(deleteFiles
            ? `Đã xóa ${res.count} tác vụ, giải phóng ${fmtSize(res.freed)}`
            : `Đã xóa ${res.count} bản ghi tác vụ (file cục bộ giữ lại)`);
        } catch (error) { showToast(error.message || 'Xóa thất bại, vui lòng thử lại', 'error'); }
      },
    });
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    askDelete(tasks.filter((t) => selected.has(t.id)), 'Xóa tác vụ đã chọn');
  };
  const retrySelected = async () => {
    if (selected.size === 0) return;
    const res = await window.electronAPI.retryTasks(Array.from(selected));
    setSelected(new Set());
    await refresh();
    if (res && res.success) {
      showToast(res.count > 0 ? `Đã thêm lại vào hàng đợi: ${res.count} mục` : 'Không có mục nào có thể thử lại');
    } else {
      showToast((res && res.error) || 'Thử lại thất bại', 'error');
    }
  };

  // Gộp một phim đã chọn
  const doMerge = async (compatible) => {
    if (!mergeSeriesId) {
      showToast('Vui lòng chọn phim cần gộp trước', 'error');
      return;
    }
    setMergeAsk(false);
    setMerging(true);
    try {
      const res = await window.electronAPI.mergeSeries(mergeSeriesId, '', { compatible });
      if (!res || !res.success) {
        showToast((res && res.error) || 'Gộp thất bại', 'error');
        return;
      }
      await loadMergeTasks();
      const sizeGb = (res.totalBytes / 1073741824).toFixed(2);
      const duration = res.totalDuration > 0 ? ` / ${fmtElapsed(res.totalDuration)}` : ' / đang dò thời lượng';
      showToast(compatible
        ? `Bắt đầu gộp định dạng tương thích ${res.count} tập (H.264, mất nhiều thời gian)`
        : `Bắt đầu gộp ${res.count} tập (khoảng ${sizeGb} GB${duration})`);
      if (res.codecWarning) showToast(res.codecWarning, 'error');
    } catch (e) {
      showToast('Lỗi gộp: ' + e.message, 'error');
    } finally {
      setMerging(false);
    }
  };

  const cancelMerge = async (id) => {
    try {
      const result = await window.electronAPI.cancelMerge(id);
      if (!result?.success) throw new Error(result?.error || 'Yêu cầu hủy thất bại, vui lòng thử lại');
      showToast('Đã gửi yêu cầu hủy, đang chờ tác vụ gộp dừng lại.');
      await loadMergeTasks();
    } catch (error) { showToast(error.message || 'Yêu cầu hủy thất bại, vui lòng thử lại', 'error'); }
  };

  const openMergedFile = async (path) => {
    if (!path) return;
    await window.electronAPI.showInFolder(path);
  };

  // Tạm dừng tất cả: hủy tác vụ đang chạy + xóa hàng đợi chờ
  const pauseAll = async () => {
    const res = await window.electronAPI.pauseAll();
    await refresh();
    await loadQueue();
    showToast(res && res.success ? `Đã tạm dừng ${res.count} tác vụ` : 'Tạm dừng thất bại', res && res.success ? 'success' : 'error');
  };

  // Bắt đầu tất cả: đưa các tác vụ đã dừng / thất bại / đang chờ vào hàng đợi chạy lại
  const resumeAll = async () => {
    const res = await window.electronAPI.resumeAll();
    await refresh();
    await loadQueue();
    showToast(res && res.success ? `Đã khởi động ${res.count} tác vụ` : 'Khởi động thất bại', res && res.success ? 'success' : 'error');
  };

  // Thử lại các tác vụ thất bại / đã dừng
  const retryAllFailed = async () => {
    const ids = tasks.filter(needsManualRetry).map((t) => t.id);
    if (ids.length === 0) return;
    const res = await window.electronAPI.retryTasks(ids);
    await refresh();
    if (res && res.success) {
      showToast(`Đã thêm lại vào hàng đợi: ${res.count} mục`);
    } else {
      showToast((res && res.error) || 'Thử lại thất bại', 'error');
    }
  };

  // Chọn nhanh tất cả tác vụ thất bại / đã dừng (chọn xong có thể bấm "Thử lại mục đã chọn")
  const selectAllFailed = () => {
    const ids = tasks.filter(needsManualRetry).map((t) => t.id);
    if (ids.length === 0) {
      showToast('Không có tác vụ thất bại hoặc đã dừng');
      return;
    }
    setSelected(new Set(ids));
    showToast(`Đã chọn ${ids.length} mục, có thể bấm "Thử lại mục đã chọn" để tải lại`);
  };

  const clearCompleted = async () => {
    const done = tasks.filter((t) => t.status === 'completed');
    if (done.length === 0) return;
    askDelete(done, 'Xóa tác vụ đã hoàn thành');
  };

  // Cập nhật tiến độ làm thay đổi giá trị dòng, không thay đổi thứ tự series/tập đã thiết lập.
  const sortedIds = useMemo(() => sortTasks(tasks).map(task => task.id), [orderVersion]);
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  taskIndex.current = taskById;
  const pageCount = Math.max(1, Math.ceil(sortedIds.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleTasks = sortedIds.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(id => taskById.get(id)).filter(Boolean);

  const activeCount = tasks.filter((t) => t.status === 'downloading' || t.status === 'pending').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const retryingCount = tasks.filter(isWaitingRetry).length;
  const failedTasks = useMemo(
    () => tasks.filter(needsManualRetry),
    [tasks]
  );
  const failedCount = failedTasks.length;

  // Tác vụ có thể tạm dừng: đang tải, đang chờ, đã dừng (chưa chạy xong đều tính)
  const pausableCount = useMemo(
    () => tasks.filter((t) => t.status !== 'completed').length,
    [tasks]
  );

  // Số mục thực sự có thể thử lại trong mục đã chọn
  const retryableSelectedCount = useMemo(
    () =>
      Array.from(selected).filter((id) => {
        const t = taskById.get(id);
        return t && (t.status === 'failed' || t.status === 'stopped');
      }).length,
    [selected, taskById]
  );

  useDialogKeyboard(active && !!(confirmAsk || mergeAsk), () => { setConfirmAsk(null); setMergeAsk(false); }, '.dm-container .player-confirm');

  return (
    <div className="dm-container">
      <div className="dm-header">
        <div className="dm-title">
          <h2>Quản lý tải xuống</h2>
        </div>
        <div className="dm-stats">
          <span className="stat stat-active">Đang chạy {activeCount}</span>
          {retryingCount > 0 && <span className="stat stat-active">Chờ thử lại {retryingCount}</span>}
          <span className="stat stat-done">Hoàn thành {completedCount}</span>
          <span className="stat stat-fail">Thất bại/Dừng {failedCount}</span>
        </div>
      </div>

      <div className="dm-usage-notice" role="note" aria-label="Cảnh báo và khuyến nghị sử dụng">
        <p><strong>Lỗi tạm thời sẽ tự động thử lại.</strong>Khi tải nguồn Hồng Quả gặp mất mạng, quá thời gian hoặc truyền không đầy đủ, sẽ thử lại tối đa 3 lần, chờ lần lượt 10, 30, 60 giây; khi nguồn tạm không khả dụng sẽ chờ 3, 8, 15 phút. Trong thời gian chờ có thể dừng hoặc thử lại ngay. Giới hạn quyền, lỗi ổ đĩa cần xử lý thủ công; tác vụ vẫn thất bại sau khi thử lại sẽ được giữ lại.</p>
        <p>Phần mềm này dành cho mục đích học tập/nghiên cứu, đề nghị tự xóa trong vòng 24 giờ sau khi dùng thử; vui lòng không mạo danh chính thức hoặc thu phí với danh nghĩa ủy quyền giả. Quyền và nghĩa vụ mã nguồn mở theo GPLv3. Các khuyến nghị trên không đại diện cho việc được nền tảng hoặc chủ bản quyền cấp phép, cũng không cấu thành cam kết miễn trừ trách nhiệm.</p>
      </div>

      <div className="dm-toolbar">
        <button
          className="btn btn-primary"
          onClick={resumeAll}
          disabled={queue.active > 0 || pausableCount === 0}
          title="Đưa toàn bộ tác vụ đang chờ / đã dừng / thất bại vào hàng đợi chạy lại"
        >
          <Play size={15} />
          Bắt đầu tất cả
        </button>
        <button
          className="btn btn-outline"
          onClick={pauseAll}
          disabled={pausableCount === 0}
          title="Tạm dừng tất cả: hủy các tác vụ đang tải và xóa hàng đợi chờ"
        >
          <Pause size={15} />
          Tạm dừng tất cả
        </button>
        <button
          className="btn btn-outline"
          onClick={retryAllFailed}
          disabled={failedCount === 0}
          title="Đưa toàn bộ tác vụ thất bại / đã dừng vào hàng đợi tải lại một lần"
        >
          <Zap size={15} />
          {failedCount > 0 ? `Thử lại thất bại (${failedCount})` : 'Thử lại thất bại'}
        </button>
        <details className="dm-more-actions"><summary>Thao tác khác</summary><div className="dm-more-menu">
        <button
          className="btn btn-outline"
          onClick={selectAllFailed}
          disabled={failedCount === 0}
          title="Chọn nhanh toàn bộ tác vụ thất bại / đã dừng"
        >
          <CheckSquare size={15} />
          {failedCount > 0 ? `Chọn mục thất bại (${failedCount})` : 'Chọn mục thất bại'}
        </button>
        <button className="btn btn-outline" onClick={retrySelected} disabled={retryableSelectedCount === 0}>
          <RefreshCw size={15} />
          Thử lại mục đã chọn ({retryableSelectedCount})
        </button>
        <button className="btn btn-outline" onClick={clearCompleted} disabled={completedCount === 0}>
          <X size={15} />
          Xóa mục hoàn thành
        </button>
        <button className="btn btn-outline" onClick={clearSelection} disabled={selected.size === 0}>
          Bỏ chọn
        </button>
        <button
          className="btn btn-outline"
          onClick={async () => {
            const r = await window.electronAPI.rescanDownloads();
            await refresh();
            showToast(r && r.success
              ? (r.count > 0 ? `Đã khôi phục ${r.count} bản ghi tải từ ổ đĩa` : 'Không phát hiện file chưa đăng ký')
              : 'Quét thất bại');
          }}
          title="Quét thư mục tải xuống, đăng ký lại các file có trên ổ đĩa nhưng chưa có trong danh sách"
        >
          <RefreshCw size={15} />
          Quét thư mục tải xuống
        </button>
        </div></details>
        {seriesList.length > 0 && (
          <div className="merge-inline">
            <select
              className="input-field merge-select"
              value={mergeSeriesId}
              onChange={(e) => setMergeSeriesId(e.target.value)}
              title="Chọn phim cần gộp"
            >
              {seriesList.map((s) => (
                <option key={s.series_id} value={String(s.series_id)}>
                  {s.series_title}
                </option>
              ))}
            </select>
            <button className="btn btn-outline" onClick={() => setMergeAsk(true)} disabled={merging} title="Gộp các tập đã tải của phim thành một mp4">
              <Layers size={15} />
              {merging ? 'Đang gộp...' : 'Gộp cả bộ phim'}
            </button>
          </div>
        )}
        {onNavigate && (
          <button className="btn btn-primary dm-toolbar-end" onClick={() => onNavigate('download')}>
            <Film size={15} />
            Thêm tải xuống
          </button>
        )}
      </div>

      {seriesList.length > 0 && <p className="settings-hint dm-merge-hint">Chọn tên phim rồi bấm "Gộp cả bộ phim" để xuất toàn bộ tập đã tải, không cần tick chọn tác vụ.</p>}

      {/* Tác vụ gộp */}
      {mergeTasks.length > 0 && (
        <div className="merge-list">
          {mergeTasks.map((m) => (
            <div key={m.id} className={`merge-card merge-${m.status}`}>
              <Layers size={16} />
              <div className="merge-body">
                <div className="merge-title">
                  Gộp《{m.seriesTitle}》· {m.done || 0}/{m.total} tập
                </div>
                <div className="merge-sub">
                  {m.status === 'running' && <>{m.stageText || 'Đang gộp'}{m.method && m.method !== m.stageText ? ` · ${m.method}` : ''}</>}
                  {m.status === 'completed' && (
                    <>
                      Hoàn thành · {m.outputName}
                      {m.outputBytes ? ` · ${fmtBytes(m.outputBytes)}` : ''}
                    </>
                  )}
                  {m.status === 'failed' && <>Thất bại: {m.error}</>}
                  {m.status === 'stopped' && <>{m.error || 'Đã hủy'}</>}
                </div>
                <div className="merge-metrics">
                  <span>{m.stage === 'checking' ? `Đã kiểm tra ${m.checked || 0}` : `Đã xử lý ${m.done || 0}`} / {m.total} tập</span>
                  <span>Đã dùng {fmtElapsed(m.status === 'running' ? (Date.now() - m.startTime) / 1000 : m.elapsedSeconds || ((m.endTime || m.startTime) - m.startTime) / 1000)}</span>
                  {m.status === 'running' && m.speed > 0 && <span>{m.speed.toFixed(1)}x tốc độ</span>}
                  {m.status === 'running' && Number.isFinite(m.etaSeconds) && <span>Còn khoảng {fmtElapsed(m.etaSeconds)}</span>}
                </div>
                {(m.codecWarning || m.storageWarning || m.cleanupWarning) && <div className="merge-note">{m.storageWarning || m.cleanupWarning || m.codecWarning}</div>}
                {(m.status === 'running') && (
                  <div className="dm-progress">
                    <div className="dm-progress-bar" role="progressbar" aria-label="Tiến độ gộp" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.progress || 0}>
                      <div className="dm-progress-fill" style={{ width: `${m.progress || 0}%` }} />
                    </div>
                    <span className="dm-pct">{m.progress || 0}%</span>
                  </div>
                )}
              </div>
              <div className="merge-actions">
                {m.status === 'running' && (
                  <button className="icon-btn" title="Hủy gộp" onClick={() => cancelMerge(m.id)}>
                    <X size={16} />
                  </button>
                )}
                {m.status === 'completed' && (
                  <button className="icon-btn" title="Mở thư mục chứa" onClick={() => openMergedFile(m.output)}>
                    <Folder size={16} />
                  </button>
                )}
                {m.status !== 'running' && (
                  <button
                    className="icon-btn icon-btn-danger"
                    title="Xóa bản ghi"
                    onClick={async () => {
                      try {
                        const result = await window.electronAPI.deleteMergeTask(m.id);
                        if (!result?.success) throw new Error(result?.error || 'Xóa bản ghi thất bại');
                        await loadMergeTasks();
                      } catch (error) { showToast(error.message || 'Xóa bản ghi thất bại, vui lòng thử lại', 'error'); }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {queue.active > 0 && (
        <div className="dm-queue-bar">
          <span className="dm-queue-running">
            <span className="dm-queue-pulse" />
            Đang tải song song <b>{queue.active}</b> / {queue.maxConcurrent}
            {queue.queued > 0 ? <> · Đang chờ <b>{queue.queued}</b></> : null}
          </span>
          <span className="dm-queue-hint">
            Số lượng tải song song có thể chỉnh trong "Cài đặt → Số lượng tải đồng thời tối đa"
          </span>
        </div>
      )}

      {retryableSelectedCount > 0 && (
        <div className="dm-hint">
          Đã chọn <b>{retryableSelectedCount}</b> mục thất bại, bấm
          <b>"Thử lại mục đã chọn"</b> để tải lại (không cần phân tích lại).
        </div>
      )}

      {loadError && <div className="alert alert-error" role="alert">{loadError}<button className="btn btn-outline btn-sm" onClick={refresh}>Tải lại</button></div>}
      {tasks.length > 0 && <div className="dm-pagination">
        <div className="dm-selection-summary">
          <button className="btn btn-outline btn-sm" onClick={allSelected ? clearSelection : selectAll}
            title={allSelected ? 'Bỏ chọn tất cả các trang' : `Chọn toàn bộ ${tasks.length} mục, gồm cả trang khác`}>
            <CheckSquare size={15} />{allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={deleteSelected} disabled={selected.size === 0}
            title="Xóa các tác vụ đã chọn trên mọi trang, khi xác nhận có thể chọn xóa kèm file cục bộ">
            <Trash2 size={15} />Xóa mục đã chọn ({selected.size} mục)
          </button>
        <span>Tổng {tasks.length} mục · Trang này {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, tasks.length)} mục{selected.size > 0 ? ` · Đã chọn ${selected.size} mục (giữ qua trang)` : ''}</span>
        </div>
        <nav aria-label="Phân trang tác vụ tải">
          <button className="btn btn-outline btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trang trước</button>
          <span>Trang {currentPage} / {pageCount}</span>
          <button className="btn btn-outline btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Trang sau</button>
        </nav>
      </div>}

      {tasks.length === 0 ? (
        <div className="dm-empty">
          <Download size={40} />
          <p>Chưa có tác vụ tải nào</p>
          <p className="dm-empty-sub">Tìm tên phim hoặc dán link chia sẻ, chọn tập muốn lưu.</p>
          {onNavigate && <button className="btn btn-primary" onClick={() => onNavigate('download')}>Thêm phim ngắn đầu tiên</button>}
        </div>
      ) : (
        <div className="dm-list">
          {visibleTasks.map((task) => {

            const isSel = selected.has(task.id);
            const waitingRetry = isWaitingRetry(task);
            const canStop = task.status === 'downloading' || task.status === 'pending' || waitingRetry;
            const canRetry = task.status === 'failed' || task.status === 'stopped';
            const pct = task.progress || 0;
            return (
              <div key={task.id} className={`dm-task ${isSel ? 'selected' : ''}`} onClick={() => toggleSelect(task.id)}>
                <input className="dm-task-select" type="checkbox" aria-label={`Chọn ${task.title || task.filename}`} checked={isSel} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelect(task.id)} />
                <div className="dm-task-cover">
                  {task.videoInfo && task.videoInfo.cover ? (
                    <img src={task.videoInfo.cover} alt="" />
                  ) : (
                    <div className="cover-placeholder"><Film size={18} /></div>
                  )}
                </div>
                <div className="dm-task-body">
                  <div className="dm-task-title">{task.title || task.filename}</div>
                  <div className="dm-task-meta">
                    <span className={`status-tag status-${waitingRetry ? 'pending' : task.status}`}>{waitingRetry ? 'Chờ thử lại' : STATUS_TEXT[task.status] || task.status}</span>
                    {waitingRetry && <span className="dm-size">Tự động thử lại {task.sourceRetries}/3 · xếp hàng sau {new Date(task.retryAt).toLocaleTimeString('vi-VN', { hour12: false })}</span>}
                    {task.status === 'downloading' && task.totalBytes > 0 && (
                      <span className="dm-size">{fmtBytes(task.receivedBytes)} / {fmtBytes(task.totalBytes)}</span>
                    )}
                    {task.status === 'failed' && task.error && <span className="dm-error">{task.error}</span>}
                  </div>
                  {(task.status === 'downloading' || task.status === 'pending') && (
                    <div className="dm-progress">
                      <div className="dm-progress-bar">
                        <div className="dm-progress-fill" style={{ width: pct + '%' }}></div>
                      </div>
                      <span className="dm-pct">{pct}%</span>
                    </div>
                  )}
                </div>
                <div className="dm-task-actions" onClick={(e) => e.stopPropagation()}>
                  {canStop && (
                    <button className="icon-btn" title={waitingRetry ? 'Dừng tự động thử lại' : 'Dừng'} onClick={async () => {
                      try {
                        const result = await window.electronAPI.stopDownload(task.id);
                        if (!result?.success) throw new Error(result?.error || 'Dừng thất bại');
                        await refresh();
                      } catch (error) { showToast(error.message || 'Dừng thất bại', 'error'); }
                    }}>
                      <Square size={16} />
                    </button>
                  )}
                  {canRetry && (
                    <button className="icon-btn" title={waitingRetry ? 'Thử lại ngay' : 'Thử lại'} onClick={async () => {
                      try {
                        const result = await window.electronAPI.retryTask(task.id);
                        if (!result?.success) throw new Error(result?.error || 'Thử lại thất bại');
                      } catch (error) { showToast(error.message || 'Thử lại thất bại', 'error'); }
                    }}>
                      <RefreshCw size={16} />
                    </button>
                  )}
                  <button className="icon-btn" title="Mở thư mục" onClick={() => window.electronAPI.openFolder(task.id)}>
                    <Folder size={16} />
                  </button>
                  <button
                    className="icon-btn icon-btn-danger"
                    title="Xóa tác vụ (có thể chọn xóa kèm file cục bộ)"
                    onClick={() => {
                      askDelete([task], `Xóa tác vụ《${task.hongguoInfo && task.hongguoInfo.series_title ? task.hongguoInfo.series_title : ''}》tập ${task.hongguoInfo ? task.hongguoInfo.vid_index : ''}`);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className={`dm-toast dm-toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}

      {/* Chọn định dạng gộp */}
      {mergeAsk && (
        <div className="player-confirm-mask" onClick={() => setMergeAsk(false)}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : 'Gộp xuất'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title" style={{ color: 'var(--accent)' }}>
              <Layers size={17} />
              Gộp cả bộ phim
            </div>
            <div className="player-confirm-msg">
              <p>Gộp toàn bộ tập đã tải của《{seriesList.find((series) => String(series.series_id) === mergeSeriesId)?.series_title || 'phim đã chọn'}》thành một mp4. Các tập chưa tải sẽ không được bổ sung tự động.</p>
              <p><b>Gộp nhanh thông minh</b>: định dạng giống nhau gộp không mất dữ liệu; khác nhau chỉ xử lý âm thanh/hình ảnh cần thiết, thời gian phụ thuộc tổng độ dài.</p>
              <p><b>Gộp tương thích</b>: xuất H.264/AAC, các tập đã tương thích không cần chuyển đổi lại. Cả hai cách đều giữ file gốc.</p>
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setMergeAsk(false)}>Hủy</button>
              <button className="btn btn-outline" onClick={() => doMerge(true)} disabled={merging}>
                Gộp tương thích (H.264)
              </button>
              <button className="btn btn-primary" onClick={() => doMerge(false)} disabled={merging}>
                Gộp nhanh thông minh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Xác nhận xóa (có thể chọn xóa kèm file cục bộ) */}
      {confirmAsk && (
        <div className="player-confirm-mask" onClick={() => setConfirmAsk(null)}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : 'Gộp xuất'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title">
              <Trash2 size={17} />
              {confirmAsk.title}
            </div>
            <div className="player-confirm-msg">
              <p>Tổng {confirmAsk.count} tác vụ, trong đó {confirmAsk.withFile} tác vụ đã tải xong
                {confirmAsk.estBytes > 0 ? ` (khoảng ${fmtSize(confirmAsk.estBytes)})` : ''}.</p>
              <label className="dm-confirm-check">
                <input
                  type="checkbox"
                  checked={!!confirmAsk._del}
                  onChange={(e) => setConfirmAsk({ ...confirmAsk, _del: e.target.checked })}
                />
                <span>
                  Xóa luôn file cục bộ
                  {confirmAsk.estBytes > 0 ? ` (giải phóng khoảng ${fmtSize(confirmAsk.estBytes)})` : ''}
                </span>
              </label>
              <p className="dm-confirm-hint">
                Không tick thì chỉ xóa bản ghi tác vụ, file video trên ổ đĩa sẽ được giữ lại (có thể tự quản lý trong trình quản lý file).
              </p>
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setConfirmAsk(null)}>Hủy</button>
              <button
                className={`btn ${confirmAsk._del ? 'btn-danger-solid' : 'btn-primary'}`}
                onClick={async () => {
                  const fn = confirmAsk.onOk;
                  const del = !!confirmAsk._del;
                  setConfirmAsk(null);
                  await fn(del);
                }}
              >
                {confirmAsk._del ? 'Xóa tác vụ và file' : 'Chỉ xóa bản ghi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DownloadManager;
