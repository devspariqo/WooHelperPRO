'use strict';

/**
 * Compile every EJS view.
 *
 * Why this exists: two separate bugs this session were a literal EJS close tag
 * inside a view's own opening comment block. It ends the block early, the rest of
 * the comment leaks out as text, and the view fails at RENDER time with
 * "Could not find matching close tag" -- which only shows up when a user hits that
 * page. Both instances cost real time to find.
 *
 * Compiling every view up front turns that class of bug into a one-second check.
 *
 * It also catches unclosed tags, unbalanced <% %>, and syntax errors inside
 * scriptlets -- anything EJS itself would reject.
 *
 * Usage: node scripts/compile-views.js
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.resolve(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ejs')) files.push(full);
  }
})(VIEWS);

const failures = [];

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  try {
    ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
  } catch (err) {
    failures.push({ rel, message: String(err.message).split('\n')[0] });
  }
}

console.log(`\ncompiled ${files.length} view(s)\n`);

if (failures.length) {
  console.log('FAIL:');
  for (const f of failures) console.log(`  ${f.rel}\n      ${f.message}`);
  console.log('\n' + '='.repeat(58));
  console.log(`${failures.length} view(s) failed to compile`);
  process.exit(1);
}

console.log('all views compile');
