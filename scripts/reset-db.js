'use strict';

/**
 * Drops and recreates the SQLite database, then re-seeds it.
 * Destructive by design — this is the "give me a clean demo dataset" command.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dbFile = path.join(root, 'prisma', 'woohelperpro.db');
const journalFile = `${dbFile}-journal`;

console.log('\n⚠  This will delete the existing database and rebuild it.\n');

for (const file of [dbFile, journalFile]) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`   deleted ${path.relative(root, file)}`);
  }
}

console.log('\n→ Pushing schema...');
execSync('npx prisma db push --skip-generate --accept-data-loss', {
  cwd: root,
  stdio: 'inherit',
});

console.log('\n→ Seeding...');
execSync('node prisma/seed.js', { cwd: root, stdio: 'inherit' });

console.log('\n✓ Database reset complete.\n');
