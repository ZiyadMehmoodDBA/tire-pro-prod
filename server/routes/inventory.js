const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { getContext }   = require('../context');
const { writeAudit }   = require('../utils/audit');

router.get('/', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const pool   = await getPool();
    const result = await pool.request()
      .input('orgId',    sql.Int, orgId)
      .input('branchId', sql.Int, branchId)
      .query('SELECT * FROM tires WHERE organization_id = @orgId AND branch_id = @branchId ORDER BY brand, model');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /inventory/catalog-brands — list all brands available in tire_catalog ── */
router.get('/catalog-brands', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query('SELECT DISTINCT brand FROM tire_catalog ORDER BY brand');
    res.json(result.recordset.map(r => r.brand));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const pool   = await getPool();
    const result = await pool.request()
      .input('id',       sql.Int, req.params.id)
      .input('orgId',    sql.Int, orgId)
      .input('branchId', sql.Int, branchId)
      .query('SELECT * FROM tires WHERE id = @id AND organization_id = @orgId AND branch_id = @branchId');
    if (!result.recordset.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const {
      brand, model, size, type, stock, cost_price, sale_price, reorder_level,
      pattern, load_index, speed_index, dot,
    } = req.body;
    if (!brand || !model || !size) return res.status(400).json({ error: 'Brand, model, and size are required' });
    const pool   = await getPool();
    const result = await pool.request()
      .input('orgId',         sql.Int,           orgId)
      .input('branchId',      sql.Int,           branchId)
      .input('brand',         sql.NVarChar,      brand)
      .input('model',         sql.NVarChar,      model)
      .input('size',          sql.NVarChar,      size)
      .input('type',          sql.NVarChar,      type || 'Passenger')
      .input('stock',         sql.Int,           stock || 0)
      .input('cost_price',    sql.Decimal(18,2), cost_price || 0)
      .input('sale_price',    sql.Decimal(18,2), sale_price || 0)
      .input('reorder_level', sql.Int,           reorder_level || 10)
      .input('pattern',       sql.NVarChar,      pattern     || null)
      .input('load_index',    sql.NVarChar,      load_index  || null)
      .input('speed_index',   sql.NVarChar,      speed_index || null)
      .input('dot',           sql.NVarChar,      dot         || null)
      .query(`
        INSERT INTO tires
          (organization_id, branch_id, brand, model, size, type, stock, cost_price, sale_price,
           reorder_level, pattern, load_index, speed_index, dot)
        OUTPUT INSERTED.*
        VALUES
          (@orgId, @branchId, @brand, @model, @size, @type, @stock, @cost_price, @sale_price,
           @reorder_level, @pattern, @load_index, @speed_index, @dot)
      `);
    const row = result.recordset[0];
    writeAudit(pool, { orgId, branchId, userId: req.user?.userId,
      action: 'CREATE', entity: 'inventory', entityId: row.id,
      before: null, after: { id: row.id, brand: row.brand, model: row.model, size: row.size, stock: row.stock, sale_price: row.sale_price },
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const {
      brand, model, size, type, stock, cost_price, sale_price, reorder_level,
      pattern, load_index, speed_index, dot,
    } = req.body;
    const pool = await getPool();

    // Capture current state for audit
    const beforeRes = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT id, brand, model, size, type, stock, cost_price, sale_price, reorder_level FROM tires WHERE id = @id');
    const beforeRow = beforeRes.recordset[0] || null;

    const result = await pool.request()
      .input('id',            sql.Int,           req.params.id)
      .input('orgId',         sql.Int,           orgId)
      .input('branchId',      sql.Int,           branchId)
      .input('brand',         sql.NVarChar,      brand)
      .input('model',         sql.NVarChar,      model)
      .input('size',          sql.NVarChar,      size)
      .input('type',          sql.NVarChar,      type || 'Passenger')
      .input('stock',         sql.Int,           stock || 0)
      .input('cost_price',    sql.Decimal(18,2), cost_price || 0)
      .input('sale_price',    sql.Decimal(18,2), sale_price || 0)
      .input('reorder_level', sql.Int,           reorder_level || 10)
      .input('pattern',       sql.NVarChar,      pattern     || null)
      .input('load_index',    sql.NVarChar,      load_index  || null)
      .input('speed_index',   sql.NVarChar,      speed_index || null)
      .input('dot',           sql.NVarChar,      dot         || null)
      .query(`
        UPDATE tires SET
          brand=@brand, model=@model, size=@size, type=@type,
          stock=@stock, cost_price=@cost_price, sale_price=@sale_price, reorder_level=@reorder_level,
          pattern=@pattern, load_index=@load_index, speed_index=@speed_index, dot=@dot
        OUTPUT INSERTED.*
        WHERE id = @id AND organization_id = @orgId AND branch_id = @branchId
      `);
    const row = result.recordset[0];
    if (row && beforeRow) {
      writeAudit(pool, { orgId, branchId, userId: req.user?.userId,
        action: 'UPDATE', entity: 'inventory', entityId: row.id,
        before: { id: beforeRow.id, brand: beforeRow.brand, model: beforeRow.model, size: beforeRow.size, stock: beforeRow.stock, cost_price: beforeRow.cost_price, sale_price: beforeRow.sale_price, reorder_level: beforeRow.reorder_level },
        after:  { id: row.id,       brand: row.brand,       model: row.model,       size: row.size,       stock: row.stock,       cost_price: row.cost_price,       sale_price: row.sale_price,       reorder_level: row.reorder_level },
      });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const pool = await getPool();

    // Capture before deletion for audit
    const beforeRes = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT id, brand, model, size, type, stock, sale_price FROM tires WHERE id = @id');
    const beforeRow = beforeRes.recordset[0] || null;

    const saleCheck = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT COUNT(*) AS cnt FROM sale_items WHERE tire_id = @id');
    if (saleCheck.recordset[0].cnt > 0) {
      return res.status(400).json({ error: 'Cannot delete tire — it appears in existing sales records.' });
    }
    const poCheck = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT COUNT(*) AS cnt FROM purchase_items WHERE tire_id = @id');
    if (poCheck.recordset[0].cnt > 0) {
      return res.status(400).json({ error: 'Cannot delete tire — it appears in existing purchase orders.' });
    }
    await pool.request()
      .input('id',       sql.Int, req.params.id)
      .input('orgId',    sql.Int, orgId)
      .input('branchId', sql.Int, branchId)
      .query('DELETE FROM tires WHERE id = @id AND organization_id = @orgId AND branch_id = @branchId');

    writeAudit(pool, { orgId, branchId, userId: req.user?.userId,
      action: 'DELETE', entity: 'inventory', entityId: Number(req.params.id),
      before: beforeRow, after: null,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /inventory/import-catalog — bulk import catalog entries into tires ── */
router.post('/import-catalog', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const { brands } = req.body; // optional string[]
    const pool  = await getPool();
    const dbReq = pool.request()
      .input('orgId',    sql.Int, orgId)
      .input('branchId', sql.Int, branchId);

    let brandFilter = '';
    if (Array.isArray(brands) && brands.length > 0) {
      const paramList = brands.map((b, i) => {
        dbReq.input(`br${i}`, sql.NVarChar, b);
        return `@br${i}`;
      });
      brandFilter = `AND tc.brand IN (${paramList.join(',')})`;
    }

    const result = await dbReq.query(`
      INSERT INTO tires
        (organization_id, branch_id, brand, model, size, type, pattern, load_index, speed_index,
         stock, cost_price, sale_price, reorder_level)
      SELECT
        @orgId, @branchId,
        tc.brand, tc.model, tc.size,
        ISNULL(tc.tire_type, 'Passenger'),
        tc.pattern, tc.load_index, tc.speed_index,
        0, 0, 0, 10
      FROM tire_catalog tc
      WHERE NOT EXISTS (
        SELECT 1 FROM tires t
        WHERE t.brand = tc.brand AND t.model = tc.model AND t.size = tc.size
          AND t.organization_id = @orgId AND t.branch_id = @branchId
      )
      ${brandFilter}
    `);

    res.json({ inserted: result.rowsAffected[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk', async (req, res) => {
  const { orgId, branchId } = getContext(req);
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided' });
  }
  const pool = await getPool();
  let inserted = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const brand = String(row.brand || '').trim();
      const model = String(row.model || '').trim();
      const size  = String(row.size  || '').trim();
      if (!brand || !model || !size) {
        errors.push({ row: i + 2, message: 'brand, model, and size are required' });
        continue;
      }
      await pool.request()
        .input('orgId',         sql.Int,           orgId)
        .input('branchId',      sql.Int,           branchId)
        .input('brand',         sql.NVarChar,      brand)
        .input('model',         sql.NVarChar,      model)
        .input('size',          sql.NVarChar,      size)
        .input('type',          sql.NVarChar,      String(row.type || 'Passenger'))
        .input('cost_price',    sql.Decimal(18,2), parseFloat(row.cost_price  || 0))
        .input('sale_price',    sql.Decimal(18,2), parseFloat(row.sale_price  || 0))
        .input('stock',         sql.Int,           parseInt(row.stock         || 0))
        .input('reorder_level', sql.Int,           parseInt(row.reorder_level || 5))
        .input('pattern',       sql.NVarChar,      String(row.pattern     || '') || null)
        .input('load_index',    sql.NVarChar,      String(row.load_index  || '') || null)
        .input('speed_index',   sql.NVarChar,      String(row.speed_index || '') || null)
        .input('dot',           sql.NVarChar,      String(row.dot         || '') || null)
        .query(`
          INSERT INTO tires
            (organization_id, branch_id, brand, model, size, type, cost_price, sale_price, stock, reorder_level,
             pattern, load_index, speed_index, dot)
          VALUES
            (@orgId, @branchId, @brand, @model, @size, @type, @cost_price, @sale_price, @stock, @reorder_level,
             @pattern, @load_index, @speed_index, @dot)
        `);
      inserted++;
    } catch (err) {
      errors.push({ row: i + 2, message: err.message });
    }
  }
  res.json({ inserted, errors });
});

module.exports = router;
