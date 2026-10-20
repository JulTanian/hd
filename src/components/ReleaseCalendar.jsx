import React, { useEffect, useMemo, useState } from 'react';
import { publicDateKey, readLocalLibrary, saveLocalSeries, subscribeLocalLibrary } from '../localLibrary';
import './ReleaseCalendar.css';

export default function ReleaseCalendar({ onPlay }) {
  const [library, setLibrary] = useState(readLocalLibrary);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [chosenMonth, setChosenMonth] = useState('');
  useEffect(() => subscribeLocalLibrary(setLibrary), []);
  const rows = useMemo(() => library.items.map(item => ({ ...item, date: publicDateKey(item.published_at) })), [library.items]);
  const dated = rows.filter(item => item.date).sort((a, b) => b.date.localeCompare(a.date));
  const filtered = rows.filter(item => !favoritesOnly || item.favorite);
  const months = [...new Set(filtered.filter(item => item.date).map(item => item.date.slice(0, 7)))].sort().reverse();
  const month = months.includes(chosenMonth) ? chosenMonth : months[0] || '';
  const monthItems = filtered.filter(item => item.date.startsWith(`${month}-`)).sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'));
  const days = [...new Set(monthItems.map(item => item.date))];
  const undated = filtered.filter(item => !item.date);
  const favoritesCount = rows.filter(item => item.favorite).length;
  const row = item => <li key={item.id} className="release-row">
    <div className="release-title"><strong>{item.title}</strong><span>{item.date ? `Công khai lần đầu ${item.date}` : 'Chưa có thời gian công khai lần đầu'}</span></div>
    <div className="release-row-actions">
      <button type="button" className="btn btn-sm btn-outline" aria-label={`${item.favorite ? 'Bỏ yêu thích' : 'Yêu thích'}《${item.title}》`} aria-pressed={item.favorite} onClick={() => setLibrary(saveLocalSeries({ id: item.id, title: item.title, favorite: !item.favorite }))}>{item.favorite ? 'Đã yêu thích' : 'Yêu thích'}</button>
      <button type="button" className="btn btn-sm" disabled={!onPlay} aria-label={`Phát《${item.title}》`} onClick={() => onPlay?.({ seriesId: item.id, title: item.title })}>Phát</button>
    </div>
  </li>;

  return <section className="release-calendar">
    <header><h2>Lịch cập nhật</h2><p className="page-description">Lịch công khai lần đầu của các phim đã xem. Sau khi mở "Đánh giá công khai" của phim, ngày thực tế sẽ được lưu ở đây.</p></header>
    <p className="release-coverage">Máy này có {rows.length} bộ · có ngày công khai {dated.length} bộ{dated.length > 0 ? ` · ${dated[dated.length - 1].date} đến ${dated[0].date}` : ''}. Hiển thị theo giờ Bắc Kinh, không phải lịch cập nhật đầy đủ.</p>
    {library.error && <div className="release-error" role="alert"><p>{library.error}</p><button type="button" className="btn btn-sm" onClick={() => setLibrary(readLocalLibrary())}>Đọc lại</button></div>}
    <div className="release-toolbar">
      <div className="release-filter" role="group" aria-label="Phạm vi lịch"><button type="button" aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>Tất cả đã xem</button><button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(true)}>Yêu thích trên máy {favoritesCount}</button></div>
      {months.length > 0 && <label className="release-month">Tháng<select value={month} onChange={event => setChosenMonth(event.target.value)}>{months.map(value => <option key={value} value={value}>Năm {value.slice(0, 4)} tháng {Number(value.slice(5))}</option>)}</select></label>}
    </div>
    {!library.error && !filtered.length && <div className="release-empty"><h3>{favoritesOnly ? 'Chưa có yêu thích trên máy' : 'Chưa có phim nào để hiển thị'}</h3><p>Vào "Khám phá phim ngắn" mở phim chính thức, mở rộng "Đánh giá công khai" để đọc ngày công khai lần đầu; cũng có thể bấm "Yêu thích vào máy" để xem sau.</p></div>}
    {days.map(day => <section className="release-day" key={day} aria-label={`${day} công khai lần đầu`}><h3><span>{Number(day.slice(8))}</span><small>Tháng {Number(day.slice(5, 7))}</small></h3><ul>{monthItems.filter(item => item.date === day).map(row)}</ul></section>)}
    {undated.length > 0 && <section className="release-undated"><h3>Ngày công khai chưa có <span>{undated.length} bộ</span></h3><p>Các phim này đã lưu trên máy, nhưng dịch vụ chưa trả về ngày công khai lần đầu.</p><ul>{undated.map(row)}</ul></section>}
  </section>;
}
