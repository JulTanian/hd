const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const source = transformSync(fs.readFileSync(path.join(__dirname, '../src/components/PlayerControls.jsx'), 'utf8'), { loader: 'jsx', format: 'cjs' }).code;

(async () => {
  const slots = [], effects = [], cleanups = [], listeners = new Map(), documentListeners = new Map(), stageListeners = new Map(), windowListeners = new Map(), timers = new Map();
  let nextTimer = 0, keyboardFocus = false;
  const advance = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  let needsRender = false;
  let cursor = 0, tree, plays = 0, pauses = 0, fullscreenCalls = 0, selectedRate;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(slots[i], next)) needsRender = true; slots[i] = next; }]; },
    useRef: value => { const i = cursor++; return slots[i] ||= { current: value }; },
    useEffect: (fn, deps) => { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i][j])) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const media = { paused: true, currentTime: 12, duration: 100, muted: false, volume: 0.7,
    play: async () => { plays++; media.paused = false; listeners.get('play')?.(); },
    pause: () => { pauses++; media.paused = true; listeners.get('pause')?.(); },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const document = { fullscreenElement: null, addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name), exitFullscreen: async () => { document.fullscreenElement = null; documentListeners.get('fullscreenchange')?.(); } };
  const stage = { addEventListener: (name, fn) => stageListeners.set(name, fn), removeEventListener: name => stageListeners.delete(name), requestFullscreen: async () => { fullscreenCalls++; document.fullscreenElement = stage; documentListeners.get('fullscreenchange')?.(); } };
  const props = { videoRef: { current: media }, stageRef: { current: stage }, source: 'one', available: true, rate: 1, onRateChange: rate => { selectedRate = rate; } };
  const context = { module: { exports: {} }, document, window: { addEventListener: (name, fn) => windowListeners.set(name, fn), removeEventListener: name => windowListeners.delete(name) }, setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id), require: name => name === 'react' ? react : {} };
  context.exports = context.module.exports; vm.runInNewContext(source, context);
  const nodes = () => { const out = []; const visit = node => { if (!node || typeof node !== 'object') return; out.push(node); node.children?.forEach(visit); }; visit(tree); return out; };
  const find = label => nodes().find(node => node.props['aria-label'] === label);
  const render = () => { do { needsRender = false; cursor = 0; tree = context.module.exports.default(props); for (const node of nodes()) if (node.props.ref) node.props.ref.current = { contains: target => target === node, focus() {}, querySelector: () => keyboardFocus ? {} : null }; effects.splice(0).forEach(fn => fn()); } while (needsRender); };
  render(); render();
  assert.equal(find('播放进度').props.max, 100); assert.equal(find('播放进度').props.value, 12);
  await find('播放').props.onClick(); render(); assert.equal(plays, 1); assert.ok(find('暂停'));
  find('暂停').props.onClick(); render(); assert.equal(pauses, 1);
  find('播放进度').props.onChange({ target: { value: '37.5' } }); assert.equal(media.currentTime, 37.5);
  find('静音').props.onClick(); listeners.get('volumechange')?.(); render(); assert.equal(media.muted, true); assert.ok(find('取消静音'));
  find('音量').props.onChange({ target: { value: '0.4' } }); assert.equal(media.volume, 0.4); assert.equal(media.muted, false);
  assert.equal(find('播放速度'), undefined, 'speed belongs in the lower-right menu');
  assert.ok(find('增加播放速度'), 'speed number must be an independent button');
  find('增加播放速度').props.onClick(); render(); assert.equal(selectedRate, 1.25); assert.equal(find('播放速度'), undefined);
  props.rate = 3.75; render(); find('增加播放速度').props.onClick(); assert.equal(selectedRate, 4);
  props.rate = 4; render(); find('增加播放速度').props.onClick(); assert.equal(selectedRate, 1);
  find('更多播放选项').props.onClick(); render(); assert.ok(find('播放速度'));
  assert.deepEqual(find('播放速度').children.map(node => node.props.value), Array.from({ length: 16 }, (_, i) => (i + 1) / 4));
  find('播放速度').props.onChange({ target: { value: '4' } }); assert.equal(selectedRate, 4);
  documentListeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); render(); assert.equal(find('播放速度'), undefined);
  find('更多播放选项').props.onClick(); render(); documentListeners.get('pointerdown')({ target: {} }); render(); assert.equal(find('播放速度'), undefined);
  await find('全屏').props.onClick(); render(); assert.equal(fullscreenCalls, 1); assert.ok(find('退出全屏'));
  await find('播放').props.onClick(); render(); advance(); render();
  const hidden = () => tree.props.className.includes('controls-hidden');
  assert.ok(hidden(), 'playing in landscape fullscreen must hide idle controls');
  stageListeners.get('pointermove')(); render(); assert.ok(!hidden(), 'moving the pointer reveals controls');
  advance(); render(); assert.ok(hidden());
  media.pause(); render(); assert.ok(!hidden(), 'pausing keeps controls visible');
  await media.play(); render();
  find('更多播放选项').props.onClick(); render(); advance(); render(); assert.ok(!hidden(), 'open menu prevents hiding');
  find('更多播放选项').props.onClick(); render();
  stageListeners.get('pointerdown')({ target: { closest: () => ({}) } }); advance(); render(); assert.ok(!hidden(), 'dragging prevents hiding');
  windowListeners.get('pointerup')(); advance(); render(); assert.ok(hidden(), 'releasing the slider restarts hiding');
  keyboardFocus = true; stageListeners.get('focusin')(); advance(); render(); assert.ok(!hidden(), 'keyboard focus remains visible');
  keyboardFocus = false; stageListeners.get('focusout')(); advance(); render(); assert.ok(hidden());
  await find('退出全屏').props.onClick(); render(); render(); assert.equal(document.fullscreenElement, null);
  assert.ok(!hidden(), 'exiting fullscreen restores controls');
  advance(); render(); assert.ok(!hidden(), 'normal landscape controls stay visible');
  props.portrait = true; render(); advance(); render(); assert.ok(hidden(), 'portrait retains auto-hide');
  props.windowFill = true; props.onWindowFill = value => { props.windowFill = value; }; render();
  stageListeners.get('pointermove')(); render(); assert.ok(!hidden()); advance(); render(); assert.ok(hidden(), 'window fill auto-hides');
  props.available = false; render(); render(); assert.ok(!hidden(), 'unavailable media keeps controls visible');
  media.pause(); render();

  media.duration = NaN; listeners.get('durationchange')(); render(); assert.equal(find('播放进度').props.disabled, true);
  props.available = false; render(); assert.equal(find('播放').props.disabled, true);
  cleanups.forEach(fn => fn?.()); assert.equal(listeners.size, 0); assert.equal(documentListeners.size, 0); assert.equal(stageListeners.size, 0); assert.equal(windowListeners.size, 0); assert.equal(timers.size, 0);
  console.log('PASS video controls: play/pause, seek, volume, lower-right 4× menu, fullscreen idle/reveal, pause/menu/drag/focus guards, portrait and exit cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
