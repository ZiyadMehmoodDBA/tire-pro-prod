const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const { setupDatabase } = require('./db');
const { requireAuth } = require('./middleware/auth');
const { validateBranchContext } = require('./middleware/validateBranchContext');
const { blockDemo } = require('./middleware/demo');
const { initCatalogScraperJob } = require('./jobs/catalogScraper');
const { initDemoCleanupJob }    = require('./jobs/demoCleanup');

const app  = express();
const PORT = 3001;

// Trust Cloudflare / reverse-proxy hops so rate-limiter uses real client IP
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: false, // API-only server; browser CSP is on the frontend
}));

// ── CORS — allow Vite dev server and Cloudflare tunnel ───────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://mtc.mazdatyrestore.online'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Org-ID', 'X-Branch-ID', 'Authorization'],
}));

// ── Body parsing — cap at 500 KB to block oversized payloads ─────────────────
app.use(express.json({ limit: '500kb' }));

// ── General API rate limit (loose — protects against scraping/flooding) ──────
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api', generalLimiter);

// ── Auth guard — all /api routes except /auth/* and /health ──────────────────
// Fitment routes are global reference data (no user/org context) — no auth needed.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path === '/health' || req.path.startsWith('/fitments')) return next();
  requireAuth(req, res, next);
});

// ── Branch context validation — org_admin X-Branch-ID header sanity check ────
// Ensures org_admins cannot target branches from other organisations.
app.use('/api', validateBranchContext);

// ── Demo role guard ───────────────────────────────────────────────────────────
// Block demo users from ALL destructive / administrative mutations.
// Demo users may GET anything and POST to create-only routes (sandboxed).
// Transactional data created by demo users is reset every 30 min by demoCleanup.
const DEMO_BLOCKED_PATHS = [
  /\/void$/,            // POST /sales/:id/void
  /\/status$/,          // PATCH /sales|purchases/:id/status
  /\/password$/,        // PATCH /users/:id/password
  /\/import-catalog$/,  // POST /inventory/import-catalog
  /\/scraper\//,        // POST /catalog/scraper/*
];
const DEMO_ALLOWED_POST_PREFIXES = [
  '/customers', '/suppliers', '/inventory', '/sales', '/purchases',
  '/products', '/payments', '/ledger',
];

app.use('/api', (req, res, next) => {
  if (req.user?.role !== 'demo') return next();
  if (req.method === 'GET') return next();

  // Block specific mutation sub-paths regardless of method
  if (DEMO_BLOCKED_PATHS.some(p => p.test(req.path))) {
    return blockDemo(req, res, next);
  }

  // Allow sandboxed creates on whitelisted route prefixes
  if (req.method === 'POST' && DEMO_ALLOWED_POST_PREFIXES.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Block everything else (DELETE, PUT, PATCH, admin POSTs)
  return blockDemo(req, res, next);
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/sales',     require('./routes/sales'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/settings',  require('./routes/settings'));
app.use('/api/lookups',   require('./routes/lookups'));
app.use('/api/products',  require('./routes/products'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/ledger',        require('./routes/ledger'));
app.use('/api/organizations', require('./routes/organizations'));
app.use('/api/branches',      require('./routes/branches'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/audit',         require('./routes/audit'));
app.use('/api/profile',       require('./routes/profile'));
app.use('/api/catalog',       require('./routes/catalog'));
app.use('/api/fitments',      require('./routes/fitments'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── Production static file serving ────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use('/tire-pro', express.static(distPath));
  app.get('/', (req, res) => res.redirect('/tire-pro'));
  app.get('/tire-pro', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  app.get('/tire-pro/*splat', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  // Avoid leaking stack traces in error responses
  console.error('[API Error]', err.message);
  res.status(500).json({ error: 'An internal error occurred' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await setupDatabase();
    await initCatalogScraperJob();
    initDemoCleanupJob();
    app.listen(PORT, () => {
      console.log(`🚀 TirePro API running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
})();
