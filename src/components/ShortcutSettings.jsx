import React, { useEffect, useRef, useState } from 'react';
import { SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, formatShortcut, readShortcuts, saveShortcuts, shortcutKey, subscribeShortcuts, validateShortcuts } from '../shortcuts';

export default function ShortcutSettings({ active = true }) {
  const capturedKey = useRef(null);
  const [bindings, setBindings] = useState(readShortcuts);
  const [recording, setRecording] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => subscribeShortcuts(setBindings), []);
  useEffect(() => { if (!active) setRecording(null); }, [active]);

  const save = next => {
    try {
      saveShortcuts(next);
      setBindings(next);
      setRecording(null);
      setError('');
      setMessage('Đã lưu phím tắt, có hiệu lực ngay');
    } catch (failure) {
      setError(failure.message || 'Không thể lưu, vui lòng thử lại');
    }
  };
  const record = (event, action) => {
    if (recording !== action.id || event.repeat || event.isComposing) return;
    // Giữ nguyên tổ hợp của OS/trình duyệt; chỉ bắt các phím thuộc quyền trình phát.
    if (event.metaKey || event.ctrlKey || event.altKey) { setError('Tổ hợp Cmd, Ctrl, Alt được giữ cho hệ thống, vui lòng dùng phím đơn hoặc tổ hợp Shift'); return; }
    if (event.key === 'Tab') { setRecording(null); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRecording(null); setError(''); return; }
    if (event.key === 'Shift') return;
    const key = shortcutKey(event);
    if (!key) { if (event.key === 'Enter') event.preventDefault(); setError('Vui lòng chọn chữ cái, số, phím mũi tên hoặc dấu cách; có thể thêm Shift (Shift + dấu cách được giữ cho bộ gõ)'); return; }
    event.preventDefault(); event.stopPropagation();
    capturedKey.current = event.code || event.key;
    const next = { ...readShortcuts(), [action.id]: key };
    const conflict = validateShortcuts(next);
    if (conflict) { setError(conflict); return; }
    save(next);
  };

  return <section className="shortcut-settings settings-card" data-shortcut-settings aria-labelledby="shortcut-settings-title">
    <div className="shortcut-settings-heading">
      <h2 id="shortcut-settings-title">Phím tắt phát</h2>
      <button type="button" className="btn btn-outline" onClick={() => save({ ...DEFAULT_SHORTCUTS })}>Khôi phục mặc định</button>
    </div>
    <p className="settings-hint" id="shortcut-settings-help">Nhấp vào phím để ghi. Hỗ trợ phím đơn hoặc tổ hợp Shift; Esc để hủy. Chỉ có hiệu lực ở trang phát, không phản hồi khi đang nhập văn bản.</p>
    <div className="shortcut-settings-list">
      {SHORTCUT_ACTIONS.map(action => <div className="shortcut-settings-row" key={action.id}>
        <span id={`shortcut-label-${action.id}`}>{action.label}</span>
        <button type="button" className={`btn btn-outline shortcut-record ${recording === action.id ? 'is-recording' : ''}`}
          aria-label={`${action.label}: ${formatShortcut(bindings[action.id])}, nhấp để thay đổi`}
          aria-describedby="shortcut-settings-help" aria-pressed={recording === action.id}
          onClick={() => { setRecording(recording === action.id ? null : action.id); setError(''); setMessage(''); }}
          onKeyDown={event => record(event, action)} onKeyUp={event => { if (capturedKey.current === (event.code || event.key)) { event.preventDefault(); capturedKey.current = null; } }}
          onBlur={() => { capturedKey.current = null; if (recording === action.id) setRecording(null); }}>
          {recording === action.id ? 'Nhấn phím mới…' : formatShortcut(bindings[action.id])}
        </button>
      </div>)}
    </div>
    {error && <p className="settings-hint shortcut-error" role="alert">{error}</p>}
    <p className="settings-hint" role="status" aria-live="polite">{recording ? `Đang thay đổi「${SHORTCUT_ACTIONS.find(action => action.id === recording)?.label}」` : message}</p>
  </section>;
}
