#!/usr/bin/env node
/**
 * Build a correct DATABASE_URL, with the password URL-encoded.
 *
 * Why this exists: MySQL passwords routinely contain characters that are
 * reserved in a URL -- `#` starts a fragment, `@` ends the userinfo section,
 * `/` ends the host. Pasting such a password into a connection string either
 * produces a URL that does not parse at all (Node throws ERR_INVALID_URL for a
 * bare `#`) or one that silently truncates the password. Both surface as
 * Prisma's P1000 "Authentication failed", which points at your credentials
 * rather than at the encoding.
 *
 * Usage:
 *   node scripts/make-db-url.js --host 127.0.0.1 --db mydb --user myuser --password 'p#ss/word@x'
 *   node scripts/make-db-url.js            # prints the .env keys to fill in
 *
 * Use --host 127.0.0.1 for an app running ON Hostinger alongside the database.
 * Use the remote hostname (e.g. srv1234.hstgr.io) only for remote administration,
 * and only after adding your IP under hPanel -> Databases -> Remote MySQL.
 */
'use strict';

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) return fallback;
  return v;
}

const host = flag('host');
const db = flag('db');
const user = flag('user');
const password = flag('password');
const port = flag('port', '3306');

if (!host || !db || !user || !password) {
  console.log('Generate a correctly URL-encoded MySQL DATABASE_URL.');
  console.log('');
  console.log('usage:');
  console.log("  node scripts/make-db-url.js --host 127.0.0.1 --db <db> --user <user> --password '<pw>'");
  console.log('');
  console.log('flags:');
  console.log('  --host      127.0.0.1 when the app runs on the same host as MySQL');
  console.log('              (Hostinger Web Apps: use 127.0.0.1, NOT localhost)');
  console.log('  --db        database name');
  console.log('  --user      database user');
  console.log('  --password  raw password (quote it in your shell)');
  console.log('  --port      default 3306');
  console.log('');
  console.log('Add to .env:');
  console.log('  DATABASE_URL="mysql://user:encodedpw@127.0.0.1:3306/dbname"');
  process.exit(0);
}

const encUser = encodeURIComponent(user);
const encPass = encodeURIComponent(password);
const url = `mysql://${encUser}:${encPass}@${host}:${port}/${db}`;

// Verify it round-trips; a bad string here is better than a mystery P1000 later.
let parsed;
try {
  parsed = new URL(url);
} catch (err) {
  console.error('ERROR: produced an invalid URL -- check the host value. ' + err.message);
  process.exit(2);
}

const ok = parsed.username === encUser && parsed.password === encPass && parsed.pathname === '/' + db;

console.log('DATABASE_URL:');
console.log('  ' + url);
console.log('');
console.log('Encoding applied to the password:');
console.log('  raw     : ' + (password.length > 0 ? password.replace(/./g, (c) => (/[A-Za-z0-9\-._~]/.test(c) ? c : c)) : '(empty)'));
console.log('  encoded : ' + encPass);
if (encPass !== password) {
  const changed = [...password].filter((c) => !/[A-Za-z0-9\-._~]/.test(c)).join(' ');
  console.log('  note    : these characters were encoded -> ' + changed);
} else {
  console.log('  note    : no reserved characters, encoding was a no-op');
}
console.log('');
console.log('Round-trip check: ' + (ok ? 'OK' : 'FAILED'));
console.log('');
console.log('Add to your app environment variables as:');
console.log('  DATABASE_URL=' + url);
if (host === '127.0.0.1' || host === 'localhost') {
  console.log('');
  console.log('Host is loopback -- correct for an app running on the same server as MySQL.');
} else {
  console.log('');
  console.log('Host is REMOTE. Before this will work you must allowlist your IP:');
  console.log('  hPanel -> Databases -> Remote MySQL -> add your public IP');
  console.log('  (find it at https://api.ipify.org)');
}
process.exit(ok ? 0 : 1);
