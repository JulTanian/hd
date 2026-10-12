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
      setError('外观保存失败，请重试。');
    }
  };

  return (
    <div className="settings-group">
      <label className="settings-label" htmlFor="appearance-theme">外观</label>
      <select id="appearance-theme" className="input-field select-field" value={preference} onChange={changeTheme} aria-describedby="appearance-hint">
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
      <p className="settings-hint" id="appearance-hint">立即生效并自动保存。跟随系统时，外观会随系统切换。</p>
      {error && <p className="appearance-error" role="alert">{error}</p>}
    </div>
  );
}
