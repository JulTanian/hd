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
  const media = { paused: true, ended: false, currentTime: 12, duration: 100, muted: false, volume: 0.7,
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
  props.autoContinue = true; render();
  media.ended = true; media.pause(); render();
  assert.ok(hidden(), 'end-of-episode pause before ended must not reveal controls when auto-next is available');
  props.continuing = true; props.autoContinue = false; props.available = false; render();
  assert.ok(hidden(), 'online preparation must retain hidden controls, including transition into the final episode');
  props.source = 'two'; props.available = true; media.ended = false;
  listeners.get('emptied')?.(); render();
  assert.ok(hidden(), 'loading the next source must not reveal controls');
  listeners.get('loadedmetadata')?.(); render();
  assert.ok(hidden(), 'metadata while paused must not reveal controls during auto-next');
  await media.play(); props.continuing = false; render();
  assert.ok(hidden(), 'starting the next episode must retain hidden controls');
  stageListeners.get('pointermove')(); render(); assert.ok(!hidden(), 'moving the pointer reveals controls');
  advance(); render(); assert.ok(hidden());
  media.ended = true; media.pause(); render();
  assert.ok(!hidden(), 'last episode or disabled auto-next restores controls at the end');
  media.ended = false; await media.play(); render(); advance(); render();
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
  props.continuing = true; props.available = false; media.pause(); render();
  assert.ok(hidden(), 'window fill keeps controls hidden while auto-next prepares');
  props.continuing = false; props.autoContinue = true; media.ended = true; listeners.get('ended')?.(); render();
  assert.ok(!hidden(), 'failed auto-next restores controls even when the retained frame ended and later episodes exist');
  props.available = false; render(); render(); assert.ok(!hidden(), 'unavailable media keeps controls visible');
  media.pause(); render();

  media.duration = NaN; listeners.get('durationchange')(); render(); assert.equal(find('播放进度').props.disabled, true);
  props.available = false; render(); assert.equal(find('播放').props.disabled, true);
  cleanups.forEach(fn => fn?.()); assert.equal(listeners.size, 0); assert.equal(documentListeners.size, 0); assert.equal(stageListeners.size, 0); assert.equal(windowListeners.size, 0); assert.equal(timers.size, 0);
  const { mount } = require('./check-player-resume.cjs');
  const controls = ui => ui.find(node => node.props.onRateChange && node.props.videoRef);
  for (const local of [true, false]) {
    let finishNext;
    const ui = mount({ local, props: { setEpisodesOpen() {}, target: { seriesId: 'A', vidIndex: 1, ts: 1 } }, prepare: p => p.vidIndex === 1 ? { success: true, url: 'mock:first' } : new Promise(resolve => { finishNext = resolve; }) });
    await ui.flush(); ui.metadata(); await ui.flush();
    assert.equal(controls(ui).props.autoContinue, true, 'parent marks whether an unlocked next episode can follow');
    ui.find(node => node.type === 'video').props.onEnded(); await ui.flush();
    assert.equal(controls(ui).props.continuing, true, `parent retains auto-next intent through source preparation (local=${local})`);
    assert.equal(controls(ui).props.autoContinue, false, 'final episode has no following episode');
    if (!local) { finishNext({ success: true, url: 'mock:second' }); await ui.flush(); }
    assert.equal(controls(ui).props.continuing, true, 'auto-next intent remains until playback actually starts');
    ui.metadata(); await ui.flush();
    assert.equal(controls(ui).props.continuing, false, 'playing clears the transition so later manual pause is visible');
    ui.unmount();
  }
  const failed = mount({ props: { setEpisodesOpen() {}, target: { seriesId: 'A', vidIndex: 1, ts: 1 } }, prepare: p => p.vidIndex === 1 ? { success: true, url: 'mock:first' } : { success: false, error: 'test preparation failure' } });
  await failed.flush(); failed.metadata(); await failed.flush();
  failed.find(node => node.type === 'video').props.onEnded(); await failed.flush();
  assert.equal(controls(failed).props.continuing, false, 'failed online preparation must restore ordinary pause behavior');
  failed.unmount();
  const blocked = mount({ local: true, props: { setEpisodesOpen() {} } });
  await blocked.flush(); blocked.metadata(); await blocked.flush();
  blocked.find(node => node.type === 'video').props.onEnded(); await blocked.flush();
  blocked.media.play = async () => { throw new Error('test autoplay denied'); };
  blocked.metadata(); await blocked.flush();
  assert.equal(controls(blocked).props.continuing, false, 'autoplay rejection must leave the play control accessible');
  blocked.unmount();
  console.log('PASS video controls: play/pause, seek, volume, lower-right 4× menu, fullscreen idle/reveal, auto-next pause/preparing/source/metadata/play continuity, local/online parent wiring, failure/end recovery, pause/menu/drag/focus guards, portrait and exit cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
