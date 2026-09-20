'use strict';

const { PrismaClient } = require('@prisma/client');
const config = require('../config');

const prisma = new PrismaClient({
  log: config.isProd ? ['error'] : ['error', 'warn'],
});

module.exports = prisma;
