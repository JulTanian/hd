import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useDialogKeyboard from './useDialogKeyboard';
import './Browse.css';
import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { Film, RefreshCw, ExternalLink, Download, Play, Check, X, Search } from './icons';
import { isSubmitKey, parseEpisodeRange } from './episodeRange';
import { rememberCatalogTitles } from '../searchHistory';

const GENRE_MAP = {
  '真人剧': 'Phim người thật', '漫剧': 'Phim hoạt họa', 'AI剧': 'Phim AI', '漫画': 'Truyện tranh',
  '综合热播榜': 'BXH tổng hợp', '真人热播榜': 'BXH phim người thật', '漫剧热播榜': 'BXH phim hoạt họa', 'AI热播榜': 'BXH phim AI',
  '热播榜': 'BXH hot', '热播总榜': 'BXH tổng hot', '真人短剧': 'Phim ngắn người thật', 'AI 短剧': 'Phim ngắn AI',
  '爱情': 'Tình cảm', '古风爱情': 'Cổ phong tình cảm', '都市爱情': 'Đô thị tình cảm',
  '现代言情': 'Tình cảm hiện đại', '古代言情': 'Tình cảm cổ đại', '都市': 'Đô thị',
  '青春': 'Thanh xuân', '校园': 'Học đường', '现实': 'Hiện thực', '年代': 'Thời đại', '年代剧': 'Phim thời đại',
  '民国': 'Dân Quốc', '民国剧': 'Phim Dân Quốc', '古装': 'Cổ trang', '古穿今': 'Cổ xuyên kim',
  '穿越': 'Xuyên không', '穿越时空': 'Xuyên không thời gian', '重生': 'Trùng sinh', '逆袭': 'Nghịch tập',
  '反转': 'Đảo ngược', '复仇': 'Báo thù', '虐恋': 'Ngược luyến', '虐渣': 'Ngược tra', '打脸虐渣': 'Vả mặt ngược tra',
  '甜宠': 'Ngọt sủng', '暗恋': 'Yêu thầm', '闪婚': 'Kết hôn chớp nhoáng', '先婚后爱': 'Cưới trước yêu sau',
  '破镜重圆': 'Gương vỡ lại lành', '追妻': 'Theo đuổi vợ', '追妻火葬场': 'Theo đuổi vợ (hối hận)',
  '追夫火葬场': 'Theo đuổi chồng (hối hận)', '豪门': 'Hào môn', '豪门恩怨': 'Ân oán hào môn',
  '大女主': 'Đại nữ chủ', '女帝': 'Nữ đế', '女王': 'Nữ vương', '王妃': 'Vương phi', '皇后': 'Hoàng hậu',
  '公主': 'Công chúa', '女总裁': 'Nữ tổng tài', '女高手下山': 'Nữ cao thủ xuống núi', '女性成长': 'Phụ nữ trưởng thành',
  '家庭': 'Gia đình', '家庭伦理': 'Luân lý gia đình', '家庭主妇': 'Nội trợ', '亲情': 'Tình thân',
  '亲情剧': 'Phim tình thân', '家国情仇': 'Tình nhà nghĩa nước', '婚姻': 'Hôn nhân', '中年婚恋': 'Hôn nhân trung niên',
  '中年': 'Trung niên', '萌宝': 'Bé con', '团宠': 'Sủng cả nhóm', '神医': 'Thần y', '战神': 'Chiến thần',
  '强者回归': 'Cường giả trở về', '高手下山': 'Cao thủ xuống núi', '龙王': 'Long Vương', '赘婿': 'Ở rể',
  '神豪': 'Thần hào', '神眼': 'Thần nhãn', '天才': 'Thiên tài', '小人物': 'Tiểu nhân vật', '包租公': 'Ông chủ nhà trọ',
  '弃少': 'Thiếu gia bị bỏ', '真假千金': 'Thiên kim thật giả', '千金': 'Thiên kim', '换亲': 'Đổi thân',
  '错认': 'Nhận nhầm', '替身': 'Thế thân', '原配': 'Vợ/chồng chính thất', '庶女': 'Thứ nữ', '嫡女': 'Đích nữ',
  '宫女': 'Cung nữ', '偷听心声': 'Nghe trộm tiếng lòng', '读心术': 'Đọc tâm thuật', '鉴宝': 'Giám định bảo vật',
  '厨神': 'Bếp thần', '种田': 'Điền viên', '致富': 'Làm giàu', '乡村': 'Nông thôn', '求生': 'Sinh tồn',
  '末世': 'Mạt thế', '空间': 'Không gian', '系统': 'Hệ thống', '异能': 'Dị năng', '超能': 'Siêu năng lực',
  '灵异': 'Linh dị', '玄学': 'Huyền học', '玄幻': 'Huyền huyễn', '奇幻': 'Kỳ ảo', '现代奇幻': 'Kỳ ảo hiện đại',
  '奇幻脑洞': 'Kỳ ảo sáng tạo', '玄幻仙侠': 'Huyền huyễn tiên hiệp', '古装仙侠': 'Cổ trang tiên hiệp',
  '仙侠': 'Tiên hiệp', '修仙': 'Tu tiên', '神话': 'Thần thoại', '架空': 'Hư cấu', '传承觉醒': 'Kế thừa thức tỉnh',
  '悬疑': 'Ly kỳ', '惊悚': 'Kinh dị', '恐怖': 'Kinh hoàng', '志怪': 'Chí quái', '喜剧': 'Hài kịch',
  '搞笑': 'Hài hước', '轻松': 'Nhẹ nhàng', '沙雕漫': 'Hoạt họa hài', '权谋': 'Quyền mưu', '律政': 'Luật chính',
  '职场': 'Công sở', '职场商战': 'Công sở thương chiến', '战争': 'Chiến tranh', '抗战谍战': 'Kháng chiến điệp chiến',
  '功夫': 'Võ công', '功夫武打': 'Võ công đánh đấm', '武侠': 'Võ hiệp', '戏曲歌舞': 'Hí khúc ca vũ',
  '娱乐圈': 'Giới giải trí', '电视剧': 'Phim truyền hình', '电影': 'Phim điện ảnh', '综艺': 'Tạp kỹ',
  '体育': 'Thể thao', '竞赛': 'Thi đấu', '励志': 'Truyền cảm hứng', '师生情': 'Tình thầy trò',
  '青梅竹马': 'Thanh mai trúc mã', '欢喜冤家': 'Hoan hỷ oan gia', '世情': 'Thế tình', '情感流': 'Dòng cảm xúc',
  '情感': 'Tình cảm', '迪化': 'Địch hóa', '马甲': 'Áo giáp (thân phận ẩn)', '后悔流': 'Dòng hối hận',
  '科幻': 'Khoa học viễn tưởng', '灾难': 'Thảm họa', '动作冒险': 'Hành động phiêu lưu', '剧情': 'Chính kịch',
  '成长': 'Trưởng thành', '传奇': 'Truyền kỳ', '家族': 'Gia tộc', '长生': 'Trường sinh', '今古连通': 'Kim cổ kết nối',
  '2D漫': 'Hoạt họa 2D', '3D漫': 'Hoạt họa 3D', '小说漫': 'Hoạt họa tiểu thuyết', '仿真人动态漫': 'Hoạt họa động giả người',
  '60集以下': 'Dưới 60 tập', '60~100集': '60~100 tập', '100集以上': 'Trên 100 tập',
  '毒士': 'Độc sĩ', '反派': 'Phản diện', '寻亲': 'Tìm thân', '爽文': 'Sảng văn',
};
const translateGenre = (text) => GENRE_MAP[text] || text;

const pageCache = new Map();
const PAGE_CACHE_TTL_MS = 60_000;
const LIST_TIMEOUT_MS = 25_000;

/**
 * Browse —— Duyệt phim theo danh mục
 *
 * Luồng dữ liệu:
 *   Danh mục nguồn độc lập -> thẻ (series_id/tên phim/ảnh bìa/số tập/nhãn)
 *   Bấm thẻ -> tái sử dụng search-resolve để lấy toàn bộ tập và ghi vào hồ sơ phim ngắn
 *         -> tái sử dụng get-series-episodes để lấy trạng thái "đã tải/đang tải/chưa tải" của từng tập
 *         -> chuyển sang trình phát hoặc dùng tải hàng loạt có sẵn
 */
function Browse({ onNavigate, active = true }) {
  const [source, setSource] = useState('hongguo');
  const { sources: mediaSources, revision: sourceRevision, loading: sourcesLoading, error: sourcesError } = useMediaSources();
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('real-drama');
  const [genre, setGenre] = useState('');
  const [page, setPage] = useState(1);
  const [completion, setCompletion] = useState('all');

  const [results, setResults] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 0, genres: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');

  // Ngăn kéo chi tiết
  const [detail, setDetail] = useState(null); // { series_id, series_title, cover, episodes: [...] }
  const [detailLoading, setDetailLoading] = useState(false);
  const [rangeInput, setRangeInput] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const detailRequest = useRef(0);
  const listRequest = useRef(0);
  const listTimer = useRef(null);
  const toastTimer = useRef(null);

  const invalidateList = useCallback(() => {
    listRequest.current++;
    clearTimeout(listTimer.current);
  }, []);

  const cancelList = () => {
    invalidateList();
    setLoading(false);
    setError('Đã hủy tải, có thể tải lại hoặc chuyển danh mục.');
  };

  const closeDetail = useCallback(() => {
    detailRequest.current++;
    setDetail(null);
    setDetailLoading(false);
  }, []);

  useEffect(() => () => {
    detailRequest.current++;
    invalidateList();
    clearTimeout(toastTimer.current);
  }, [invalidateList]);

  // Thống kê đã tải (theo series_id -> số tập đã tải)
  const [downloadedMap, setDownloadedMap] = useState({});
  const [toast, setToast] = useState(null);

  const showToast = useCallback((text, type = 'success') => {
    setToast({ text, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const loadDownloadedMap = useCallback(async () => {
    try {
      const list = (await window.electronAPI.getSeriesList()) || [];
      const map = {};
      for (const s of list) {
        const res = await window.electronAPI.getSeriesEpisodes(s.series_id);
        if (res && res.success) {
          map[String(s.series_id)] = {
            completed: res.data.completedCount,
            total: res.data.total,
          };
        }
      }
      setDownloadedMap(map);
    } catch (_) {}
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const list = await window.electronAPI.browseCategories();
      if (Array.isArray(list) && list.length) {
        setCategories(list);
      }
    } catch (_) {}
  }, []);

  const loadList = useCallback(
    async (cat, gen, pg, forceRefresh = false) => {
      invalidateList();
      const request = listRequest.current;
      const key = JSON.stringify([sourceRevision, source, cat, gen, pg]);
      const cached = pageCache.get(key);
      const fallbackUrl = source === 'hongguo'
        ? `https://hongguoduanju.com/${cat.startsWith('hot-') ? 'rank' : 'category'}/${encodeURIComponent(cat)}${gen ? `/${encodeURIComponent(gen)}` : ''}${pg > 1 ? `?page=${pg}` : ''}` : '';
      setUnsupported(false);
      setError('');
      setResults(cached?.results || []);
      setMeta(cached?.meta || { total: 0, totalPages: 0, genres: [] });
      setSourceUrl(cached?.sourceUrl || fallbackUrl);
      if (!forceRefresh && cached && Date.now() - cached.savedAt < PAGE_CACHE_TTL_MS) {
        setLoading(false);
        return;
      }
      setLoading(true);
      listTimer.current = setTimeout(() => {
        if (request !== listRequest.current) return;
        invalidateList();
        setLoading(false);
        setError(cached ? 'Làm mới quá thời gian, vẫn hiển thị danh sách cũ; có thể thử lại hoặc chuyển danh mục.' : 'Tải quá thời gian, vui lòng thử lại hoặc chuyển danh mục.');
      }, LIST_TIMEOUT_MS);
      try {
        const res = await window.electronAPI.browseList({ source, category: cat, genre: gen, page: pg, forceRefresh });
        if (request !== listRequest.current) return;
        setSourceUrl(res?.sourceUrl || fallbackUrl);
        if (!res?.success) throw new Error(res?.error || 'Nguồn tạm thời không khả dụng');
        const next = {
          results: Array.isArray(res.results) ? res.results : [],
          meta: { total: res.total || 0, totalPages: res.totalPages || 0, genres: res.genres || [], hasMore: res.hasMore === true },
          sourceUrl: res.sourceUrl || fallbackUrl,
          savedAt: Date.now(),
        };
        rememberCatalogTitles(next.results);
        setResults(next.results);
        setMeta(next.meta);
        setSourceUrl(next.sourceUrl);
        if (next.results.length) {
          pageCache.delete(key);
          pageCache.set(key, next);
          if (pageCache.size > 24) pageCache.delete(pageCache.keys().next().value);
        } else {
          pageCache.delete(key);
          setUnsupported(res.unsupported === true);
          setError(res.emptyMessage || 'Trang này không có nội dung, có thể tải lại hoặc đổi danh mục.');
        }
      } catch (e) {
        if (request !== listRequest.current) return;
        setError(`${cached ? 'Làm mới thất bại, vẫn hiển thị danh sách cũ' : 'Tải thất bại'}：${e.message || 'Vui lòng thử lại'}`);
      } finally {
        if (request === listRequest.current) {
          clearTimeout(listTimer.current);
          setLoading(false);
        }
      }
    },
    [invalidateList, source, sourceRevision]
  );

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => { if (active) loadDownloadedMap(); }, [active, loadDownloadedMap]);

  useEffect(() => {
    invalidateList(); closeDetail(); pageCache.clear();
    setGenre(''); setPage(1); setResults([]); setMeta({ total: 0, totalPages: 0, genres: [] });
    if (!mediaSources.some(item => item.id === source)) { setSource('hongguo'); setCategory('real-drama'); }
  }, [sourceRevision, mediaSources, invalidateList, closeDetail]);

  useEffect(() => {
    if (active && !sourcesLoading && mediaSources.some(item => item.id === source)) loadList(category, genre, page);
    return invalidateList;
  }, [active, category, genre, page, loadList, sourcesLoading, mediaSources, invalidateList]);

  const switchSource = (next) => {
    if (next === source) return;
    invalidateList();
    closeDetail();
    setSource(next);
    setCategory('real-drama');
    setGenre('');
    setPage(1);
    setResults([]);
    setMeta({ total: 0, totalPages: 0, genres: [] });
    setSourceUrl('');
    setError('');
  };

  const switchCategory = (slug) => {
    if (slug === category) return;
    invalidateList();
    setError('');
    setMeta({ total: 0, totalPages: 0, genres: [] });
    setCategory(slug);
    setGenre('');
    setPage(1);
    setResults([]);
  };

  const switchGenre = (slug) => {
    if (slug === genre) return;
    invalidateList();
    setError('');
    setGenre(slug);
    setPage(1);
    setResults([]);
  };

  const gotoPage = (p) => {
    const max = meta.totalPages || (source !== 'hongguo' ? page + (meta.hasMore ? 1 : 0) : 1);
    const next = Math.min(Math.max(1, p), max);
    if (next === page) return;
    invalidateList();
    setError('');
    setPage(next);
    document.querySelector('.main-content:not([hidden])')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ===== Mở một bộ phim =====
  const openSeries = async (item) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetail(null);
    setSelectedIdx(new Set());
    setRangeInput('');
    setRangeError('');
    try {
      const res = await window.electronAPI.searchResolve(item.series_id);
      if (request !== detailRequest.current) return;
      if (!res || !res.success) {
        showToast((res && res.error) || 'Lấy danh sách tập thất bại', 'error');
        return;
      }
      const data = res.data;
      // Gộp trạng thái tải
      const epRes = await window.electronAPI.getSeriesEpisodes(item.series_id);
      if (request !== detailRequest.current) return;
      const statusMap = {};
      if (epRes && epRes.success) {
        for (const e of epRes.data.episodes) statusMap[e.vid_index] = e;
      }
      const episodes = data.episodes.map((ep) => ({
        ...ep,
        status: statusMap[ep.vid_index] ? statusMap[ep.vid_index].status : 'missing',
        progress: statusMap[ep.vid_index] ? statusMap[ep.vid_index].progress : 0,
        fileUrl: statusMap[ep.vid_index] ? statusMap[ep.vid_index].fileUrl : null,
      }));
      setDetail({ ...data, episodes, completedCount: episodes.filter((e) => e.status === 'completed').length });
      // Mặc định chọn tất cả tập chưa tải
      setSelectedIdx(new Set(episodes.filter((e) => !e.locked && e.status !== 'completed').map((e) => e.vid_index)));
    } catch (e) {
      if (request === detailRequest.current) showToast('Mở thất bại: ' + e.message, 'error');
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const toggleIdx = (idx) => {
    if (!detail?.episodes.some((ep) => ep.vid_index === idx && !ep.locked)) return;
    const next = new Set(selectedIdx);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIdx(next);
  };

  // Chọn nhanh theo khoảng: 1-50 / 10 đầu / 30 cuối / chọn tất cả / xóa hết
  const applyRange = (expr) => {
    if (!detail) return;
    try {
      const nums = parseEpisodeRange(expr, detail.episodes.length);
      setSelectedIdx(new Set(detail.episodes.filter((e) => !e.locked && nums.has(e.vid_index)).map((e) => e.vid_index)));
      setRangeError('');
    } catch (error) { setRangeError(error.message); }
  };

  const downloadSelected = async () => {
    if (!detail || selectedIdx.size === 0) return;
    setSubmitting(true);
    try {
      const eps = detail.episodes.filter((e) => !e.locked && selectedIdx.has(e.vid_index));
      const res = await window.electronAPI.hongguoDownloadBatch({
        seriesId: detail.series_id,
        seriesTitle: detail.series_title,
        episodes: eps,
      });
      if (res && res.success) {
        showToast(`Đã thêm vào hàng đợi tải: ${res.count} tập`);
        setDetail(null);
        if (onNavigate) onNavigate('manager');
      } else {
        showToast((res && res.error) || 'Gửi yêu cầu tải thất bại', 'error');
      }
    } catch (e) {
      showToast('Gửi yêu cầu lỗi: ' + e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Bắt đầu từ tập đầu tiên; trình phát sẽ chọn nguồn cục bộ hoặc trực tuyến theo trạng thái thực tế.
  const playNow = async () => {
    if (!detail) return;
    const first = detail.episodes.find((e) => !e.locked);
    if (!first) return;
    try {
      const res = await window.electronAPI.playSeries({ seriesId: detail.series_id, vidIndex: first.vid_index });
      if (res?.success) closeDetail();
      else showToast(res?.error || 'Mở trình phát thất bại, vui lòng thử lại', 'error');
    } catch (e) {
      showToast('Mở trình phát thất bại: ' + e.message, 'error');
    }
  };

  const showBrowser = async () => {
    if (source !== 'hongguo' || !sourceUrl) return;
    try {
      const res = await window.electronAPI.searchWindowShow(true, sourceUrl);
      if (res?.success === false) throw new Error(res.error || 'Mở trang nguồn thất bại');
      showToast('Đã mở trang nguồn hiện tại');
    } catch (e) { showToast(e.message || 'Mở trang nguồn thất bại', 'error'); }
  };

  useDialogKeyboard(active && (!!detail || detailLoading), closeDetail, '.browse-drawer');

  const visibleResults = completion === 'all' ? results : results.filter((item) => item.completion_status === completion);
  const totalPages = meta.totalPages || 0;
  const pageNumbers = useMemo(() => {
    if (!totalPages) return [];
    const out = [];
    const cur = page;
    const push = (n) => {
      if (n >= 1 && n <= totalPages && !out.includes(n)) out.push(n);
    };
    out.push(1);
    for (let i = cur - 1; i <= cur + 1; i++) push(i);
    push(totalPages);
    return out.sort((a, b) => a - b);
  }, [totalPages, page]);

  return (
    <div className="browse-container">
      <div className="browse-header">
        <div className="browse-title">
          <div><h2>Khám phá phim ngắn</h2><p className="page-description">Chọn một bộ bạn thích, để câu chuyện tiếp diễn.</p></div>
        </div>
        <div className="browse-header-right">
          <label className="source-control">Nguồn<select className="input-field" aria-label="Nguồn phim ngắn" value={source} onChange={(e) => switchSource(e.target.value)}>{mediaSources.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
          <button className="btn btn-primary" onClick={() => onNavigate('download')}><Search size={15} />Tìm phim ngắn</button>
          <button className="btn btn-outline" disabled={loading || sourcesLoading} onClick={() => loadList(category, genre, page, true)}><RefreshCw size={15} />Làm mới danh sách</button>
          {meta.total > 0 && <span className="browse-stat">Tổng {meta.total} bộ</span>}
          {source === 'hongguo' && sourceUrl && <button className="btn btn-outline" onClick={showBrowser}>
            <ExternalLink size={15} />
            Mở trang nguồn
          </button>}
        </div>
      </div>

      {/* Tab danh mục */}
      {source === 'hongguo' && [false, true].map(ranking => {
        const group = (categories.length ? categories : [{ slug: 'real-drama', label: 'Phim người thật' }])
          .filter(c => c.slug.startsWith('hot-') === ranking);
        return group.length > 0 && <div className="browse-cats" role="group" aria-label={ranking ? 'Bảng xếp hạng hot' : 'Danh mục phim ngắn'} key={String(ranking)}>
        <span className="browse-nav-label">{ranking ? 'BXH hot' : 'Danh mục'}</span>
        {group.map((c) => (
          <button
            key={c.slug}
            className={`browse-cat ${category === c.slug ? 'active' : ''}`}
            aria-pressed={category === c.slug}
            onClick={() => switchCategory(c.slug)}
          >
            {translateGenre(c.label)}
          </button>
        ))}
      </div>;
      })}

      {sourcesError && <p className="browse-source-note" role="status">Cập nhật danh sách nguồn thất bại, tạm dùng danh sách cũ. Có thể lưu lại nguồn trong cài đặt rồi thử lại.</p>}
      {source.startsWith('custom:') && <p className="browse-source-note">Danh mục API từ {mediaSourceLabel(source, mediaSources)}, hiển thị theo thứ tự nguồn, không đại diện BXH hot.</p>}
      {source === 'xifan' && <p className="browse-source-note">Hiện cung cấp phân loại theo chủ đề, BXH hot của Tây Phạn chưa được tích hợp.</p>}

      {/* Chip chủ đề */}
      {meta.genres.length > 0 && (
        <div className="browse-genres">
          <button
            className={`genre-chip ${genre === '' ? 'active' : ''}`}
            onClick={() => switchGenre('')}
          >
            {source === 'xifan' ? 'Danh mục mặc định' : 'Tất cả'}
          </button>
          {meta.genres.map((g) => (
            <button
              key={g.slug}
              className={`genre-chip ${genre === g.slug ? 'active' : ''}`}
              onClick={() => switchGenre(g.slug)}
            >
              {translateGenre(g.label)}
            </button>
          ))}
        </div>
      )}

      <div className="browse-completion-filter">
        <label htmlFor="browse-completion">Trạng thái phim</label>
        <select id="browse-completion" className="input-field" value={completion} onChange={(event) => setCompletion(event.target.value)} aria-describedby="browse-completion-hint">
          <option value="all">Tất cả</option>
          <option value="completed">Đã hoàn thành</option>
          <option value="ongoing">Đang cập nhật</option>
        </select>
        <span id="browse-completion-hint">Chỉ lọc trang hiện tại; phim không ghi rõ trạng thái chỉ hiển thị ở "Tất cả".</span>
        {completion !== 'all' && <span role="status">Trang này {visibleResults.length} / {results.length} bộ</span>}
      </div>
      {!loading && !error && results.length > 0 && visibleResults.length === 0 && <div className="browse-filter-empty" role="status"><p>Trang này không có phim nào được đánh dấu rõ là {completion === 'completed' ? 'đã hoàn thành' : 'đang cập nhật'}.</p><button className="btn btn-outline" onClick={() => setCompletion('all')}>Hiển thị tất cả trang này</button></div>}

      {error && <div className="browse-error-state" role={unsupported ? 'status' : 'alert'}><Film size={36} /><h3>{unsupported ? 'Đây là truyện tranh đồ họa' : 'Tạm thời không tải được phim'}</h3><p>{error}</p><div className="search-empty-actions">{unsupported ? <button className="btn btn-primary" onClick={() => switchCategory('comic-drama')}>Xem phim hoạt họa</button> : <button className="btn btn-primary" onClick={() => loadList(category, genre, page, true)}><RefreshCw size={15} />Tải lại</button>}<button className="btn btn-outline" onClick={() => onNavigate('download')}>Tìm theo tên phim</button></div></div>}

      {loading && results.length > 0 && <div className="browse-loading" role="status"><RefreshCw size={18} className="spin" /><span>Đang cập nhật danh sách, vẫn có thể xem kết quả cũ…</span><button className="btn btn-outline btn-sm" onClick={cancelList}>Hủy tải</button></div>}

      {loading && results.length === 0 ? (
        <div className="browse-loading-state" role="status"><div className="browse-loading"><RefreshCw size={18} className="spin" /><span>Đang tải {translateGenre(categories.find((item) => item.slug === category)?.label) || 'phim ngắn'}…</span><button className="btn btn-outline btn-sm" onClick={cancelList}>Hủy tải</button></div><div className="poster-skeletons" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <div className="poster-skeleton" key={i}><div /><span /><span /></div>)}</div></div>
      ) : (
        <div className="browse-grid">
          {visibleResults.map((item) => {
            const dl = downloadedMap[String(item.series_id)];
            return (
              <button
                type="button"
                key={item.series_id}
                className="browse-card"
                onClick={() => openSeries(item)}
                title={item.series_title}
              >
                <div className="browse-cover">
                  {item.rank > 0 && <span className="browse-rank-badge">Hạng {item.rank}</span>}
                  {item.cover ? (
                    <img src={item.cover} alt={item.series_title} loading="lazy" />
                  ) : (
                    <div className="cover-placeholder"><Film size={22} /></div>
                  )}
                  {(item.episode_label || item.episode_count > 0) && (
                    <span className="browse-ep-badge">{item.episode_label || `${item.episode_count} tập`}</span>
                  )}
                  {dl && dl.completed > 0 && (
                    <span className="browse-dl-badge">
                      <Check size={11} /> {dl.completed}/{dl.total}
                    </span>
                  )}
                  <div className="browse-hover">
                    <span className="browse-hover-play">
                      <Play size={16} /> {dl && dl.completed > 0 ? 'Phát' : 'Xem'}
                    </span>
                  </div>
                </div>
                <div className="browse-card-title">{item.series_title}</div>
                {item.completion_status === 'completed' && <div className="browse-completion-label">Đã hoàn thành</div>}
                {item.completion_status === 'ongoing' && <div className="browse-completion-label">Đang cập nhật</div>}
                {item.heat && <div className="browse-card-heat">{item.heat}</div>}
                {item.tags && item.tags.length > 0 && (
                  <div className="browse-card-tags">
                    {item.tags.slice(0, 2).map((t) => (
                      <span key={t} className="browse-tag">{translateGenre(t)}</span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="browse-pager">
          <button className="pager-item" aria-label="Trang trước" disabled={page <= 1} onClick={() => gotoPage(page - 1)}>‹</button>
          {pageNumbers.map((n, i) => (
            <React.Fragment key={n}>
              {i > 0 && n - pageNumbers[i - 1] > 1 && <span className="pager-gap">…</span>}
              <button
                className={`pager-item ${n === page ? 'active' : ''}`}
                onClick={() => gotoPage(n)}
              >
                {n}
              </button>
            </React.Fragment>
          ))}
          <button className="pager-item" aria-label="Trang sau" disabled={page >= totalPages} onClick={() => gotoPage(page + 1)}>›</button>
        </div>
      )}

      {source !== 'hongguo' && !totalPages && (page > 1 || meta.hasMore) && <div className="browse-pager"><button className="pager-item" disabled={page <= 1 || loading} onClick={() => gotoPage(page - 1)}>Trang trước</button><span>Trang {page}</span><button className="pager-item" disabled={!meta.hasMore || loading} onClick={() => gotoPage(page + 1)}>Trang sau</button></div>}

      {/* ===== Ngăn kéo chi tiết phim ===== */}
      {(detail || detailLoading) && (
        <div className="browse-drawer-mask" onClick={closeDetail}>
          <div className="browse-drawer" role="dialog" aria-modal="true" aria-label="Chi tiết phim" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="browse-drawer-head">
              <div className="browse-drawer-title">
                <Film size={18} />
                <span>{detail ? `《${detail.series_title}》` : 'Đang tải…'}</span>
              </div>
              <button className="icon-btn" onClick={closeDetail} title="Đóng">
                <X size={16} />
              </button>
            </div>

            {detailLoading && (
              <div className="browse-loading">
                <RefreshCw size={18} className="spin" />
                <span>Đang lấy toàn bộ tập…</span>
              </div>
            )}

            {detail && (
              <>
                <div className="browse-drawer-body">
                  <div className="browse-drawer-info">
                    {detail.cover && <img src={detail.cover} alt="" className="browse-drawer-cover" />}
                    <div className="browse-drawer-meta">
                      <div className="browse-drawer-count">
                        {mediaSourceLabel(detail.series_id, mediaSources)} · Tổng {detail.total} tập · Đã tải <b>{detail.completedCount}</b> tập
                      </div>
                      {detail.web_accessible_episodes != null && detail.web_accessible_episodes < detail.total && (
                        <div className="browse-drawer-sub">Nguồn web cung cấp {detail.web_accessible_episodes} tập đầu, các tập sau sẽ tự động thử nguồn App.</div>
                      )}
                      {detail.episodes.some((ep) => ep.locked) && <div className="browse-drawer-sub">Các tập đánh dấu "khóa" cần mở khóa trên nền tảng nguồn, ứng dụng này không cung cấp mở khóa.</div>}
                      <div className="browse-drawer-sub">Đã chọn {selectedIdx.size} tập để tải</div>
                      <div className="browse-range-row">
                        <input
                          type="text"
                          className="input-field"
                          aria-label="Chọn khoảng tập"
                          placeholder="Khoảng, ví dụ 1-50 hoặc 1,3,5"
                          value={rangeInput}
                          onChange={(e) => { setRangeInput(e.target.value); setRangeError(''); }}
                          onKeyDown={(e) => isSubmitKey(e) && applyRange(rangeInput)}
                        />
                        <button className="btn btn-outline btn-sm" onClick={() => applyRange(rangeInput)}>Áp dụng</button>
                      </div>
                      {rangeError && <p className="alert alert-error" role="alert">{rangeError}</p>}
                      <div className="preset-row mt8">
                        <button className="btn-chip" onClick={() => applyRange(`1-${Math.min(10, detail.total)}`)}>10 tập đầu</button>
                        <button className="btn-chip" onClick={() => applyRange(`1-${Math.min(30, detail.total)}`)}>30 tập đầu</button>
                        <button className="btn-chip" onClick={() => applyRange(`${Math.max(1, detail.total - 29)}-${detail.total}`)}>30 tập cuối</button>
                        <button className="btn-chip" onClick={() => setSelectedIdx(new Set(detail.episodes.filter((e) => !e.locked).map((e) => e.vid_index)))}>Chọn tất cả</button>
                        <button className="btn-chip" onClick={() => setSelectedIdx(new Set())}>Xóa hết</button>
                      </div>
                    </div>
                  </div>

                  <div className="browse-eps">
                    {detail.episodes.map((ep) => (
                      <button
                        disabled={ep.locked === true}
                        aria-pressed={selectedIdx.has(ep.vid_index)}
                        key={ep.vid_index}
                        className={`ep-chip ep-${ep.status} ${selectedIdx.has(ep.vid_index) ? 'ep-picked' : ''}`}
                        onClick={() => toggleIdx(ep.vid_index)}
                        title={ep.locked ? 'Cần mở khóa trên nền tảng nguồn' : ep.title || `Tập ${ep.vid_index}`}
                      >
                        <span className="ep-num">{ep.vid_index}</span>{ep.locked && <span className="ep-lock-label">Khóa</span>}
                        {ep.status === 'completed' && <Check size={11} className="ep-badge" />}
                        {selectedIdx.has(ep.vid_index) && <span className="ep-pick-dot" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="browse-drawer-foot">
                  <button className="btn btn-outline" disabled={!detail.episodes.some((ep) => !ep.locked)} onClick={playNow}>
                    <Play size={15} />
                    Phát ngay
                  </button>
                  <div className="browse-foot-right">
                    <button
                      className="btn btn-primary"
                      disabled={submitting || selectedIdx.size === 0}
                      onClick={downloadSelected}
                    >
                      <Download size={15} />
                      Tải mục đã chọn ({selectedIdx.size})
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className={`dm-toast dm-toast-${toast.type}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default Browse;
