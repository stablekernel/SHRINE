// Preloaded with NODE_OPTIONS=--require: any socket, DNS, or HTTP use throws and,
// when SHRINE_TEST_NET_LOG names a file, is appended there first, so a call
// whose error the code swallows still fails the test.
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const dgram = require('node:dgram');

const LOG = process.env.SHRINE_TEST_NET_LOG;
const fail = (what) =>
  function blocked() {
    if (LOG) fs.appendFileSync(LOG, `${what}\n`);
    throw new Error(`network use blocked in test: ${what}`);
  };
const block = (obj, name, label) => {
  if (typeof obj[name] === 'function') obj[name] = fail(label);
};

block(net, 'connect', 'net.connect');
block(net, 'createConnection', 'net.createConnection');
net.Socket.prototype.connect = fail('net.Socket.connect');
block(tls, 'connect', 'tls.connect');
for (const m of ['request', 'get']) {
  block(http, m, `http.${m}`);
  block(https, m, `https.${m}`);
}
block(dgram, 'createSocket', 'dgram.createSocket');
// Every lookup, reverse, and resolve* variant, callback and promise forms, on the
// module and on Resolver instances.
const dnsNames = (o) => Object.getOwnPropertyNames(o).filter((n) => /^(lookup|lookupService|reverse|resolve)/.test(n));
for (const n of dnsNames(dns)) block(dns, n, `dns.${n}`);
for (const n of dnsNames(dns.Resolver.prototype)) block(dns.Resolver.prototype, n, `dns.Resolver.${n}`);
for (const n of dnsNames(dns.promises)) block(dns.promises, n, `dns.promises.${n}`);
for (const n of dnsNames(dns.promises.Resolver.prototype)) block(dns.promises.Resolver.prototype, n, `dns.promises.Resolver.${n}`);
globalThis.fetch = fail('fetch');
