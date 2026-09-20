#!/usr/bin/env node
/**
 * Switch the Prisma datasource between SQLite and PostgreSQL.
 *
 * Deploying to Hostinger Web Apps requires Postgres: the host runs your app
 * from a versioned build directory that is replaced on every deploy, so an
 * SQLite file written at runtime is lost on the next push. See
 * docs/DEPLOY-HOSTINGER.md.
 *
 * Usage:
 *   node scripts/set-db-provider.js postgresql
 *   node scripts/set-db-provider.js sqlite
 *   node scripts/set-db-provider.js            # report the current provider
 *
 * It edits only the `datasource` block in prisma/schema.prisma and leaves the
 * rest of the schema untouched. Re-run `npx prisma generate` afterwards.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');

const SUPPORTED = ['sqlite', 'mysql', 'postgresql'];

const target = (process.argv[2] || '').toLowerCase();

if (!fs.existsSync(SCHEMA)) {
  console.error('ERROR: ' + SCHEMA + ' not found.');
  process.exit(2);
}

let src = fs.readFileSync(SCHEMA, 'utf8');

// Match `datasource db { ... }` and capture the block.
const blockRe = /datasource\s+(\w+)\s*\{([\s\S]*?)\}/;
const m = blockRe.exec(src);

if (!m) {
  console.error('ERROR: no datasource block found in prisma/schema.prisma');
  process.exit(2);
}

const block = m[0];
const providerMatch = /provider\s*=\s*"(\w+)"/.exec(block);
const current = providerMatch ? providerMatch[1] : '(unknown)';

if (!target) {
  console.log('schema          : ' + path.relative(ROOT, SCHEMA));
  console.log('datasource name : ' + m[1]);
  console.log('provider        : ' + current);
  console.log('');
  console.log('usage: node scripts/set-db-provider.js <' + SUPPORTED.join('|') + '>');
  process.exit(0);
}

if (!SUPPORTED.includes(target)) {
  console.error('ERROR: unsupported provider "' + target + '".');
  console.error('       supported: ' + SUPPORTED.join(', '));
  process.exit(2);
}

if (current === target) {
  console.log('Provider is already "' + target + '" -- nothing to do.');
  process.exit(0);
}

const updatedBlock = block.replace(
  /provider\s*=\s*"\w+"/,
  'provider = "' + target + '"',
);

src = src.replace(blockRe, updatedBlock);
fs.writeFileSync(SCHEMA, src);

console.log('provider: ' + current + ' -> ' + target);
console.log('');
console.log('Next steps:');
if (target === 'postgresql') {
  console.log('  1. Set DATABASE_URL to your Postgres connection string, e.g.');
  console.log('     DATABASE_URL="postgresql://user:pass@host:6543/postgres"');
  console.log('  2. npx prisma generate');
  console.log('  3. npx prisma db push      # creates the tables');
  console.log('  4. npm run db:seed         # seed, then DELETE demo data before launch');
} else if (target === 'mysql') {
  console.log('  1. Set DATABASE_URL to your MySQL connection string, e.g.');
  console.log('     DATABASE_URL="mysql://user:pass@host:3306/dbname"');
  console.log('     URL-encode special characters in the password');
  console.log('     (e.g. # -> %23, @ -> %40, / -> %2F, : -> %3A).');
  console.log('  2. npx prisma generate');
  console.log('  3. npx prisma db push      # creates the tables');
  console.log('  4. npm run db:seed         # seed, then DELETE demo data before launch');
} else {
  console.log('  1. Set DATABASE_URL="file:./woohelperpro.db"');
  console.log('  2. npx prisma generate');
  console.log('  3. npm run setup');
}
