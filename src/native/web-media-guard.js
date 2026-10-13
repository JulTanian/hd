const { isIP, BlockList } = require('node:net');
const dns = require('node:dns');

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [['2001:db8::', 32], ['2001::', 32], ['2002::', 16]]) {
  blocked.addSubnet(address, prefix, 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
globalV6.addSubnet('::ffff:0:0', 96, 'ipv6');

function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

function isPublicMediaUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (isIP(host)) return isPublicAddress(host);
    return host.includes('.') && !/(^|\.)(localhost|local|internal|lan|home)$/.test(host);
  } catch (_) { return false; }
}

function blockedAddress() {
  return Object.assign(new Error('官网片源及其跳转、解析结果必须指向公网'), { code: 'ERR_WEB_MEDIA_ADDRESS', mediaRetryable: true });
}

function webMediaRequestOptions(value) {
  if (!isPublicMediaUrl(value)) throw blockedAddress();
  const hosts = new Set([new URL(value).hostname.toLowerCase()]);
  return {
    maxRedirects: 5,
    lookup(hostname, options, callback) {
      const settings = typeof options === 'number' ? { family: options } : options || {};
      dns.lookup(hostname, { ...settings, all: true }, (error, addresses) => {
        if (error) return callback(error);
        // Validate the actual socket lookup; a separate DNS preflight permits rebinding.
        if (hosts.has(hostname.toLowerCase()) && (!addresses.length || addresses.some(item => !isPublicAddress(item.address)))) {
          return callback(blockedAddress());
        }
        // User-selected proxies may be local; their remote DNS remains a trust boundary.
        if (settings.all) callback(null, addresses);
        else if (addresses.length) callback(null, addresses[0].address, addresses[0].family);
        else callback(new Error('片源域名未解析到地址'));
      });
    },
    beforeRedirect(_options, response, request) {
      const target = new URL(response.headers.location, request.url);
      if (!isPublicMediaUrl(target.href)) throw blockedAddress();
      hosts.add(target.hostname.toLowerCase());
    },
  };
}

module.exports = { isPublicMediaUrl, webMediaRequestOptions };
