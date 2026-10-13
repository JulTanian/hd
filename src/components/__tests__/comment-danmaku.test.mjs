import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../danmakuModel.mjs';
import { DEFAULT_DANMAKU_SETTINGS, normalizeDanmakuSettings, advanceDanmaku } from '../danmakuModel.mjs';

test('settings reject malformed storage and clamp supported numeric values', () => {
  assert.deepEqual(normalizeDanmakuSettings(null), DEFAULT_DANMAKU_SETTINGS);
  assert.deepEqual(normalizeDanmakuSettings({ opacity: -1, fontSize: 200, speed: NaN, area: 'unsafe', density: 'many' }),
    { opacity: 20, fontSize: 32, speed: 1, area: 'half', density: 'normal', sensitiveFilter: true, blockedWords: '' });
  assert.equal(normalizeDanmakuSettings({ opacity: '80' }).opacity, 80);
  assert.equal(normalizeDanmakuSettings({ opacity: null }).opacity, 80);
});

test('scheduler bounds lanes, avoids overlaps, pauses and clamps long frame gaps', () => {
  const state = { items: [], cursor: 0, nextId: 0, cooldown: 0 };
  const options = { width: 500, height: 300, settings: DEFAULT_DANMAKU_SETTINGS, reducedMotion: false };
  for (let i = 0; i < 600; i++) {
    advanceDanmaku(state, ['短评论', '长'.repeat(79)], 0.1, options);
    assert.ok(state.items.length <= 3);
    assert.equal(new Set(state.items.map(item => item.lane)).size, state.items.length);
  }
  const fresh = Array.from({ length: 100 }, (_, index) => String(index));
  advanceDanmaku(state, fresh, 0.1, options);
  const x = state.items[0].x;
  advanceDanmaku(state, fresh, 0, options);
  assert.equal(state.items[0].x, x);
  advanceDanmaku(state, fresh, 100, options);
  assert.ok(x - state.items[0].x <= 34);
});

test('reduced motion keeps one stationary comment and replaces it after reading time', () => {
  const state = { items: [], cursor: 0, nextId: 0, cooldown: 0 };
  const options = { width: 500, height: 300, settings: DEFAULT_DANMAKU_SETTINGS, reducedMotion: true };
  advanceDanmaku(state, ['一', '二'], 0.1, options);
  const firstId = state.items[0].id;
  for (let i = 0; i < 70; i++) advanceDanmaku(state, ['一', '二'], 0.1, options);
  assert.equal(state.items.length, 1);
  assert.notEqual(state.items[0].id, firstId);
  assert.equal(state.items[0].x, 12);
});


test('consumed comments never loop and appended pages continue from current position', () => {
  const state = { items: [], cursor: 0, nextId: 0, cooldown: 0 };
  const options = { width: 500, height: 300, settings: DEFAULT_DANMAKU_SETTINGS, reducedMotion: true };
  for (let i = 0; i < 200; i++) advanceDanmaku(state, ['first', 'second'], 0.1, options);
  assert.equal(state.cursor, 2);
  assert.equal(state.items.length, 0);
  advanceDanmaku(state, ['first', 'second', 'third'], 0.1, options);
  assert.equal(state.items[0].text, 'third');
});

test('paged feed deduplicates IDs and stops on unchanged or cycling cursors', () => {
  assert.equal(typeof model.createCommentFeed, 'function');
  const feed = model.createCommentFeed('123456', '654321');
  const page = (items, next_cursor, has_more = true) => ({ success: true, series_id: '123456', episode_id: '654321', items, next_cursor, has_more });
  model.appendCommentPage(feed, page([{ id: '1', content: 'one' }], 'next'), DEFAULT_DANMAKU_SETTINGS);
  model.appendCommentPage(feed, page([{ id: '1', content: 'one' }, { id: '2', content: 'two' }], 'next'), DEFAULT_DANMAKU_SETTINGS);
  assert.equal(feed.comments.length, 2);
  assert.equal(feed.hasMore, false);
  assert.match(feed.notice, /游标/);
  const other = model.createCommentFeed('123456', '654321');
  assert.throws(() => model.appendCommentPage(other, { ...page([], null, false), episode_id: '999999' }, DEFAULT_DANMAKU_SETTINGS));
  assert.equal(other.comments.length, 0);
  model.appendCommentPage(other, page([], 'a'), DEFAULT_DANMAKU_SETTINGS);
  model.appendCommentPage(other, page([], 'b'), DEFAULT_DANMAKU_SETTINGS);
  model.appendCommentPage(other, page([], 'a'), DEFAULT_DANMAKU_SETTINGS);
  assert.equal(other.hasMore, false);
});

test('filter checks full comment before shortening; custom words work with built-in filter disabled', () => {
  assert.equal(typeof model.commentIsBlocked, 'function');
  assert.equal(model.commentIsBlocked('普通内容'.repeat(30) + '台独', DEFAULT_DANMAKU_SETTINGS), true);
  const settings = normalizeDanmakuSettings({ sensitiveFilter: false, blockedWords: '  MyWORD\n自定义词  ' });
  assert.equal(model.commentIsBlocked('含有 myword 的评论', settings), true);
  assert.equal(model.commentIsBlocked('含有台独的评论', settings), false);
  const state = { items: [], cursor: 0, nextId: 0, cooldown: 0 };
  advanceDanmaku(state, [{ content: '普通内容'.repeat(30) + '台独' }, { content: '正常评论' }], 0.1,
    { width: 500, height: 300, settings: DEFAULT_DANMAKU_SETTINGS, reducedMotion: true });
  assert.equal(state.items[0].text, '正常评论');
  assert.equal(state.cursor, 2);
});

test('fully filtered pages can advance, but five empty pages stop until user continues', () => {
  assert.equal(typeof model.createCommentFeed, 'function');
  const feed = model.createCommentFeed('123456', '654321');
  for (let i = 0; i < 5; i++) model.appendCommentPage(feed, { success: true, series_id: '123456', episode_id: '654321',
    items: [{ id: String(i), content: '台独' }], next_cursor: String(i + 1), has_more: true }, DEFAULT_DANMAKU_SETTINGS);
  assert.equal(feed.hasMore, true);
  assert.equal(feed.cursor, '5');
  assert.equal(feed.emptyPages, 5);
  assert.ok(feed.error);
});


test('limited source preserves the exact limitation and full text until display', () => {
  const feed = model.createCommentFeed('123456', '654321');
  const original = '字'.repeat(100) + ' END';
  model.appendCommentPage(feed, { success: true, series_id: '123456', episode_id: '654321',
    items: [{ id: 'a', content: original }, { id: 'b', content: '  正常\n评论  ' }, { content: '' }, { content: 3 }],
    has_more: false, next_cursor: null, source_limited: true, notice: '官网仅提供部分评论' }, DEFAULT_DANMAKU_SETTINGS);
  assert.equal(feed.sourceLimited, true);
  assert.equal(feed.notice, '官网仅提供部分评论');
  assert.equal(feed.hasMore, false);
  assert.equal(feed.comments[0].content, original);
  assert.equal(feed.comments[1].content, '正常 评论');
  assert.equal(feed.comments.length, 2);
  advanceDanmaku(feed.animation, feed.comments, 0.1, { width: 500, height: 300, settings: DEFAULT_DANMAKU_SETTINGS, reducedMotion: true });
  assert.equal(Array.from(feed.animation.items[0].text).length, 80);
  const nextEpisode = model.createCommentFeed('123456', '654322');
  assert.equal(nextEpisode.animation.cursor, 0);
  assert.equal(nextEpisode.comments.length, 0);
});
