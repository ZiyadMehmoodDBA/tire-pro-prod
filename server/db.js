const sql    = require('mssql');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { seedTireCatalog }      = require('./seeds/tireCatalog');
const { seedVehicleFitments }  = require('./seeds/vehicleFitments');

const baseConfig = {
  server:   process.env.DB_SERVER || 'localhost',
  user:     process.env.DB_USER   || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  connectionTimeout: 15000,
  requestTimeout:    30000,
};

let pool = null;

async function getPool() {
  // Reconnect if the pool was closed or errored
  if (!pool || !pool.connected) {
    if (pool) { try { await pool.close(); } catch (_) {} }
    pool = new sql.ConnectionPool({ ...baseConfig, database: process.env.DB_NAME || 'TireProDB' });
    pool.on('error', err => {
      console.error('SQL pool error:', err.message);
      pool = null; // force reconnect on next call
    });
    await pool.connect();
  }
  return pool;
}

async function getSetting(key, defaultValue = '', orgId = 1) {
  try {
    const p = await getPool();
    const result = await p.request()
      .input('key',    sql.NVarChar, key)
      .input('org_id', sql.Int,      orgId)
      .query('SELECT value FROM settings WHERE [key] = @key AND organization_id = @org_id');
    return result.recordset[0]?.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

async function setupDatabase() {
  const masterPool = new sql.ConnectionPool({ ...baseConfig, database: 'master' });
  await masterPool.connect();
  await masterPool.request().query(`
    IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'TireProDB')
    BEGIN
      CREATE DATABASE TireProDB;
    END
  `);
  await masterPool.close();

  const dbPool = new sql.ConnectionPool({ ...baseConfig, database: 'TireProDB' });
  await dbPool.connect();
  const r = dbPool.request();

  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='customers' AND xtype='U')
    CREATE TABLE customers (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      code        NVARCHAR(20)  UNIQUE NOT NULL,
      name        NVARCHAR(100) NOT NULL,
      phone       NVARCHAR(50),
      email       NVARCHAR(100),
      address     NVARCHAR(200),
      balance     DECIMAL(18,2) DEFAULT 0,
      created_at  DATETIME DEFAULT GETDATE()
    )
  `);

  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='suppliers' AND xtype='U')
    CREATE TABLE suppliers (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      code        NVARCHAR(20)  UNIQUE NOT NULL,
      name        NVARCHAR(100) NOT NULL,
      phone       NVARCHAR(50),
      email       NVARCHAR(100),
      address     NVARCHAR(200),
      balance     DECIMAL(18,2) DEFAULT 0,
      created_at  DATETIME DEFAULT GETDATE()
    )
  `);

  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tires' AND xtype='U')
    CREATE TABLE tires (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      brand         NVARCHAR(100) NOT NULL,
      model         NVARCHAR(100) NOT NULL,
      size          NVARCHAR(50)  NOT NULL,
      type          NVARCHAR(50),
      stock         INT DEFAULT 0,
      cost_price    DECIMAL(18,2) NOT NULL DEFAULT 0,
      sale_price    DECIMAL(18,2) NOT NULL DEFAULT 0,
      reorder_level INT DEFAULT 10,
      created_at    DATETIME DEFAULT GETDATE()
    )
  `);

  // Products / goods catalog (services, accessories, non-tire items)
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='products' AND xtype='U')
    CREATE TABLE products (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      code        NVARCHAR(50),
      name        NVARCHAR(200) NOT NULL,
      description NVARCHAR(500),
      category    NVARCHAR(100),
      unit        NVARCHAR(50) DEFAULT 'pcs',
      cost_price  DECIMAL(18,2) DEFAULT 0,
      sale_price  DECIMAL(18,2) DEFAULT 0,
      is_active   BIT DEFAULT 1,
      created_at  DATETIME DEFAULT GETDATE()
    )
  `);

  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='sales' AND xtype='U')
    CREATE TABLE sales (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      invoice_no   NVARCHAR(50)  UNIQUE NOT NULL,
      customer_id  INT REFERENCES customers(id),
      date         DATE NOT NULL,
      subtotal     DECIMAL(18,2) NOT NULL DEFAULT 0,
      tax          DECIMAL(18,2) NOT NULL DEFAULT 0,
      total        DECIMAL(18,2) NOT NULL DEFAULT 0,
      status       NVARCHAR(20)  DEFAULT 'pending',
      notes        NVARCHAR(500),
      created_at   DATETIME DEFAULT GETDATE()
    )
  `);

  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='sale_items' AND xtype='U')
    CREATE TABLE sale_items (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      sale_id     INT REFERENCES sales(id) ON DELETE CASCADE,
      tire_id     INT REFERENCES tires(id),
      product_id  INT REFERENCES products(id),
      tire_name   NVARCHAR(200),
      qty         INT NOT NULL DEFAULT 1,
      unit_price  DECIMAL(18,2) NOT NULL DEFAULT 0,
      amount      DECIMAL(18,2) NOT NULL DEFAULT 0
    )
  `);

  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='purchases' AND xtype='U')
    CREATE TABLE purchases (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      po_no        NVARCHAR(50)  UNIQUE NOT NULL,
      supplier_id  INT REFERENCES suppliers(id),
      date         DATE NOT NULL,
      subtotal     DECIMAL(18,2) NOT NULL DEFAULT 0,
      tax          DECIMAL(18,2) NOT NULL DEFAULT 0,
      total        DECIMAL(18,2) NOT NULL DEFAULT 0,
      status       NVARCHAR(20)  DEFAULT 'pending',
      notes        NVARCHAR(500),
      created_at   DATETIME DEFAULT GETDATE()
    )
  `);

  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='purchase_items' AND xtype='U')
    CREATE TABLE purchase_items (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      purchase_id  INT REFERENCES purchases(id) ON DELETE CASCADE,
      tire_id      INT REFERENCES tires(id),
      product_id   INT REFERENCES products(id),
      tire_name    NVARCHAR(200),
      qty          INT NOT NULL DEFAULT 1,
      unit_price   DECIMAL(18,2) NOT NULL DEFAULT 0,
      amount       DECIMAL(18,2) NOT NULL DEFAULT 0
    )
  `);

  // Settings key-value store
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='settings' AND xtype='U')
    CREATE TABLE settings (
      [key]      NVARCHAR(100) PRIMARY KEY,
      value      NVARCHAR(1000),
      updated_at DATETIME DEFAULT GETDATE()
    )
  `);

  // Payments against sales invoices (for partial/full payment tracking)
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='sale_payments' AND xtype='U')
    CREATE TABLE sale_payments (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      sale_id        INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      customer_id    INT NOT NULL REFERENCES customers(id),
      amount         DECIMAL(18,2) NOT NULL,
      payment_date   DATE NOT NULL,
      payment_method NVARCHAR(50) DEFAULT 'cash',
      reference_no   NVARCHAR(100) DEFAULT '',
      notes          NVARCHAR(500) DEFAULT '',
      created_at     DATETIME DEFAULT GETDATE()
    )
  `);

  // Payments to suppliers against purchase orders
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='purchase_payments' AND xtype='U')
    CREATE TABLE purchase_payments (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      purchase_id    INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      supplier_id    INT NOT NULL REFERENCES suppliers(id),
      amount         DECIMAL(18,2) NOT NULL,
      payment_date   DATE NOT NULL,
      payment_method NVARCHAR(50) DEFAULT 'cash',
      reference_no   NVARCHAR(100) DEFAULT '',
      notes          NVARCHAR(500) DEFAULT '',
      created_at     DATETIME DEFAULT GETDATE()
    )
  `);

  // Financial ledger — immutable journal entries (banking-style)
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ledger_entries' AND xtype='U')
    CREATE TABLE ledger_entries (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      entry_date   DATE NOT NULL,
      entity_type  NVARCHAR(20) NOT NULL,
      entity_id    INT NOT NULL,
      entry_type   NVARCHAR(30) NOT NULL,
      debit        DECIMAL(18,2) DEFAULT 0,
      credit       DECIMAL(18,2) DEFAULT 0,
      description  NVARCHAR(500) DEFAULT '',
      reference_no NVARCHAR(100) DEFAULT '',
      sale_id      INT REFERENCES sales(id),
      purchase_id  INT REFERENCES purchases(id),
      created_at   DATETIME DEFAULT GETDATE()
    )
  `);

  // Tire type lookups
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tire_types' AND xtype='U')
    CREATE TABLE tire_types (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      name       NVARCHAR(100) NOT NULL,
      sort_order INT DEFAULT 0
    )
  `);

  // Global tire catalog — brand/model/size reference data (no org scope)
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tire_catalog' AND xtype='U')
    CREATE TABLE tire_catalog (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      brand       NVARCHAR(100) NOT NULL,
      model       NVARCHAR(100) NOT NULL,
      size        NVARCHAR(50)  NOT NULL,
      pattern     NVARCHAR(100) NULL,
      load_index  NVARCHAR(10)  NULL,
      speed_index NVARCHAR(5)   NULL,
      tire_type   NVARCHAR(50)  NULL,
      CONSTRAINT UQ_tire_catalog_bms UNIQUE (brand, model, size)
    )
  `);

  // ── Multi-org / multi-branch ───────────────────────────────────────────────
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='organizations' AND xtype='U')
    CREATE TABLE organizations (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      name         NVARCHAR(200) NOT NULL,
      code         NVARCHAR(50)  NOT NULL,
      type         NVARCHAR(50)  DEFAULT 'retail',
      address      NVARCHAR(500),
      phone        NVARCHAR(50),
      email        NVARCHAR(200),
      currency     NVARCHAR(10)  DEFAULT 'PKR',
      logo_url     NVARCHAR(500),
      is_active    BIT           DEFAULT 1,
      created_at   DATETIME2     DEFAULT GETDATE(),
      CONSTRAINT UQ_org_code UNIQUE (code)
    )
  `);

  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='branches' AND xtype='U')
    CREATE TABLE branches (
      id              INT IDENTITY(1,1) PRIMARY KEY,
      organization_id INT NOT NULL,
      name            NVARCHAR(200) NOT NULL,
      code            NVARCHAR(50)  NOT NULL,
      address         NVARCHAR(500),
      phone           NVARCHAR(50),
      email           NVARCHAR(200),
      is_active       BIT           DEFAULT 1,
      created_at      DATETIME2     DEFAULT GETDATE()
    )
  `);

  // Users table — password_hash stores bcrypt hash (never plaintext)
  await r.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
    CREATE TABLE users (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      name          NVARCHAR(100) NOT NULL,
      email         NVARCHAR(100) NOT NULL,
      phone         NVARCHAR(50),
      company       NVARCHAR(100),
      city          NVARCHAR(100),
      password_hash NVARCHAR(255) NOT NULL,
      role          NVARCHAR(50)  DEFAULT 'Administrator',
      is_active     BIT           DEFAULT 1,
      created_at    DATETIME      DEFAULT GETDATE(),
      CONSTRAINT UQ_users_email UNIQUE (email)
    )
  `);

  // Migrations — add columns to existing tables if they don't have them yet
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('sale_items') AND name = 'product_id')
      ALTER TABLE sale_items ADD product_id INT REFERENCES products(id);
  `);
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('purchase_items') AND name = 'product_id')
      ALTER TABLE purchase_items ADD product_id INT REFERENCES products(id);
  `);
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('sales') AND name = 'tax_rate')
      ALTER TABLE sales ADD tax_rate DECIMAL(5,2) DEFAULT 0;
  `);
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('sales') AND name = 'amount_paid')
      ALTER TABLE sales ADD amount_paid DECIMAL(18,2) DEFAULT 0;
  `);
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('purchases') AND name = 'amount_paid')
      ALTER TABLE purchases ADD amount_paid DECIMAL(18,2) DEFAULT 0;
  `);

  // ── Multi-org column migrations ────────────────────────────────────────────
  // Org-scoped tables (no branch_id — entity is shared across all branches of an org)
  for (const tbl of ['customers', 'suppliers', 'products', 'tire_types']) {
    await dbPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('${tbl}') AND name = 'organization_id')
        ALTER TABLE ${tbl} ADD organization_id INT NOT NULL DEFAULT 1
    `);
  }
  // Branch-scoped tables
  for (const tbl of ['tires', 'sales', 'purchases', 'sale_payments', 'purchase_payments', 'ledger_entries']) {
    await dbPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('${tbl}') AND name = 'organization_id')
        ALTER TABLE ${tbl} ADD organization_id INT NOT NULL DEFAULT 1
    `);
    await dbPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('${tbl}') AND name = 'branch_id')
        ALTER TABLE ${tbl} ADD branch_id INT NOT NULL DEFAULT 1
    `);
  }
  // Vehicle info columns for customers
  for (const col of [
    { name: 'vehicle_plate', def: 'NVARCHAR(20) NULL' },
    { name: 'vehicle_make',  def: 'NVARCHAR(50) NULL' },
    { name: 'vehicle_model', def: 'NVARCHAR(50) NULL' },
    { name: 'vehicle_year',  def: 'SMALLINT NULL' },
  ]) {
    await dbPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('customers') AND name = '${col.name}')
        ALTER TABLE customers ADD ${col.name} ${col.def}
    `);
  }

  // Tire SKU spec columns — pattern, load/speed index, DOT
  for (const col of [
    { name: 'pattern',     def: 'NVARCHAR(100) NULL' },
    { name: 'load_index',  def: 'NVARCHAR(10)  NULL' },
    { name: 'speed_index', def: 'NVARCHAR(5)   NULL' },
    { name: 'dot',         def: 'NVARCHAR(20)  NULL' },
  ]) {
    await dbPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('tires') AND name = '${col.name}')
        ALTER TABLE tires ADD ${col.name} ${col.def}
    `);
  }

  // Users: organization_id (required) + branch_id (null = org admin sees all branches)
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'organization_id')
      ALTER TABLE users ADD organization_id INT NOT NULL DEFAULT 1
  `);
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'branch_id')
      ALTER TABLE users ADD branch_id INT NULL
  `);

  // Users: extended profile columns
  for (const [col, def] of [
    ['first_name',                 'NVARCHAR(100)  NULL'],
    ['last_name',                  'NVARCHAR(100)  NULL'],
    ['address',                    'NVARCHAR(500)  NULL'],
    ['job_title',                  'NVARCHAR(100)  NULL'],
    ['department',                 'NVARCHAR(100)  NULL'],
    ['date_of_birth',              'DATE           NULL'],
    ['emergency_contact_name',     'NVARCHAR(100)  NULL'],
    ['emergency_contact_phone',    'NVARCHAR(50)   NULL'],
    ['emergency_contact_relation', 'NVARCHAR(50)   NULL'],
  ]) {
    await dbPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = '${col}')
        ALTER TABLE users ADD ${col} ${def}
    `);
  }

  // ── POS / GRN additions ───────────────────────────────────────────────────
  // Stock audit trail: every stock change is logged here
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='stock_movements' AND xtype='U')
    CREATE TABLE stock_movements (
      id              INT IDENTITY(1,1) PRIMARY KEY,
      tire_id         INT NOT NULL REFERENCES tires(id),
      organization_id INT NOT NULL DEFAULT 1,
      branch_id       INT NOT NULL DEFAULT 1,
      qty_change      INT NOT NULL,
      reason          NVARCHAR(50)  NOT NULL,
      reference       NVARCHAR(100) NULL,
      ref_id          INT NULL,
      notes           NVARCHAR(500) NULL,
      created_at      DATETIME2 DEFAULT GETDATE()
    )
  `);
  // Line-level discount % on sale items
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('sale_items') AND name = 'discount')
      ALTER TABLE sale_items ADD discount DECIMAL(5,2) NOT NULL DEFAULT 0
  `);
  // Order-level discount amount on sales
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('sales') AND name = 'discount')
      ALTER TABLE sales ADD discount DECIMAL(18,2) NOT NULL DEFAULT 0
  `);
  // Payment method captured at POS checkout
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('sales') AND name = 'payment_method')
      ALTER TABLE sales ADD payment_method NVARCHAR(20) NULL
  `);
  // Cash tendered (for printing change due on receipt)
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('sales') AND name = 'cash_given')
      ALTER TABLE sales ADD cash_given DECIMAL(18,2) NULL
  `);
  // tax_rate column on purchases (mirrors sales)
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('purchases') AND name = 'tax_rate')
      ALTER TABLE purchases ADD tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0
  `);
  // Reference number on purchases (GRN number / delivery note)
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('purchases') AND name = 'reference_no')
      ALTER TABLE purchases ADD reference_no NVARCHAR(100) NULL
  `);

  // Audit log — immutable record of every create/update/delete
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='audit_logs' AND xtype='U')
    CREATE TABLE audit_logs (
      id              INT IDENTITY(1,1) PRIMARY KEY,
      organization_id INT           NOT NULL DEFAULT 1,
      branch_id       INT           NOT NULL DEFAULT 1,
      user_id         INT           NULL,
      user_name       NVARCHAR(100) NOT NULL DEFAULT 'System',
      action          NVARCHAR(20)  NOT NULL,
      entity          NVARCHAR(50)  NOT NULL,
      entity_id       INT           NULL,
      before_json     NVARCHAR(MAX) NULL,
      after_json      NVARCHAR(MAX) NULL,
      created_at      DATETIME2     DEFAULT GETDATE()
    )
  `);
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_audit_logs_org_created')
      CREATE INDEX IX_audit_logs_org_created ON audit_logs (organization_id, created_at DESC)
  `);

  // Refresh tokens for JWT session management
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='refresh_tokens' AND xtype='U')
    CREATE TABLE refresh_tokens (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  NVARCHAR(255) NOT NULL,
      expires_at  DATETIME2 NOT NULL,
      created_at  DATETIME2 DEFAULT GETDATE(),
      CONSTRAINT UQ_refresh_token UNIQUE (token_hash)
    )
  `);
  // Clean up expired refresh tokens on startup
  await dbPool.request().query(`DELETE FROM refresh_tokens WHERE expires_at < GETDATE()`);

  // Settings: migrate to per-org key-value (change PK from (key) to (organization_id, key))
  const settingsOrgExists = await dbPool.request().query(
    `SELECT COUNT(*) AS cnt FROM sys.columns WHERE object_id = OBJECT_ID('settings') AND name = 'organization_id'`
  );
  if (settingsOrgExists.recordset[0].cnt === 0) {
    await dbPool.request().query(`ALTER TABLE settings ADD organization_id INT NOT NULL DEFAULT 1`);
    // Drop old single-column PK
    const pkRow = await dbPool.request().query(`
      SELECT kc.name AS pk_name
      FROM sys.key_constraints kc
      JOIN sys.tables t ON t.object_id = kc.parent_object_id
      WHERE t.name = 'settings' AND kc.type = 'PK'
    `);
    const pkName = pkRow.recordset[0]?.pk_name;
    if (pkName) {
      await dbPool.request().query(`ALTER TABLE settings DROP CONSTRAINT [${pkName}]`);
    }
    await dbPool.request().query(
      `ALTER TABLE settings ADD CONSTRAINT PK_settings PRIMARY KEY (organization_id, [key])`
    );
  }

  // Seed default organization + branch (only if none exist)
  const orgCount = await dbPool.request().query('SELECT COUNT(*) AS cnt FROM organizations');
  if (orgCount.recordset[0].cnt === 0) {
    const orgRes = await dbPool.request()
      .input('name', sql.NVarChar, 'TirePro')
      .input('code', sql.NVarChar, 'TIREPRO')
      .input('type', sql.NVarChar, 'retail')
      .query(`INSERT INTO organizations (name, code, type) OUTPUT INSERTED.id VALUES (@name, @code, @type)`);
    const defaultOrgId = orgRes.recordset[0].id;
    await dbPool.request()
      .input('org_id', sql.Int,      defaultOrgId)
      .input('name',   sql.NVarChar, 'Main Branch')
      .input('code',   sql.NVarChar, 'MAIN')
      .query(`INSERT INTO branches (organization_id, name, code) VALUES (@org_id, @name, @code)`);
    console.log('✅ Default organization and branch seeded');
  }

  // Seed default settings for org 1 (only if table is empty)
  const settingsCount = await dbPool.request()
    .query(`SELECT COUNT(*) AS cnt FROM settings WHERE organization_id = 1`);
  if (settingsCount.recordset[0].cnt === 0) {
    const defaults = [
      ['company_name',        'TirePro'],
      ['company_tagline',     'Tyre & Wheel Solutions'],
      ['company_address',     '123 Industrial Zone, Lahore, Pakistan'],
      ['company_phone',       '+92-42-1234567'],
      ['company_email',       'info@tirepro.pk'],
      ['invoice_prefix',      'INV'],
      ['po_prefix',           'PO'],
      ['default_tax_rate',    '15'],
      ['payment_due_days',    '30'],
      ['default_sale_status', 'pending'],
      ['currency',            'PKR'],
      ['announcement',        ''],
      ['refresh_interval',    '60'],
    ];
    for (const [key, value] of defaults) {
      await dbPool.request()
        .input('org_id', sql.Int,      1)
        .input('key',    sql.NVarChar, key)
        .input('value',  sql.NVarChar, value)
        .query(`INSERT INTO settings (organization_id, [key], value) VALUES (@org_id, @key, @value)`);
    }
  }

  // Seed default tire types (only if empty)
  const typesCount = await dbPool.request()
    .query('SELECT COUNT(*) AS cnt FROM tire_types');
  if (typesCount.recordset[0].cnt === 0) {
    const types = ['Passenger', 'SUV', '4x4', 'LT', 'Performance', 'Motorcycle'];
    for (let i = 0; i < types.length; i++) {
      await dbPool.request()
        .input('name',       sql.NVarChar, types[i])
        .input('sort_order', sql.Int,      i)
        .query(`INSERT INTO tire_types (name, sort_order) VALUES (@name, @sort_order)`);
    }
  }

  // Seed default services for org 1 (only if no services exist yet)
  const servicesCount = await dbPool.request().query(
    `SELECT COUNT(*) AS cnt FROM products WHERE organization_id = 1 AND category = 'Service'`
  );
  if (servicesCount.recordset[0].cnt === 0) {
    const defaultServices = [
      { name: 'Tire Fitting',      sale: 300,   cost: 100, desc: 'Mount and fit tyre to wheel rim' },
      { name: 'Wheel Balancing',   sale: 250,   cost: 80,  desc: 'Dynamic wheel balancing with weights' },
      { name: 'Wheel Alignment',   sale: 1500,  cost: 500, desc: '4-wheel laser alignment' },
      { name: 'Puncture Repair',   sale: 200,   cost: 50,  desc: 'Tubeless puncture plug and patch repair' },
      { name: 'Valve Replacement', sale: 100,   cost: 30,  desc: 'Replace tyre valve stem' },
    ];
    for (const svc of defaultServices) {
      await dbPool.request()
        .input('name', sql.NVarChar,     svc.name)
        .input('desc', sql.NVarChar,     svc.desc)
        .input('sale', sql.Decimal(18,2), svc.sale)
        .input('cost', sql.Decimal(18,2), svc.cost)
        .query(`
          INSERT INTO products (organization_id, name, description, category, unit, sale_price, cost_price, is_active)
          VALUES (1, @name, @desc, 'Service', 'job', @sale, @cost, 1)
        `);
    }
    console.log('✅ Default services seeded');
  }

  // Ensure announcement key exists for org 1 on existing databases
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM settings WHERE organization_id = 1 AND [key] = 'announcement')
      INSERT INTO settings (organization_id, [key], value) VALUES (1, 'announcement', '')
  `);

  // Ensure refresh_interval key exists for org 1 on existing databases
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM settings WHERE organization_id = 1 AND [key] = 'refresh_interval')
      INSERT INTO settings (organization_id, [key], value) VALUES (1, 'refresh_interval', '60')
  `);

  // Seed admin user — only inserts once; safe to run on every restart
  const adminEmail = 'zmehmood@tirepro.com';
  const adminCheck = await dbPool.request()
    .input('email', sql.NVarChar, adminEmail)
    .query('SELECT id FROM users WHERE email = @email');
  if (adminCheck.recordset.length === 0) {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) throw new Error('Set ADMIN_PASSWORD in server/.env before first run');
    const hash = await bcrypt.hash(adminPassword, 12);
    await dbPool.request()
      .input('name',            sql.NVarChar, 'Ziyad Mehmood')
      .input('email',           sql.NVarChar, adminEmail)
      .input('password_hash',   sql.NVarChar, hash)
      .input('company',         sql.NVarChar, 'TirePro')
      .input('role',            sql.NVarChar, 'org_admin')
      .input('organization_id', sql.Int,      1)
      .query(`
        INSERT INTO users (name, email, password_hash, company, role, organization_id)
        VALUES (@name, @email, @password_hash, @company, @role, @organization_id)
      `);
    console.log('✅ Admin user seeded:', adminEmail);
  } else {
    // Backfill existing admin with org context
    await dbPool.request()
      .input('email',           sql.NVarChar, adminEmail)
      .input('organization_id', sql.Int,      1)
      .query(`
        UPDATE users SET organization_id = @organization_id
        WHERE email = @email AND organization_id = 0
      `);
  }

  // Vehicle fitments — Pakistan-market OEM tyre size reference (global, no org scope)
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='vehicle_fitments' AND xtype='U')
    CREATE TABLE vehicle_fitments (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      category    NVARCHAR(100) NOT NULL,
      make        NVARCHAR(50)  NOT NULL,
      model       NVARCHAR(200) NOT NULL,
      year_from   SMALLINT      NULL,
      year_to     SMALLINT      NULL,
      tire_size   NVARCHAR(50)  NOT NULL,
      gtr_pattern NVARCHAR(100) NULL,
      position    NVARCHAR(10)  NULL
    )
  `);
  // Migrate existing installs: add gtr_pattern, position columns + fix old schema
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('vehicle_fitments') AND name = 'gtr_pattern')
      ALTER TABLE vehicle_fitments ADD gtr_pattern NVARCHAR(100) NULL
  `);
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('vehicle_fitments') AND name = 'position')
      ALTER TABLE vehicle_fitments ADD position NVARCHAR(10) NULL
  `);
  // Make year_from nullable (was NOT NULL in first version)
  await dbPool.request().query(`
    IF EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('vehicle_fitments') AND name = 'year_from' AND is_nullable = 0
    )
      ALTER TABLE vehicle_fitments ALTER COLUMN year_from SMALLINT NULL
  `);

  // Catalog scraper run logs
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='catalog_scraper_logs' AND xtype='U')
    CREATE TABLE catalog_scraper_logs (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      source        NVARCHAR(100) NOT NULL,
      status        NVARCHAR(20)  NOT NULL DEFAULT 'running',
      started_at    DATETIME2 DEFAULT GETDATE(),
      finished_at   DATETIME2 NULL,
      items_found   INT DEFAULT 0,
      items_added   INT DEFAULT 0,
      items_updated INT DEFAULT 0,
      error_msg     NVARCHAR(500) NULL,
      triggered_by  NVARCHAR(50)  DEFAULT 'schedule'
    )
  `);
  // Migrate: add items_updated column if missing (for existing installs)
  await dbPool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('catalog_scraper_logs') AND name = 'items_updated')
      ALTER TABLE catalog_scraper_logs ADD items_updated INT DEFAULT 0
  `);

  // ── Demo organisation ─────────────────────────────────────────────────────
  // Seed a read-only demo org + branch + user if they don't exist yet.
  // Demo data (customers / suppliers / tires) is also seeded here once.
  // Transactional data (sales / purchases) is seeded by the demoCleanup job.
  await seedDemoOrg(dbPool, sql);

  // Seed global tire catalog (merges new brands/models on every restart)
  await seedTireCatalog(dbPool, sql);

  // Seed Pakistan-market vehicle fitment reference data
  await seedVehicleFitments(dbPool, sql);

  await dbPool.close();

  pool = new sql.ConnectionPool({ ...baseConfig, database: 'TireProDB' });
  await pool.connect();
  console.log('✅ Database TireProDB and all tables ready.');
}

// ── Demo org seeder ───────────────────────────────────────────────────────────
async function seedDemoOrg(pool, sqlLib) {
  // Idempotent — only runs if the demo org doesn't exist yet
  const existing = await pool.request()
    .input('code', sqlLib.NVarChar, 'DEMO')
    .query('SELECT id FROM organizations WHERE code = @code');
  if (existing.recordset.length > 0) return;

  // 1. Create demo organisation
  const orgRes = await pool.request()
    .input('name', sqlLib.NVarChar, 'TirePro Demo')
    .input('code', sqlLib.NVarChar, 'DEMO')
    .input('type', sqlLib.NVarChar, 'retail')
    .query(`
      INSERT INTO organizations (name, code, type)
      OUTPUT INSERTED.id
      VALUES (@name, @code, @type)
    `);
  const demoOrgId = orgRes.recordset[0].id;

  // 2. Create demo branch
  const branchRes = await pool.request()
    .input('org_id', sqlLib.Int,      demoOrgId)
    .input('name',   sqlLib.NVarChar, 'Demo Branch')
    .input('code',   sqlLib.NVarChar, 'DEMO-BR')
    .query(`
      INSERT INTO branches (organization_id, name, code)
      OUTPUT INSERTED.id
      VALUES (@org_id, @name, @code)
    `);
  const demoBranchId = branchRes.recordset[0].id;

  // 3. Seed demo settings
  const demoSettings = [
    ['company_name',        'TirePro Demo'],
    ['company_tagline',     'Demo Tyre Shop — Explore Freely'],
    ['company_address',     '1 Demo Street, Lahore, Pakistan'],
    ['company_phone',       '+92-42-0000000'],
    ['company_email',       'demo@tirepro.app'],
    ['invoice_prefix',      'DEMO'],
    ['po_prefix',           'DEMO-PO'],
    ['default_tax_rate',    '15'],
    ['payment_due_days',    '30'],
    ['default_sale_status', 'pending'],
    ['currency',            'PKR'],
    ['announcement',        'You are in Demo Mode — data resets every 30 minutes'],
    ['refresh_interval',    '60'],
  ];
  for (const [key, value] of demoSettings) {
    await pool.request()
      .input('org_id', sqlLib.Int,      demoOrgId)
      .input('key',    sqlLib.NVarChar, key)
      .input('value',  sqlLib.NVarChar, value)
      .query(`INSERT INTO settings (organization_id, [key], value) VALUES (@org_id, @key, @value)`);
  }

  // 4. Create demo user (role = 'demo')
  const demoHash = await require('bcryptjs').hash('demo1234', 10);
  await pool.request()
    .input('name',            sqlLib.NVarChar, 'Demo User')
    .input('email',           sqlLib.NVarChar, 'demo@tirepro.app')
    .input('password_hash',   sqlLib.NVarChar, demoHash)
    .input('role',            sqlLib.NVarChar, 'demo')
    .input('organization_id', sqlLib.Int,      demoOrgId)
    .query(`
      INSERT INTO users (name, email, password_hash, role, organization_id)
      VALUES (@name, @email, @password_hash, @role, @organization_id)
    `);

  // 5. Seed demo customers
  const demoCustomers = [
    { code: 'C-DEMO-001', name: 'Ahmed Motors',         phone: '0300-1111111', email: 'ahmed@demo.pk' },
    { code: 'C-DEMO-002', name: 'Bilal Auto Works',     phone: '0301-2222222', email: 'bilal@demo.pk' },
    { code: 'C-DEMO-003', name: 'Karachi Wheel House',  phone: '0302-3333333', email: 'kwh@demo.pk'   },
    { code: 'C-DEMO-004', name: 'Raza Tyre Center',     phone: '0303-4444444', email: 'raza@demo.pk'  },
    { code: 'C-DEMO-005', name: 'Star Auto Garage',     phone: '0304-5555555', email: 'star@demo.pk'  },
  ];
  for (const c of demoCustomers) {
    await pool.request()
      .input('code',    sqlLib.NVarChar, c.code)
      .input('name',    sqlLib.NVarChar, c.name)
      .input('phone',   sqlLib.NVarChar, c.phone)
      .input('email',   sqlLib.NVarChar, c.email)
      .input('org_id',  sqlLib.Int,      demoOrgId)
      .query(`
        INSERT INTO customers (code, name, phone, email, organization_id)
        VALUES (@code, @name, @phone, @email, @org_id)
      `);
  }

  // 6. Seed demo suppliers
  const demoSuppliers = [
    { code: 'S-DEMO-001', name: 'Bridgestone Pakistan',   phone: '0311-1111111', email: 'bs@demo.pk'  },
    { code: 'S-DEMO-002', name: 'GTR Tyres Ltd',          phone: '0312-2222222', email: 'gtr@demo.pk' },
    { code: 'S-DEMO-003', name: 'Hankook Distributors',   phone: '0313-3333333', email: 'hk@demo.pk'  },
  ];
  for (const s of demoSuppliers) {
    await pool.request()
      .input('code',   sqlLib.NVarChar, s.code)
      .input('name',   sqlLib.NVarChar, s.name)
      .input('phone',  sqlLib.NVarChar, s.phone)
      .input('email',  sqlLib.NVarChar, s.email)
      .input('org_id', sqlLib.Int,      demoOrgId)
      .query(`
        INSERT INTO suppliers (code, name, phone, email, organization_id)
        VALUES (@code, @name, @phone, @email, @org_id)
      `);
  }

  // 7. Seed demo tire inventory
  const demoTires = [
    { brand: 'Bridgestone', model: 'Turanza T005',       size: '205/55R16', type: 'Passenger',    stock: 24, cost: 12500, sale: 15000 },
    { brand: 'Michelin',    model: 'Pilot Sport 4',      size: '225/45R17', type: 'Performance',  stock: 18, cost: 18000, sale: 22000 },
    { brand: 'Continental', model: 'PremiumContact 6',   size: '195/65R15', type: 'Passenger',    stock: 30, cost: 10500, sale: 13000 },
    { brand: 'Yokohama',    model: 'BluEarth GT AE51',   size: '215/60R16', type: 'Passenger',    stock: 12, cost: 11000, sale: 14000 },
    { brand: 'Hankook',     model: 'Ventus Prime 4',     size: '205/60R16', type: 'Passenger',    stock: 20, cost: 9500,  sale: 12000 },
    { brand: 'Goodyear',    model: 'EfficientGrip 2',    size: '185/65R15', type: 'Passenger',    stock: 35, cost: 8800,  sale: 11000 },
    { brand: 'GTR',         model: 'HP10',               size: '195/55R15', type: 'Passenger',    stock: 50, cost: 4500,  sale:  6000 },
    { brand: 'GTR',         model: 'HP10',               size: '215/60R16', type: 'SUV',          stock: 40, cost: 5200,  sale:  7000 },
    { brand: 'Dunlop',      model: 'SportMaxx RT2',      size: '225/50R17', type: 'Performance',  stock: 15, cost: 15000, sale: 18500 },
    { brand: 'Falken',      model: 'ZIEX ZE914',         size: '205/55R16', type: 'Passenger',    stock: 22, cost: 7500,  sale:  9500 },
  ];
  for (const t of demoTires) {
    await pool.request()
      .input('brand',      sqlLib.NVarChar,      t.brand)
      .input('model',      sqlLib.NVarChar,      t.model)
      .input('size',       sqlLib.NVarChar,      t.size)
      .input('type',       sqlLib.NVarChar,      t.type)
      .input('stock',      sqlLib.Int,           t.stock)
      .input('cost_price', sqlLib.Decimal(18,2), t.cost)
      .input('sale_price', sqlLib.Decimal(18,2), t.sale)
      .input('org_id',     sqlLib.Int,           demoOrgId)
      .input('branch_id',  sqlLib.Int,           demoBranchId)
      .query(`
        INSERT INTO tires (brand, model, size, type, stock, cost_price, sale_price, organization_id, branch_id)
        VALUES (@brand, @model, @size, @type, @stock, @cost_price, @sale_price, @org_id, @branch_id)
      `);
  }

  // 8. Seed demo services
  const demoServices = [
    { name: 'Tire Fitting',      sale: 300,  cost: 100, desc: 'Mount and fit tyre to wheel rim' },
    { name: 'Wheel Balancing',   sale: 250,  cost: 80,  desc: 'Dynamic wheel balancing with weights' },
    { name: 'Wheel Alignment',   sale: 1500, cost: 500, desc: '4-wheel laser alignment' },
    { name: 'Puncture Repair',   sale: 200,  cost: 50,  desc: 'Tubeless puncture plug and patch repair' },
  ];
  for (const svc of demoServices) {
    await pool.request()
      .input('name',   sqlLib.NVarChar,      svc.name)
      .input('desc',   sqlLib.NVarChar,      svc.desc)
      .input('sale',   sqlLib.Decimal(18,2), svc.sale)
      .input('cost',   sqlLib.Decimal(18,2), svc.cost)
      .input('org_id', sqlLib.Int,           demoOrgId)
      .query(`
        INSERT INTO products (organization_id, name, description, category, unit, sale_price, cost_price, is_active)
        VALUES (@org_id, @name, @desc, 'Service', 'job', @sale, @cost, 1)
      `);
  }

  console.log('✅ Demo org, branch, user and master data seeded (org_id =', demoOrgId, ')');

  // Seed initial demo transactions immediately (the cleanup cron will refresh them every 30 min)
  try {
    const { seedDemoTransactions } = require('./jobs/demoCleanup');
    await seedDemoTransactions(pool, demoOrgId, demoBranchId);
    console.log('✅ Demo transactions seeded for org_id =', demoOrgId);
  } catch (err) {
    // Non-fatal — the cleanup cron will seed on its next run
    console.warn('⚠ Could not seed demo transactions:', err.message);
  }
}

module.exports = { getPool, setupDatabase, getSetting, sql };
