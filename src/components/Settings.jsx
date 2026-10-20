import React, { useState, useEffect, useRef } from 'react';
import useDialogKeyboard from './useDialogKeyboard';
import './Settings.css';
import AppearanceSettings from './AppearanceSettings';
import ShortcutSettings from './ShortcutSettings';
import CustomSources from './CustomSources';
import { Settings, Folder, Check, Globe, X, RefreshCw, AlertCircle } from './icons';


const FORMAT_PRESETS = [
  { label: 'Tên phim_Tập N', value: '剧名 集数' },
  { label: 'Tên phim_Tập N_Tiêu đề', value: '剧名 集数 标题' },
];

const PROXY_MODES = [
  { value: 'system', label: 'Theo hệ thống', desc: 'Dùng cài đặt proxy có sẵn trong hệ thống / biến môi trường' },
  { value: 'custom', label: 'Chỉ định thủ công', desc: 'Tự điền địa chỉ và cổng proxy (hỗ trợ proxy HTTP/HTTPS)' },
  { value: 'direct', label: 'Buộc kết nối trực tiếp', desc: 'Bỏ qua mọi proxy, kết nối trực tiếp' },
];

// Cổng mặc định của các phần mềm proxy phổ biến, tiện điền nhanh
const PORT_PRESETS = [
  { label: 'Clash / Mihomo', port: 7890 },
  { label: 'V2rayN', port: 10809 },
  { label: 'Shadowsocks', port: 1080 },
  { label: 'Burp / Bắt gói', port: 8080 },
];

/** Cài đặt đã lưu -> mô tả proxy đang có hiệu lực */
function describeProxy(settings) {
  if (!settings || settings.proxy_enabled !== true) {
    return { on: false, text: 'Chưa bật (tất cả request kết nối trực tiếp)' };
  }
  const mode = settings.proxy_mode || 'system';
  if (mode === 'direct') {
    return { on: false, text: 'Đã bật nhưng chế độ là "Buộc kết nối trực tiếp"' };
  }
  if (mode === 'custom') {
    const host = (settings.proxy_host || '').trim();
    const port = (settings.proxy_port || '').toString().trim();
    if (!host) return { on: false, text: 'Đã bật, nhưng chưa điền địa chỉ proxy' };
    return { on: true, text: `${host}${port ? ':' + port : ''}` };
  }
  return { on: true, text: 'Theo hệ thống / proxy biến môi trường' };
}

function SettingsPage({ active = true, preview = false }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyDraft, setProxyDraft] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState('');
  const testVersion = useRef(0);
  const savingRef = useRef(false);
  const savedTimer = useRef(null);

  const loadSettings = async () => {
    setLoadError('');
    try { setSettings({ download_quality: 'auto', ...await window.electronAPI.getSettings() }); }
    catch (error) { setLoadError(error.message || 'Tải cài đặt thất bại, vui lòng thử lại'); }
  };

  useEffect(() => {
    loadSettings();
    return () => { testVersion.current++; clearTimeout(savedTimer.current); };
  }, []);

  useEffect(() => {
    if (!active) { testVersion.current++; setTesting(false); setTestResult(null); }
  }, [active]);

  const update = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setDirty(true);
    setSaveError('');
  };

  const selectFolder = async () => {
    try {
      const dir = await window.electronAPI.selectFolder();
      if (dir) update('root', dir);
    } catch (error) { setSaveError(error.message || 'Chọn thư mục thất bại, vui lòng thử lại'); }
  };

  const persist = async (next, isProxy = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      // Các tùy chọn phát có thể thay đổi trong khi trang cài đặt này bị ẩn.
      const current = await window.electronAPI.getSettings();
      const editable = ['root', 'name_format', 'download_quality', 'show_danmaku_controls', 'max_concurrent', 'proxy_enabled', 'proxy_mode', 'proxy_host', 'proxy_port', 'proxy_username', 'proxy_password', 'watch_updates_enabled', 'watch_sequels_enabled', 'watch_notifications_enabled', 'app_updates_enabled'];
      const submitted = { ...current };
      for (const key of editable) if (Object.hasOwn(next, key)) submitted[key] = next[key];
      const res = await window.electronAPI.saveSettings(submitted);
      if (!res?.success) throw new Error(res?.error || 'Cài đặt chưa được lưu, vui lòng thử lại');
      setSettings(submitted);
      if (isProxy) closeProxy();
      setDirty(false);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setSaveError(error.message || 'Lưu cài đặt thất bại, vui lòng thử lại');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const save = () => persist(settings);

  const closeProxy = () => {
    testVersion.current++;
    setTesting(false);
    setProxyOpen(false);
    setTestResult(null);
  };

  // ===== Hộp thoại proxy =====
  const openProxyModal = () => {
    testVersion.current++;
    setProxyDraft({
      proxy_enabled: settings.proxy_enabled === true,
      proxy_mode: settings.proxy_mode || 'system',
      proxy_host: settings.proxy_host || '127.0.0.1',
      proxy_port: settings.proxy_port || 7890,
      proxy_username: settings.proxy_username || '',
      proxy_password: settings.proxy_password || '',
    });
    setTestResult(null);
    setSaveError('');
    setProxyOpen(true);
  };

  const patchDraft = (key, value) => {
    testVersion.current++;
    setProxyDraft((prev) => ({ ...prev, [key]: value }));
    setTesting(false);
    setTestResult(null);
  };

  const runTest = async () => {
    const request = ++testVersion.current;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.electronAPI.testProxy(proxyDraft);
      if (request === testVersion.current) setTestResult(res);
    } catch (e) {
      if (request === testVersion.current) setTestResult({ success: false, error: e.message });
    } finally {
      if (request === testVersion.current) setTesting(false);
    }
  };

  const applyProxy = () => persist({ ...settings, ...proxyDraft }, true);

  useDialogKeyboard(active && proxyOpen, () => { if (!savingRef.current) closeProxy(); }, '.proxy-modal');

  if (!settings) {
    return <div className="settings-container">{loadError ? <div role="alert"><p>{loadError}</p><button className="btn btn-outline" onClick={loadSettings}>Tải lại</button></div> : 'Đang tải...'}</div>;
  }

  const proxyInfo = describeProxy(settings);
  const mode = proxyDraft ? proxyDraft.proxy_mode : 'system';

  return (
    <div className="settings-container">
      <div className="settings-header">
        <Settings size={22} />
        <div><h2>Cài đặt</h2><p className="page-description">Giúp việc tải xuống, lưu trữ và kết nối mạng hoạt động theo thói quen của bạn.</p></div>
      </div>

      <section className="settings-card" aria-label="Cài đặt giao diện"><AppearanceSettings /></section>
      <ShortcutSettings active={active} />
      <CustomSources active={active} />
      <p className="settings-hint">Ở đầu trang phát có thể bật cửa sổ nhỏ ẩn danh. Khi di chuột ra ngoài sẽ tạm dừng và ẩn đi, di chuột vào lại sẽ tiếp tục; Esc hoặc Dock để khôi phục cửa sổ chính.</p>
      <fieldset className="settings-card" disabled={saving}>
        <div className="settings-group">
          <span className="settings-label">Cài đặt nút đạn (danmaku)</span>
          <div className="settings-inline-save">
          <label className="proxy-switch-row"><input type="checkbox" aria-label="Hiển thị nút đạn" checked={settings.show_danmaku_controls !== false} onChange={event => update('show_danmaku_controls', event.target.checked)} /><span className="proxy-switch-text">Hiển thị nút đạn<em>Có hiệu lực sau khi lưu. Khi tắt sẽ ẩn đạn và nút cài đặt đạn, đồng thời dừng đạn bình luận; bật lại sẽ khôi phục tùy chọn đạn trước đó.</em></span></label>
            <button type="button" className="btn btn-primary" aria-label="Lưu cài đặt hiện tại" onClick={save}>{saving ? 'Đang lưu…' : saved ? 'Đã lưu' : 'Lưu'}</button>
          </div>
        </div>
        <div className="settings-group">
          <label className="settings-label">Thư mục tải xuống</label>
          <div className="folder-row">
            <input
              type="text"
              className="input-field"
              aria-label="Thư mục tải xuống"
              value={settings.root || ''}
              onChange={(e) => update('root', e.target.value)}
              placeholder="Chọn thư mục lưu tải xuống"
            />
            <button className="btn btn-outline" onClick={selectFolder}>
              <Folder size={16} />
              Chọn thư mục
            </button>
          </div>
          <p className="settings-hint">File sẽ được lưu vào <code>Thư mục tải xuống/Hồng Quả Việt Nam/Tên phim/</code></p>
        </div>

        <div className="settings-group">
          <label className="settings-label">Quy tắc đặt tên file</label>
          <div className="preset-row">
            {FORMAT_PRESETS.map((p) => (
              <button
                key={p.value}
                className={`btn-chip ${settings.name_format === p.value ? 'btn-chip-primary' : ''}`}
                onClick={() => update('name_format', p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="input-field mt8"
            aria-label="Quy tắc đặt tên file"
            value={settings.name_format || ''}
            onChange={(e) => update('name_format', e.target.value)}
          />
          <p className="settings-hint">
            Biến khả dụng: <code>剧名</code> (tên phim) · <code>集数</code> (số tập, ví dụ 001) · <code>标题</code> (tiêu đề)
            . Mỗi tập giữ số tập riêng để tránh ghi đè trùng tên.
          </p>
        </div>

        <div className="settings-group">
          <label className="settings-label" htmlFor="default-download-quality">Độ phân giải tải mặc định</label>
          <select id="default-download-quality" className="input-field select-field"
            value={settings.download_quality || 'auto'} aria-describedby="default-download-quality-hint"
            onChange={(event) => update('download_quality', event.target.value)}>
            <option value="auto">Tự động (ưu tiên tương thích)</option>
            <option value="1080p">1080P</option>
            <option value="720p">720P</option>
          </select>
          <p className="settings-hint" id="default-download-quality-hint">Được lưu và dùng cho các tác vụ tải mới, cũng có thể chọn riêng khi tải. Nếu độ phân giải đã chọn không khả dụng sẽ có thông báo, không tự động hạ cấp; file đã có sẽ không tự động xóa hoặc ghi đè.</p>
        </div>

        <div className="settings-group">
          <label className="settings-label">Số lượng tải đồng thời tối đa</label>
          <select
            className="input-field select-field"
            aria-label="Số lượng tải đồng thời tối đa"
            value={settings.max_concurrent || 3}
            onChange={(e) => update('max_concurrent', parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>{n} tải cùng lúc</option>
            ))}
          </select>
          <p className="settings-hint">
            Tải đồng thời <b>{settings.max_concurrent || 3}</b> tập (có hiệu lực ngay sau khi lưu).
            Đồng thời càng cao càng nhanh, nhưng có thể kích hoạt giới hạn của API, khuyến nghị 3~5.
          </p>
        </div>

        <div className="settings-group">
          <label className="settings-label">Proxy mạng</label>
          <div className="proxy-status-row">
            <span className={`proxy-dot ${proxyInfo.on ? 'proxy-dot-on' : 'proxy-dot-off'}`} />
            <span className="proxy-status-text">
              {proxyInfo.on ? <>Đã bật: <code>{proxyInfo.text}</code></> : proxyInfo.text}
            </span>
            <button className="btn btn-outline btn-sm" onClick={openProxyModal}>
              <Globe size={15} />
              Cấu hình proxy
            </button>
          </div>
          <p className="settings-hint">
            Nếu máy bạn có proxy (Clash / V2rayN v.v.), điền vào đây, cả việc phân tích tập phim và tải video đều sẽ đi qua proxy đó. Có hiệu lực ngay sau khi lưu, không cần khởi động lại.
          </p>
        </div>

        <div className="settings-group">
          <span className="settings-label">Nhắc nhở theo dõi phim</span>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_updates_enabled !== false} onChange={event => update('watch_updates_enabled', event.target.checked)} /><span className="proxy-switch-text">Tự động kiểm tra tập mới<em>Trong thời gian ứng dụng chạy, mỗi phim kiểm tra khoảng 6 giờ một lần; khi danh sách nhiều sẽ kiểm tra theo lô</em></span></label>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_sequels_enabled !== false} onChange={event => update('watch_sequels_enabled', event.target.checked)} /><span className="proxy-switch-text">Tìm mùa mới nghi ngờ<em>Khoảng mỗi ngày tìm theo tên phim một lần, chỉ gợi ý phim cùng tên có số mùa cao hơn; có thể bỏ sót hoặc báo nhầm</em></span></label>
          <label className="proxy-switch-row"><input type="checkbox" checked={settings.watch_notifications_enabled === true} onChange={event => update('watch_notifications_enabled', event.target.checked)} /><span className="proxy-switch-text">Gửi thông báo hệ thống<em>Mặc định tắt. Khi bật cần cho phép thông báo macOS; tắt không ảnh hưởng đến chấm đỏ trong lịch sử xem</em></span></label>
        </div>

        {preview ? <>
        <div className="settings-group">
          <span className="settings-label">Xem trước độc lập</span>
          <p className="settings-hint">Dữ liệu xem trước được lưu riêng, không nhận cập nhật bản chính thức, không ghi đè lên Hồng Quả Việt Nam đã cài đặt.</p>
        </div>
        </> : <>
        <div className="settings-group">
          <span className="settings-label">Kiểm tra cập nhật</span>
          <label className="proxy-switch-row"><input type="checkbox" aria-label="Tự động kiểm tra cập nhật" checked={settings.app_updates_enabled !== false} onChange={event => update('app_updates_enabled', event.target.checked)} /><span className="proxy-switch-text">Tự động kiểm tra cập nhật<em>Kiểm tra bản chính thức mới khi khởi động và mỗi 6 giờ trong thời gian chạy. Có hiệu lực sau khi lưu; việc tải xuống và khởi động lại để cài đặt đều do bạn nhấp xác nhận.</em></span></label>
          <button type="button" className="btn btn-outline" disabled={settings.app_updates_enabled === false} onClick={() => window.dispatchEvent(new CustomEvent('hongguo-check-app-update'))}><RefreshCw size={15} />Kiểm tra cập nhật</button>
          <p className="settings-hint">Có thể mở lại thông báo cập nhật đã đóng, xem tiến độ tải hoặc cài đặt bản mới đã tải. Sau khi tắt kiểm tra, cần bật lại và lưu.</p>
        </div>
        </>}

        <div className="settings-footer">
          {dirty && <span className="settings-hint" role="status">Có thay đổi chưa lưu</span>}
          <button className="btn btn-primary" onClick={save}>
            {saving ? 'Đang lưu…' : saved ? <><Check size={16} /> Đã lưu</> : 'Lưu cài đặt'}
          </button>
        </div>
        {saveError && !proxyOpen && <p className="alert alert-error" role="alert">{saveError}</p>}
      </fieldset>

      {proxyOpen && proxyDraft && (
        <div className="proxy-modal-mask" onClick={() => !saving && closeProxy()}>
          <div className="proxy-modal" role="dialog" aria-modal="true" aria-label="Cài đặt proxy mạng" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="proxy-modal-head">
              <div className="proxy-modal-title">
                <Globe size={18} />
                <span>Cài đặt proxy mạng</span>
              </div>
              <button className="icon-btn" title="Đóng" disabled={saving} onClick={closeProxy}>
                <X size={16} />
              </button>
            </div>

            <fieldset className="proxy-modal-body" disabled={saving}>
              <label className="proxy-switch-row">
                <input
                  type="checkbox"
                  checked={proxyDraft.proxy_enabled}
                  onChange={(e) => patchDraft('proxy_enabled', e.target.checked)}
                />
                <span className="proxy-switch-text">
                  Bật proxy
                  <em>Khi tắt, proxy không có hiệu lực, tất cả request kết nối trực tiếp</em>
                </span>
              </label>

              <div className={`proxy-fields ${proxyDraft.proxy_enabled ? '' : 'proxy-fields-disabled'}`}>
                <div className="settings-group">
                  <label className="settings-label">Chế độ proxy</label>
                  <div className="proxy-mode-list">
                    {PROXY_MODES.map((m) => (
                      <label
                        key={m.value}
                        className={`proxy-mode-item ${mode === m.value ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="proxy_mode"
                          value={m.value}
                          checked={mode === m.value}
                          disabled={!proxyDraft.proxy_enabled}
                          onChange={() => patchDraft('proxy_mode', m.value)}
                        />
                        <span className="proxy-mode-body">
                          <b>{m.label}</b>
                          <em>{m.desc}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {mode === 'custom' && (
                  <div className="settings-group">
                    <label className="settings-label">Địa chỉ proxy</label>
                    <div className="proxy-host-row">
                      <input
                        type="text"
                        className="input-field"
                        aria-label="Địa chỉ máy chủ proxy"
                        placeholder="127.0.0.1"
                        value={proxyDraft.proxy_host}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_host', e.target.value)}
                      />
                      <span className="proxy-colon">:</span>
                      <input
                        type="number"
                        className="input-field proxy-port"
                        aria-label="Cổng proxy"
                        placeholder="7890"
                        min="1"
                        max="65535"
                        value={proxyDraft.proxy_port}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_port', e.target.value)}
                      />
                    </div>
                    <div className="preset-row mt8">
                      {PORT_PRESETS.map((p) => (
                        <button
                          key={p.port}
                          type="button"
                          className="btn-chip"
                          disabled={!proxyDraft.proxy_enabled}
                          onClick={() => patchDraft('proxy_port', p.port)}
                        >
                          {p.label} {p.port}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mode === 'custom' && (
                  <div className="settings-group">
                    <label className="settings-label">Xác thực proxy (tùy chọn)</label>
                    <div className="proxy-auth-row">
                      <input
                        type="text"
                        className="input-field"
                        aria-label="Tên đăng nhập proxy"
                        placeholder="Tên đăng nhập"
                        autoComplete="off"
                        value={proxyDraft.proxy_username}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_username', e.target.value)}
                      />
                      <input
                        type="password"
                        className="input-field"
                        aria-label="Mật khẩu proxy"
                        placeholder="Mật khẩu"
                        autoComplete="new-password"
                        value={proxyDraft.proxy_password}
                        disabled={!proxyDraft.proxy_enabled}
                        onChange={(e) => patchDraft('proxy_password', e.target.value)}
                      />
                    </div>
                    <p className="settings-hint">Để trống nếu proxy không cần xác thực</p>
                  </div>
                )}
              </div>

              {testResult && (
                <div className={`proxy-test-result ${testResult.success ? 'ok' : 'fail'}`}>
                  {testResult.success ? <Check size={15} /> : <AlertCircle size={15} />}
                  <span>
                    {testResult.success ? testResult.message : testResult.error}
                    {testResult.success && testResult.via ? ` · qua ${testResult.via}` : ''}
                  </span>
                </div>
              )}
              {saveError && <p className="alert alert-error" role="alert">{saveError}</p>}
            </fieldset>

            <div className="proxy-modal-foot">
              <button className="btn btn-outline" onClick={runTest} disabled={testing || saving}>
                <RefreshCw size={15} />
                {testing ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
              </button>
              <div className="proxy-foot-right">
                <button className="btn btn-outline" disabled={saving} onClick={closeProxy}>Hủy</button>
                <button className="btn btn-primary" disabled={saving} onClick={applyProxy}>
                  <Check size={15} />
                  {saving ? 'Đang lưu…' : 'Lưu và áp dụng'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default SettingsPage;
