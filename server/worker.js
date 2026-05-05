'use strict';
/**
 * Background worker process — runs cron jobs isolated from the API server.
 * Start via PM2 (see ecosystem.config.cjs) or: node server/worker.js
 */

const { setupDatabase } = require('./db');
const { initDemoCleanupJob } = require('./jobs/demoCleanup');

(async () => {
  try {
    await setupDatabase();
    initDemoCleanupJob();
    console.log('✅ TirePro worker running');
  } catch (err) {
    console.error('❌ Worker failed to start:', err.message);
    process.exit(1);
  }
})();
