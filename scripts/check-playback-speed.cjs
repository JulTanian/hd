const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');

(async () => {
  const ui = mount({ local: true });
  await ui.flush(); ui.metadata();
  const select = () => ui.find(n => n.type === 'select' && n.props['aria-label'] === '播放速度');
  const video = () => ui.find(n => n.type === 'video');
  const key = (value, extra = {}) => ui.events.get('keydown')({ key: value, target: { closest: () => null }, preventDefault() {}, ...extra });
  assert.ok(select(), 'player needs a speed selector');
  assert.deepEqual(select().children.map(n => n.props.value), Array.from({ length: 16 }, (_, i) => (i + 1) / 4));
  select().props.onChange({ target: { value: '4' } }); ui.render();
  assert.equal(ui.media.playbackRate, 4); assert.equal(ui.media.defaultPlaybackRate, 4);
  key('d'); assert.equal(ui.media.playbackRate, 4);
  key('s'); assert.equal(ui.media.playbackRate, 3.75);
  for (let i = 0; i < 20; i++) key('s');
  assert.equal(ui.media.playbackRate, 0.25);
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'isComposing']) {
    key('d', { [modifier]: true }); assert.equal(ui.media.playbackRate, 0.25, `${modifier} must suppress shortcuts`);
  }
  key('d', { target: { closest: () => ({}) } }); assert.equal(ui.media.playbackRate, 0.25, 'editing controls must suppress shortcuts');
  key('d', { target: { isContentEditable: true, closest: () => null } }); assert.equal(ui.media.playbackRate, 0.25, 'inherited editable targets must suppress shortcuts');
  key('d'); ui.render(); assert.equal(select().props.value, 0.5);
  select().props.onChange({ target: { value: '3.5' } }); ui.render();
  video().props.onEnded(); await ui.flush();
  ui.media.playbackRate = 1; video().props.onRateChange({ currentTarget: ui.media });
  ui.metadata(); ui.render();
  assert.equal(ui.media.playbackRate, 3.5, 'auto-next must restore selected speed after media load');
  assert.equal(ui.media.defaultPlaybackRate, 3.5);
  ui.media.playbackRate = 2.5; video().props.onRateChange({ currentTarget: ui.media }); ui.render();
  assert.equal(select().props.value, 2.5, 'native rate menu must update selector');
  assert.equal(ui.media.defaultPlaybackRate, 2.5);
  ui.episode(1); await ui.flush(); ui.metadata(); assert.equal(ui.media.playbackRate, 2.5);
  ui.props.active = false; ui.render(); assert.equal(ui.events.has('keydown'), false);
  ui.unmount();

  const history = mount({ saved: { vid_index: 2, currentTime: 37 }, props: { target: { seriesId: 'A', vidIndex: 2, resume: true, ts: 1 } } });
  await history.flush(); assert.equal(history.saves.length, 0, 'preparing a stream must not create a watched entry');
  history.metadata(); assert.equal(history.media.currentTime, 37, 'history resume must preserve saved second');
  assert.ok(history.saves.some(row => row[1] === 2 && row[2] === 37), 'real play must save the watched entry');
  history.unmount();
  const buffering = mount({ local: true });
  await buffering.flush();
  buffering.media.play = async () => { buffering.find(n => n.type === 'video').props.onPlay({ currentTarget: buffering.media }); };
  buffering.metadata(); buffering.find(n => n.type === 'video').props.onPause(); buffering.unmount();
  assert.equal(buffering.saves.length, 0, 'play intent without playing must not create watched history');
  const blocked = mount({ local: true });
  await blocked.flush(); blocked.media.play = async () => { throw new Error('autoplay blocked'); };
  blocked.metadata(); blocked.find(n => n.type === 'video').props.onPause();
  blocked.episode(2); await blocked.flush(); blocked.metadata(); blocked.unmount();
  assert.equal(blocked.saves.length, 0, 'metadata, failed play, pause and switching must not count as watched');
  console.log('PASS playback speed range, shortcuts, native sync, episode continuity and real-play history');
})().catch(error => { console.error(error); process.exitCode = 1; });
