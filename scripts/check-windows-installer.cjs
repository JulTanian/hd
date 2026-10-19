// Install only on disposable GitHub Windows CI; --config is safe on any host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const root = path.resolve(__dirname, '..');
const setupName = `hongguo-downloader-${pkg.version}-win-x64-setup.exe`;

function checkConfig() {
  const lock = require('../package-lock.json');
  assert(require('semver').gt(pkg.version, '1.75.0'), 'In-app update releases must be newer than 1.75');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
  assert.deepEqual(pkg.build.publish, { provider: 'github', owner: 'jackotom', repo: 'hongguo-drama' });
  assert.equal(pkg.build.nsis.artifactName.replace('${version}', pkg.version).replace('${ext}', 'exe'), setupName);
  assert.equal(pkg.build.portable.artifactName, '${productName}-${version}-便携版.${ext}');
  assert(pkg.build.mac.target.some(target => target.target === 'zip' && target.arch.includes('arm64') && target.arch.includes('x64')));
  assert(pkg.build.mac.extraResources.some(resource => resource.from === 'build/app-update.yml' && resource.to === 'app-update.yml'), 'Mac directory builds must carry updater configuration');
  assert.notEqual(pkg.build.win.verifyUpdateCodeSignature, false);
}

checkConfig();
if (process.argv.includes('--config')) console.log('Release configuration: PASS');
else runInstallerCheck().catch(error => { console.error(error.stack); process.exitCode = 1; });

async function runInstallerCheck() {
  assert.equal(process.platform, 'win32', 'Installer check requires Windows');
  assert.equal(process.arch, 'x64');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only run on disposable GitHub Actions runners');
  const { execFileSync, spawn } = require('node:child_process');
  const { createHash } = require('node:crypto');
  const yaml = require('js-yaml');
  const out = path.join(root, 'dist/windows-verification');
  fs.mkdirSync(out, { recursive: true });
  const result = { version: pkg.version, signed: false, checks: [], crossVersionUpgradeTested: false, passed: false };
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hongguo-installer-'));
  const installDir = path.join(temp, 'installed');
  const profile = path.join(temp, 'profile');
  const mediaDir = path.join(temp, 'downloads');
  const setup = path.join(root, 'dist', setupName);
  const exe = path.join(installDir, pkg.build.productName + '.exe');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let child, socket, sequence = 0;
  const pending = new Map();

  function stopApp() {
    socket?.close(); socket = null;
    if (child?.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
    child = null;
  }

  function install() {
    // /D must be the final NSIS argument; this path belongs only to this CI run.
    execFileSync(setup, ['/S', '/currentuser', '/D=' + installDir], { timeout: 120000, windowsHide: true, stdio: 'pipe' });
    assert(fs.existsSync(exe), 'NSIS did not install the application at the isolated destination');
  }

  function evaluate(expression) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Installer renderer check timed out')); }, 15000);
      pending.set(id, message => {
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        else resolve(message.result.result.value);
      });
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  }

  async function launch() {
    child = spawn(exe, ['--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9440'], { stdio: 'ignore' });
    let launchError;
    child.once('error', error => { launchError = error; });
    let target;
    for (let i = 0; i < 150 && !target; i++) {
      if (launchError) throw launchError;
      try { target = (await (await fetch('http://127.0.0.1:9440/json')).json()).find(item => item.type === 'page' && item.url.startsWith('file:')); } catch {}
      if (!target) await delay(200);
    }
    assert(target, 'Installed application did not open its renderer');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); callback(message); }
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    for (let i = 0; i < 100; i++) {
      if (await evaluate('Boolean(window.electronAPI && document.querySelector("#root")?.children.length)')) break;
      await delay(100);
    }
    assert(await evaluate('document.querySelector("#root").children.length > 0'));
    assert.equal((await evaluate('window.electronAPI.getAppInfo()')).version, pkg.version);
    assert.equal((await evaluate('window.electronAPI.getSettings()')).root, mediaDir);
  }

  try {
    const metadata = yaml.load(fs.readFileSync(path.join(root, 'dist/latest.yml'), 'utf8'));
    assert.equal(metadata.version, pkg.version);
    assert.equal(metadata.path, setupName);
    assert.equal(metadata.files.length, 1, 'Windows updater must offer only the NSIS installer');
    const file = metadata.files[0];
    assert.equal(file.url, setupName);
    const digest = createHash('sha512').update(fs.readFileSync(setup)).digest('base64');
    assert.equal(file.sha512, digest);
    assert.equal(metadata.sha512, digest);
    assert.equal(file.size, fs.statSync(setup).size);
    result.checks.push('latest.yml points to the exact NSIS filename, version, size and SHA512');
    result.authenticode = execFileSync('pwsh.exe', ['-NoProfile', '-Command', '(Get-AuthenticodeSignature -LiteralPath $env:HONGGUO_VERIFY_EXE).Status.ToString()'], { encoding: 'utf8', env: { ...process.env, HONGGUO_VERIFY_EXE: setup } }).trim();
    assert.equal(result.authenticode, 'NotSigned');
    fs.mkdirSync(profile); fs.mkdirSync(mediaDir);
    const retainedFile = path.join(mediaDir, 'retained-download.txt');
    fs.writeFileSync(retainedFile, 'Existing download must survive installation');
    fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({ settings: { root: mediaDir, watch_updates_enabled: false, watch_sequels_enabled: false } }));
    install();
    const updateConfig = yaml.load(fs.readFileSync(path.join(installDir, 'resources/app-update.yml'), 'utf8'));
    for (const [key, value] of Object.entries(pkg.build.publish)) assert.equal(updateConfig[key], value);
    result.checks.push('NSIS installs into a fresh temporary directory with the official update feed');
    await launch();
    assert.equal((await evaluate('(async () => { const settings = await window.electronAPI.getSettings(); return window.electronAPI.saveSettings({ ...settings, download_quality: "720p" }); })()')).success, true);
    await evaluate('localStorage.setItem("hongguo-installer-smoke", "retained"); true');
    stopApp();
    install();
    await launch();
    assert.equal((await evaluate('window.electronAPI.getSettings()')).download_quality, '720p');
    assert.equal(await evaluate('localStorage.getItem("hongguo-installer-smoke")'), 'retained');
    assert.equal(fs.readFileSync(retainedFile, 'utf8'), 'Existing download must survive installation');
    result.checks.push('Installed application opens before and after same-version reinstall; isolated settings, local storage and existing download remain');
    result.passed = true;
    console.log('Windows NSIS smoke: PASS (installation, launch, metadata, same-version data retention)');
  } catch (error) {
    result.error = error.stack;
    throw error;
  } finally {
    stopApp();
    fs.writeFileSync(path.join(out, 'installer-result.json'), JSON.stringify(result, null, 2) + '\n');
  }
}
