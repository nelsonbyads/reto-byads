import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createTrustProxy, isPrivateAddress } from '../src/trustProxy.js';

async function clientIp(hops, remoteAddress, forwardedFor) {
  const app = Fastify({ trustProxy: createTrustProxy(hops) });
  app.get('/ip', (request) => ({ ip: request.ip }));
  const res = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress,
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  });
  await app.close();
  return res.json().ip;
}

describe('trustProxy', () => {
  it('recognises private addresses', () => {
    assert.equal(isPrivateAddress('172.18.0.4'), true);
    assert.equal(isPrivateAddress('::ffff:192.168.16.1'), true);
    assert.equal(isPrivateAddress('::1'), true);
    assert.equal(isPrivateAddress('203.0.113.7'), false);
    assert.equal(isPrivateAddress('not-an-ip'), false);
  });

  it('takes the client from X-Forwarded-For behind nginx (1 hop)', async () => {
    assert.equal(await clientIp(1, '172.18.0.5', '203.0.113.7'), '203.0.113.7');
  });

  it('takes the client behind Caddy + nginx (2 hops), ignoring a spoofed entry', async () => {
    assert.equal(await clientIp(2, '172.18.0.5', '198.51.100.1, 203.0.113.7, 172.18.0.9'), '203.0.113.7');
  });

  it('ignores X-Forwarded-For from a public peer (API reached directly)', async () => {
    assert.equal(await clientIp(1, '203.0.113.50', '10.0.0.1'), '203.0.113.50');
  });

  it('never trusts more hops than configured', async () => {
    assert.equal(await clientIp(1, '172.18.0.5', '10.0.0.8, 172.18.0.9'), '172.18.0.9');
  });

  it('trusts nothing with 0 hops', async () => {
    assert.equal(await clientIp(0, '172.18.0.5', '203.0.113.7'), '172.18.0.5');
  });
});
