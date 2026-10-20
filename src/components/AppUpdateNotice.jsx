import React, { useEffect, useRef, useState } from 'react';
import { X } from './icons';
import './AppUpdateNotice.css';

export default function AppUpdateNotice() {
  const [release, setRelease] = useState(null);
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState({ supported: false, reason: 'Đang đọc cách cập nhật…', status: 'idle', percent: 0 });
  const currentState = useRef(state);
  const enabled = useRef(true);
  const actionPending = useRef(false);
  const checkPending = useRef(false);
  const requestedManually = useRef(false);
  const dismissed = useRef(new Set());
  const checkNow = useRef(null);
  const closedAt = useRef(0);

  useEffect(() => {
    let generation = 0, stateRevision = 0, active = true;
    checkPending.current = false;
    const receiveState = next => {
      if (!active || !next) return;
      stateRevision++;
      currentState.current = next;
      setState(next);
    };
    const check = async (manual = false) => {
      if (manual) { requestedManually.current = true; setVisible(true); setError(''); dismissed.current.clear(); }
      if (checkPending.current || ['checking', 'downloading', 'downloaded', 'installing'].includes(currentState.current.status)) return;
      checkPending.current = true;
      requestedManually.current = manual;
      const request = ++generation;
      const closure = closedAt.current;
      setChecking(true);
      try {
        const result = await window.electronAPI.checkAppUpdate();
        if (!active || request !== generation) return;
        enabled.current = result?.enabled === true;
        if (!enabled.current) {
          setRelease(null);
          if (requestedManually.current) setError('Kiểm tra cập nhật đã tắt, vui lòng bật và lưu trong cài đặt rồi thử lại.');
          else setVisible(false);
          return;
        }
        if (result.error) {
          setRelease(null);
          setError(result.error);
          return;
        }
        setError('');
        setRelease(result.release || null);
        if (result.release) {
          if (closure !== closedAt.current) dismissed.current.add(result.release.version);
          else if (!dismissed.current.has(result.release.version)) setVisible(true);
        }
      } catch {
        if (active && request === generation) { setRelease(null); setError('Kiểm tra cập nhật thất bại, vui lòng kiểm tra kết nối mạng rồi thử lại.'); }
      } finally {
        if (active && request === generation) { checkPending.current = false; setChecking(false); }
      }
    };
    checkNow.current = check;
    const manualCheck = () => check(true);
    window.addEventListener('hongguo-check-app-update', manualCheck);
    const unsubscribeState = window.electronAPI.onAppUpdateState(receiveState);
    const unsubscribePreference = window.electronAPI.onAppUpdatePreference(value => {
      generation++;
      checkPending.current = false;
      setChecking(false);
      enabled.current = value;
      if (value) check();
      else { setVisible(false); setError(''); }
    });
    const revision = stateRevision;
    window.electronAPI.getAppUpdateState().then(next => {
      if (revision === stateRevision) receiveState(next);
    }).catch(() => {
      if (revision === stateRevision) receiveState({ supported: false, reason: 'Không thể đọc trạng thái cập nhật trong ứng dụng, có thể tải thủ công từ GitHub.', status: 'idle', percent: 0 });
    });
    check();
    const timer = setInterval(() => check(), 6 * 60 * 60 * 1000);
    return () => {
      active = false;
      generation++;
      checkNow.current = null;
      clearInterval(timer);
      window.removeEventListener('hongguo-check-app-update', manualCheck);
      unsubscribeState();
      unsubscribePreference();
    };
  }, []);

  const close = () => {
    closedAt.current++;
    if (release) dismissed.current.add(release.version);
    setVisible(false);
    setError('');
  };
  const act = async kind => {
    if (!enabled.current || actionPending.current || checkPending.current || ['checking', 'downloading', 'installing'].includes(currentState.current.status)) return;
    actionPending.current = true;
    setPending(true);
    setError('');
    try {
      const result = await window.electronAPI[kind]();
      if (result?.state) { currentState.current = result.state; setState(result.state); }
      if (!result?.success && enabled.current) setError(result?.error || 'Thao tác cập nhật thất bại, vui lòng thử lại sau.');
    } catch {
      if (enabled.current) setError('Thao tác cập nhật thất bại, vui lòng kiểm tra kết nối mạng rồi thử lại.');
    } finally { actionPending.current = false; setPending(false); }
  };

  if (!visible) return null;
  const downloading = state.status === 'downloading';
  const downloaded = state.status === 'downloaded';
  const installing = state.status === 'installing';
  const busy = pending || checking || downloading || installing || state.status === 'checking';
  const version = (downloading || downloaded || installing || state.status === 'error') ? state.version || release?.version : release?.version;
  const updateError = error || state.error;
  const percent = Math.max(0, Math.min(100, Math.round(state.percent || 0)));
  const title = checking ? 'Đang kiểm tra cập nhật…' : installing ? 'Đang khởi động lại để cài đặt…' : downloaded ? `Bản mới v${version} đã tải xong` : downloading ? `Đang tải v${version}` : version ? `Phát hiện phiên bản mới v${version}` : 'Kiểm tra cập nhật';
  return <section className="app-update-notice" role="dialog" aria-label="Cập nhật phần mềm" aria-describedby="app-update-description" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <button type="button" className="icon-btn app-update-close" aria-label="Đóng thông báo cập nhật" title="Đóng thông báo cập nhật" onClick={close}><X size={18} /></button>
    <h2 aria-live="polite">{title}</h2>
    <p id="app-update-description">{checking ? 'Đang truy vấn bản chính thức mới, vui lòng chờ.' : installing ? 'Ứng dụng sẽ sớm thoát và cài đặt bản mới.' : downloaded ? 'Nhấp để thoát ứng dụng và cài đặt bản mới. Vui lòng hoàn tất tải, gộp hoặc chuyển mã video trước; có thể tìm lại thông báo này trong cài đặt sau.' : downloading ? 'Đóng thông báo để tiếp tục tải. Tải xong sẽ không tự động cài đặt, có thể tìm lại tiến độ trong cài đặt.' : version ? (state.supported ? 'Tải bản mới ngay trong ứng dụng, sau khi xong bạn quyết định khi nào khởi động lại để cài đặt. Đóng thông báo để tiếp tục dùng phiên bản hiện tại.' : state.reason) : updateError ? 'Có thể kiểm tra lại sau.' : 'Đã là phiên bản mới nhất.'}</p>
    {downloading && <div className="app-update-progress"><progress max="100" value={percent} aria-label="Tiến độ tải cập nhật" /><span>{percent}%</span></div>}
    <div className="app-update-actions">
    {(version || downloaded) && <button type="button" className="btn btn-primary" disabled={busy || !enabled.current} onClick={() => act(downloaded ? 'installAppUpdate' : state.supported ? 'downloadAppUpdate' : 'openAppUpdate')}>
      {installing ? 'Đang khởi động lại…' : downloading ? 'Đang tải…' : pending ? 'Vui lòng chờ…' : downloaded ? 'Khởi động lại và cài đặt' : state.supported ? 'Tải cập nhật' : 'Tải từ GitHub'}
    </button>}
    {(!version || updateError) && !busy && <button type="button" className="btn btn-outline" onClick={() => checkNow.current?.(true)}>Kiểm tra lại</button>}
    {updateError && state.supported && (version || state.version) && <button type="button" className="btn btn-outline" disabled={busy || !enabled.current} onClick={() => act('openAppUpdate')}>Tải thủ công từ trang phát hành</button>}
    </div>
    {updateError && <p role="alert">{updateError}</p>}
  </section>;
}
