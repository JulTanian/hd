const { pathToFileURL } = require('node:url');

function createRendererSecurity(entryFile, devUrl) {
  const entry = pathToFileURL(entryFile).href;
  const devOrigin = devUrl ? new URL(devUrl).origin : '';
  const isTrustedUrl = value => {
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      url.hash = '';
      return url.href === entry || (!!devOrigin && /^https?:$/.test(url.protocol) && url.origin === devOrigin);
    } catch (_) { return false; }
  };
  return {
    isTrustedUrl,
    isTrustedSender(event, win) {
      return !!win && !win.isDestroyed() && event?.sender === win.webContents
        && !!event.senderFrame && event.senderFrame === win.webContents.mainFrame
        && isTrustedUrl(event.senderFrame.url);
    },
    protectWindow(win) {
      for (const name of ['will-navigate', 'will-redirect']) {
        win.webContents.on(name, (event, url) => { if (!isTrustedUrl(url)) event.preventDefault(); });
      }
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    },
  };
}

module.exports = { createRendererSecurity };
