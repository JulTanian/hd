// No network, browser, media or real timers. Run: node scripts/check-download-manager.cjs [name].
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

function mount(api = {}, props = {}) {
  const slots = [], effects = [], cleanups = [], events = new Map(), timers = new Map();
  let cursor = 0, tree, timerId = 0, writes = 0, dialogOpen;
  const changed = (old, deps) => !old || deps.some((d, i) => !Object.is(d, old[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { writes++; slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo: (fn, deps) => { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useEffect: (fn, deps) => { const i = cursor++; if (changed(slots[i], deps)) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const defaults = { getDownloadTasks: async () => [], getSeriesList: async () => [], getMergeTasks: async () => [], getQueueStatus: async () => ({ active: 0, queued: 0, maxConcurrent: 3 }) };
  const window = { electronAPI: new Proxy({ ...defaults, ...api }, { get: (obj, key) => obj[key] || (key.startsWith('on') ? fn => { events.set(key, fn); return () => events.delete(key); } : async () => ({ success: true })) }) };
  const setTimer = (fn, delay, interval = false) => { const id = ++timerId; timers.set(id, { fn, delay, interval }); return id; };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync(`${__dirname}/../src/components/DownloadManager.jsx`, 'utf8'), { loader: 'jsx', format: 'cjs' }).code, {
    module, exports: module.exports, require: name => name === 'react' ? react : name === './useDialogKeyboard' ? open => { dialogOpen = open; } : {}, window,
    document: { querySelector: () => null }, console, setTimeout: (fn, delay) => setTimer(fn, delay), clearTimeout: id => timers.delete(id), setInterval: (fn, delay) => setTimer(fn, delay, true), clearInterval: id => timers.delete(id),
  });
  const render = () => { cursor = 0; tree = module.exports.default(props); effects.splice(0).forEach(fn => fn()); };
  const nodes = () => { const out = []; const walk = n => { if (!n || typeof n !== 'object') return; out.push(n); n.children?.forEach(walk); }; walk(tree); return out; };
  const textOf = n => typeof n === 'string' || typeof n === 'number' ? String(n) : n?.children?.map(textOf).join('') || '';
  const find = predicate => nodes().find(predicate);
  render();
  return {
    render, find, nodes, text: () => textOf(tree), button: label => find(n => n.type === 'button' && textOf(n).includes(label)),
    flush: async () => { for (let i = 0; i < 25; i++) { await Promise.resolve(); render(); } },
    advance: ms => { for (const [id, timer] of [...timers]) if (timer.delay <= ms && timers.has(id)) { if (!timer.interval) timers.delete(id); timer.fn(); } },
    emit: (name, data) => events.get(name)?.(data), setProps: next => { props = { ...props, ...next }; render(); },
    writes: () => writes, dialogOpen: () => dialogOpen, intervals: () => [...timers.values()].filter(t => t.interval).length,
    unmount: () => cleanups.forEach(fn => fn?.()),
  };
}
const task = (i, status = 'downloading') => ({ id: `t${i}`, title: `第${i}集`, status, progress: 0, startTime: i, hongguoInfo: { series_id: 'A', vid_index: i } });
const rows = ui => ui.nodes().filter(n => /^dm-task(?: selected)?$/.test((n.props.className || '').trim()));
const runningMerge = () => ({ id: 'm', status: 'running', total: 2, done: 0, progress: 0, seriesTitle: 'A', startTime: Date.now() });

(async () => {
  let failures = 0, passed = 0;
  const test = async (name, fn) => { if (process.argv[2] && !new RegExp(process.argv[2]).test(name)) return; try { await fn(); passed++; } catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); } };
  await test('one initial snapshot and no polling or focus trap while hidden', async () => {
    let calls = 0;
    const ui = mount({ getDownloadTasks: async () => { calls++; return [task(1)]; } });
    await ui.flush(); assert.equal(calls, 1, 'initial effects must not request duplicate snapshots');
    ui.find(n => n.props.title?.startsWith('删除任务')).props.onClick(); ui.render(); assert.equal(ui.dialogOpen(), true);
    ui.setProps({ active: false }); const before = calls; ui.advance(20000); await ui.flush();
    assert.equal(ui.intervals(), 0); assert.equal(calls, before); assert.equal(ui.dialogOpen(), false);
    const writes = ui.writes(); ui.emit('onDownloadProgress', { id: 't1', progress: 98 }); ui.advance(250); await ui.flush();
    assert.equal(ui.writes(), writes, 'hidden page must ignore high frequency task events'); ui.unmount();
  });
  await test('reactivation refreshes newly registered series and removes stale selection', async () => {
    let list = [{ series_id: 'A', series_title: 'Old' }];
    const ui = mount({ getSeriesList: async () => list }); await ui.flush();
    ui.setProps({ active: false }); list = [{ series_id: 'B', series_title: 'New' }]; ui.setProps({ active: true }); await ui.flush();
    const select = ui.find(n => n.type === 'select' && n.props.className?.includes('merge-select'));
    assert.equal(select.props.value, 'B'); assert.ok(ui.text().includes('New')); assert.ok(!ui.text().includes('Old')); ui.unmount();
  });
  await test('progress events coalesce into one task update and keep the latest value', async () => {
    const ui = mount({ getDownloadTasks: async () => [task(1)] }); await ui.flush(); const before = ui.writes();
    for (let progress = 1; progress <= 80; progress++) ui.emit('onDownloadProgress', { id: 't1', progress });
    assert.equal(ui.writes(), before, 'progress must wait for one short batch'); ui.advance(250); await ui.flush();
    assert.equal(ui.writes() - before, 1); assert.ok(ui.text().includes('80%')); ui.unmount();
  });
  await test('select-all covers every page and clears every selection', async () => {
    const ui = mount({ getDownloadTasks: async () => Array.from({ length: 205 }, (_, i) => task(i + 1, 'completed')) }); await ui.flush();
    const all = ui.button('全选'); assert.ok(all, 'select-all must be visible beside task counts'); all.props.onClick(); ui.render();
    assert.ok(ui.text().includes('已选 205 项')); assert.ok(rows(ui).every(r => r.props.className.includes('selected')));
    ui.button('下一页').props.onClick(); ui.render(); ui.button('下一页').props.onClick(); ui.render();
    assert.equal(rows(ui).length, 5); assert.ok(rows(ui).every(r => r.props.className.includes('selected')));
    ui.button('取消全选').props.onClick(); ui.render(); assert.ok(rows(ui).every(r => !r.props.className.includes('selected'))); assert.equal(ui.button('删除已选').props.disabled, true);
    rows(ui)[0].props.onClick(); ui.render(); ui.button('全选').props.onClick(); ui.render(); assert.ok(ui.text().includes('已选 205 项')); ui.unmount();
  });
  await test('whole-series merge needs no checked tasks and identifies its series', async () => {
    let sent;
    const ui = mount({ getDownloadTasks: async () => [task(1, 'completed'), task(2, 'completed')], getSeriesList: async () => [{ series_id: 'A', series_title: '整部示例剧' }], mergeSeries: async (...args) => { sent = args; return { success: true, count: 2, totalBytes: 1000 }; } }); await ui.flush();
    assert.ok(ui.text().includes('无需勾选任务')); const merge = ui.button('合并整部剧'); assert.ok(merge); assert.equal(!!merge.props.disabled, false);
    merge.props.onClick(); ui.render(); assert.ok(ui.text().includes('《整部示例剧》')); assert.ok(ui.text().includes('全部已下载分集'));
    await ui.button('智能快速合并').props.onClick(); await ui.flush(); assert.equal(sent[0], 'A'); assert.equal(sent[2].compatible, false); ui.unmount();
  });
  await test('task list pages at 100 while global totals and cross-page selections persist', async () => {
    const ui = mount({ getDownloadTasks: async () => Array.from({ length: 205 }, (_, i) => task(i + 1, 'completed')) }); await ui.flush();
    assert.equal(rows(ui).length, 100); assert.ok(ui.text().includes('已完成 205'));
    rows(ui)[0].props.onClick(); ui.render(); ui.button('下一页').props.onClick(); ui.render(); assert.equal(rows(ui).length, 100);
    rows(ui)[0].props.onClick(); ui.render(); ui.button('删除已选').props.onClick(); ui.render(); assert.ok(ui.text().includes('共 2 个任务'));
    ui.button('取消').props.onClick(); ui.render(); ui.button('下一页').props.onClick(); ui.render(); assert.equal(rows(ui).length, 5); ui.unmount();
  });
  for (const rejected of [false, true]) await test(`delete ${rejected ? 'rejection' : 'failure response'} is visible and preserves selection`, async () => {
    const ui = mount({ getDownloadTasks: async () => [task(1, 'completed')], deleteTasksWithFiles: async () => { if (rejected) throw new Error('删除失败示例'); return { success: false, error: '删除失败示例' }; } });
    await ui.flush(); rows(ui)[0].props.onClick(); ui.render(); ui.button('删除已选').props.onClick(); ui.render();
    await assert.doesNotReject(() => ui.button('仅删除记录').props.onClick(), 'delete rejection must become visible feedback'); await ui.flush();
    assert.ok(ui.text().includes('删除失败示例')); assert.ok(rows(ui)[0].props.className.includes('selected')); ui.unmount();
  });
  await test('merge cancellation only acknowledges the request and exposes failure', async () => {
    let fail = false;
    const ui = mount({ getMergeTasks: async () => [runningMerge()], cancelMerge: async () => fail ? { success: false, error: '取消请求失败' } : { success: true } }); await ui.flush();
    await ui.find(n => n.props.title === '取消合并').props.onClick(); await ui.flush();
    assert.ok(!ui.text().includes('已取消合并')); assert.ok(ui.text().includes('取消请求'));
    fail = true; await ui.find(n => n.props.title === '取消合并').props.onClick(); await ui.flush(); assert.ok(ui.text().includes('取消请求失败')); ui.unmount();
  });
  await test('unknown merge duration does not claim zero minutes', async () => {
    const ui = mount({ getSeriesList: async () => [{ series_id: 'A', series_title: 'A' }], mergeSeries: async () => ({ success: true, count: 2, totalBytes: 100000, totalDuration: 0 }) }); await ui.flush();
    ui.button('合并整部剧').props.onClick(); ui.render(); await ui.button('智能快速合并').props.onClick(); await ui.flush();
    assert.ok(!ui.text().includes('0 分钟')); assert.ok(ui.text().includes('开始合并 2 集')); ui.unmount();
  });
  console.log(`Download manager: ${passed} passed, ${failures} failed`); process.exitCode = failures ? 1 : 0;
})();
