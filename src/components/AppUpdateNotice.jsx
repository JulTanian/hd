import React, { useEffect, useRef, useState } from 'react';
import { X } from './icons';
import './AppUpdateNotice.css';

export default function AppUpdateNotice() {
  const [release, setRelease] = useState(null);
  const [error, setError] = useState('');
  const dismissed = useRef(new Set());
  useEffect(() => {
    let generation = 0;
    const check = async () => {
      const request = ++generation;
      try {
        const result = await window.electronAPI.checkAppUpdate();
        if (request !== generation) return;
        setRelease(result?.enabled && result.release && !dismissed.current.has(result.release.version) ? result.release : null);
      } catch { /* Offline checks remain silent and never interrupt playback. */ }
    };
    const unsubscribe = window.electronAPI.onAppUpdatePreference(enabled => {
      generation++;
      if (enabled) check();
      else { setRelease(null); setError(''); }
    });
    check();
    const timer = setInterval(check, 6 * 60 * 60 * 1000);
    return () => { generation++; clearInterval(timer); unsubscribe(); };
  }, []);
  const close = () => { dismissed.current.add(release.version); setRelease(null); setError(''); };
  if (!release) return null;
  return <section className="app-update-notice" role="dialog" aria-label="发现新版本" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <button type="button" className="icon-btn app-update-close" aria-label="关闭更新提醒" title="关闭更新提醒" onClick={close}><X size={18} /></button>
    <h2 aria-live="polite">发现新版本 v{release.version}</h2>
    <p>GitHub 已发布新版。可前往下载，也可关闭提醒，继续使用当前版本。</p>
    <button type="button" className="btn btn-primary" onClick={async () => {
      setError('');
      try { const result = await window.electronAPI.openAppUpdate(); if (!result?.success) setError(result?.error || '无法打开浏览器，请稍后重试'); }
      catch { setError('无法打开浏览器，请稍后重试'); }
    }}>前往 GitHub 下载</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
