// Preloaded with NODE_OPTIONS=--require: any socket or DNS use throws.
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const fail = (what) => () => {
  throw new Error(`network use blocked in test: ${what}`);
};
net.connect = fail('net.connect');
net.createConnection = fail('net.createConnection');
net.Socket.prototype.connect = fail('net.Socket.connect');
tls.connect = fail('tls.connect');
dns.lookup = fail('dns.lookup');
dns.resolve = fail('dns.resolve');
dns.promises.lookup = fail('dns.promises.lookup');
globalThis.fetch = fail('fetch');
