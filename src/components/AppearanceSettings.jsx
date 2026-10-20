import React, { useState } from 'react';
import { getThemePreference, setThemePreference } from '../theme';

export default function AppearanceSettings() {
  const [preference, setPreference] = useState(getThemePreference);
  const [error, setError] = useState('');

  const changeTheme = (event) => {
    try {
      setThemePreference(event.target.value);
      setPreference(event.target.value);
      setError('');
    } catch {
      setError('Lưu giao diện thất bại, vui lòng thử lại.');
    }
  };

  return (
    <div className="settings-group">
      <label className="settings-label" htmlFor="appearance-theme">Giao diện</label>
      <select id="appearance-theme" className="input-field select-field" value={preference} onChange={changeTheme} aria-describedby="appearance-hint">
        <option value="system">Theo hệ thống</option>
        <option value="light">Sáng</option>
        <option value="dark">Tối</option>
      </select>
      <p className="settings-hint" id="appearance-hint">Có hiệu lực ngay và tự động lưu. Khi chọn "Theo hệ thống", giao diện sẽ chuyển đổi theo hệ thống.</p>
      {error && <p className="appearance-error" role="alert">{error}</p>}
    </div>
  );
}
