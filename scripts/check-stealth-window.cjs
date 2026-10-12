const assert = require('node:assert/strict');
const { createStealthController } = require('../src/native/stealth-window');
let tick, cursor = { x: 600, y: 200 };
const interval = global.setInterval, clear = global.clearInterval;
global.setInterval = callback => { tick = callback; return { unref() {} }; };
global.clearInterval = () => { tick = null; };
try {
  const original = { x: 100, y: 100, width: 1100, height: 750 };
  let bounds = { ...original }, minimum = [900, 620], opacity = 1, top = false;
  const messages = [];
  const win = {
    isDestroyed: () => false, isMaximized: () => false, isMinimized: () => false,
    getNormalBounds: () => ({ ...bounds }), getBounds: () => bounds,
    getMinimumSize: () => [...minimum], isAlwaysOnTop: () => top,
    setMinimumSize: (...next) => { minimum = next; }, setBounds: next => { bounds = next; },
    setAlwaysOnTop: value => { top = value; }, setOpacity: value => { opacity = value; },
    setFullScreenable() {}, webContents: { send: (name, state) => messages.push({ name, ...state }) },
  };
  const controller = createStealthController({ getWindow: () => win, screen: {
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  } });
  controller.setEnabled(true);
  assert(controller.enabled && top);
  assert.equal(bounds.width, 400);
  tick(); assert.equal(opacity, 1);
  cursor = { x: 0, y: 0 }; tick();
  assert.equal(opacity, 0); assert.equal(messages.at(-1).concealed, true);
  const count = messages.length; tick(); assert.equal(messages.length, count);
  cursor = { x: bounds.x + 100, y: bounds.y + 100 }; tick();
  assert.equal(opacity, 1); assert.equal(messages.at(-1).concealed, false);
  controller.setEnabled(false);
  assert.deepEqual(bounds, original); assert.deepEqual(minimum, [900, 620]);
  assert.equal(top, false); assert.equal(tick, null); assert.equal(controller.enabled, false);
  controller.setEnabled(true); controller.dispose(); assert.equal(tick, null);
  console.log('PASS stealth window: bounds, conceal/reveal, original state restoration, cleanup');
} finally { global.setInterval = interval; global.clearInterval = clear; }
