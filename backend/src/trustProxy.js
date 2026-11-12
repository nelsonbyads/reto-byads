import { BlockList, isIP } from 'node:net';

// Private, loopback and link-local ranges: where our own proxies (nginx, Caddy)
// live inside the Docker network.
const PRIVATE = new BlockList();
for (const [net, prefix] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16]]) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]]) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(address) {
  const value = String(address ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  const family = isIP(value);
  if (!family) return false;
  return PRIVATE.check(value, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Fastify `trustProxy` function. Fastify 5 ignores a plain hop count (it can
 * not tell whether the direct peer is a proxy), which made every client share
 * nginx's address for rate limits and login lockout.
 *
 * A hop is trusted only if it is one of the first `hops` addresses (counting
 * from the socket peer) *and* it is a private address, i.e. one of our own
 * proxies. The client IP is then the first untrusted address in
 * X-Forwarded-For, so a client cannot spoof it from the Internet.
 */
export function createTrustProxy(hops, { publicProxies = false } = {}) {
  const max = Number.isInteger(hops) && hops > 0 ? hops : 0;
  // On managed platforms (Vercel in front of Render) the proxies have public
  // addresses; there the first `hops` peers are trusted whatever their address.
  if (publicProxies) return (_address, hop) => hop < max;
  return (address, hop) => hop < max && isPrivateAddress(address);
}
