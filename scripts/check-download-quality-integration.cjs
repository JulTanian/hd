// Isolated main-process checks: exercise real task/IPC code without user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const source = path.resolve(__dirname, '../main.js');
const req = createRequire(source);
const dirs = [];
function fixture({ width = 1080, height = 1920, quality = 'auto' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-quality-'));
  dirs.push(root);
  const handlers = {}, calls = [], app = new EventEmitter();
  let settings = { root, download_quality: quality }, saved;
  Object.assign(app, { getVersion: () => 'test', getPath: () => root,
    commandLine: { appendSwitch() {} }, whenReady: () => ({ then() {} }) });
  const context = vm.createContext({ require: n => n === 'electron'
    ? { app, ipcMain: { handle: (n, f) => handlers[n] = f }, protocol: { registerSchemesAsPrivileged() {} } }
    : n === './src/native/hongguo' ? { fetchPlayUrlSingle: async (...args) => { calls.push(args); return { url: 'https://media.example/video.mp4' }; } }
    : n === './src/store' ? { getSettings: () => settings, saveSettings: s => settings = s,
      saveTasks: tasks => { saved = JSON.parse(JSON.stringify(tasks)); } } : req(n),
    __dirname: path.dirname(source), console: { log() {}, warn() {}, error() {} },
    process, Buffer, URL, Response, Request, Headers, AbortController, setTimeout, clearTimeout,
    testReadStream: () => Readable.from([Buffer.alloc(200000)]), testDimensions: { w: width, h: height } });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  const run = text => vm.runInContext(text, context);
  run(`pumpQueue = () => {}; resolveFfmpeg = () => '/test/ffprobe';
    probeVideoInfo = async () => testDimensions;
    requestMedia = async () => ({headers: {'content-length': '200000'}, data: testReadStream()});
    seriesRegistry = [{series_id:'1',series_title:'测试剧',episodes:[{vid:'11',vid_index:1},{vid:'12',vid_index:2}]}];`);
  return { root, context, run, handlers, calls, saved: () => saved,
    setQuality: value => { settings.download_quality = value; } };
}
const payload = quality => ({ seriesId: '1', seriesTitle: '测试剧', episodes: [{vid:'11',vid_index:1}], ...(quality ? {quality} : {}) });
const checks = [
  ['batch snapshots chosen quality and passes it through to source lookup', async () => {
    const h = fixture({ quality: '720p' });
    assert.equal((await h.handlers['hongguo-download-batch']({}, payload('1080p'))).success, true);
    assert.equal(h.saved()[0].downloadQuality, '1080p');
    h.setQuality('auto');
    await h.run('executeHongguoDownload(downloadTasks[0])');
    assert.equal(h.calls[0][2].quality, '1080p');
    assert.equal(h.saved()[0].status, 'completed');
    assert.equal(h.saved()[0].actualQuality, '1080p');
  }],
  ['single download accepts override and falls back to saved default', async () => {
    const h = fixture({ quality: '720p' });
    await h.handlers['download-single-episode']({}, '1', 1, '1080p');
    await h.handlers['download-single-episode']({}, '1', 2);
    assert.equal(h.saved().find(t => t.hongguoInfo.vid === '11').downloadQuality, '1080p');
    assert.equal(h.saved().find(t => t.hongguoInfo.vid === '12').downloadQuality, '720p');
  }],
  ['1080 request rejects a real 720 file before publishing a completed file', async () => {
    const h = fixture({ width:720, height:1280 });
    await h.handlers['hongguo-download-batch']({}, payload('1080p'));
    await h.run('executeHongguoDownload(downloadTasks[0])');
    const t = h.saved()[0];
    assert.equal(t.status, 'failed');
    assert.match(t.error, /720.*1080|1080.*720/);
    assert.equal(fs.existsSync(t.savePath), false);
    assert.equal(fs.existsSync(t.savePath + '.enc.tmp'), false);
  }],
  ['unverifiable resolution fails closed for explicit quality', async () => {
    const h = fixture(); h.context.testDimensions = null;
    await h.handlers['hongguo-download-batch']({}, payload('1080p'));
    await h.run('executeHongguoDownload(downloadTasks[0])');
    assert.equal(h.saved()[0].status, 'failed');
    assert.match(h.saved()[0].error, /分辨率|清晰度/);
  }],
  ['existing low-resolution file remains unchanged and is not counted as 1080', async () => {
    const h = fixture({ width:720, height:1280 });
    await h.handlers['hongguo-download-batch']({}, payload());
    const t = h.saved()[0]; fs.writeFileSync(t.savePath, Buffer.alloc(200000, 42));
    h.run('downloadTasks[0].status = "completed"');
    const result = await h.handlers['hongguo-download-batch']({}, payload('1080p'));
    assert.equal(result.success, false);
    assert.match(result.error, /已有|本地/);
    assert.equal(fs.readFileSync(t.savePath)[0], 42);
    assert.equal(h.run('downloadTasks[0].status'), 'completed');
  }],
  ['different quality cannot silently reuse an in-flight task', async () => {
    const h = fixture();
    await h.handlers['hongguo-download-batch']({}, payload('720p'));
    const result = await h.handlers['hongguo-download-batch']({}, payload('1080p'));
    assert.equal(result.success, false);
    assert.equal(h.run('downloadTasks[0].downloadQuality'), '720p');
  }],
  ['invalid quality is rejected before adding any tasks', async () => {
    const h = fixture();
    assert.equal((await h.handlers['hongguo-download-batch']({}, payload('4k'))).success, false);
    assert.equal(h.run('downloadTasks.length'), 0);
  }],
  ['automatic downloads preserve existing behavior without resolution probe', async () => {
    const h = fixture(); h.context.testDimensions = null;
    await h.handlers['hongguo-download-batch']({}, payload());
    await h.run('executeHongguoDownload(downloadTasks[0])');
    assert.equal(h.saved()[0].status, 'completed');
  }],
];
(async () => {
  let failures = 0;
  try { for (const [name, check] of checks) {
    try { await check(); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
  } } finally { for (const dir of dirs) fs.rmSync(dir, {recursive:true, force:true}); }
  console.log(`${checks.length - failures}/${checks.length} passed`);
  process.exitCode = failures ? 1 : 0;
})();
