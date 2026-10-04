const { PrismaClient } = require('@prisma/client');

// The single Prisma client for the whole process. Every route and lib file used
// to build its own (31 of them), and each client is a separate connection pool:
// under load the app could hold several times more database connections than it
// needed, all competing for the same Postgres connection limit. One shared
// client means one pool, sized once, for everything.
module.exports = globalThis.__chatHubPrisma || (globalThis.__chatHubPrisma = new PrismaClient());
