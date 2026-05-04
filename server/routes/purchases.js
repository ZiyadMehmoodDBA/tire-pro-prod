const express = require('express');
const router  = express.Router();
const { getPool, getSetting, sql } = require('../db');
const { getContext } = require('../context');

router.get('/', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const pool   = await getPool();
    const result = await pool.request()
      .input('orgId',    sql.Int, orgId)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT p.*, s.name AS supplier_name, s.code AS supplier_code
        FROM purchases p
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        WHERE p.organization_id = @orgId AND p.branch_id = @branchId
        ORDER BY p.created_at DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { orgId } = getContext(req);
    const pool = await getPool();
    const poRes = await pool.request()
      .input('id',    sql.Int, req.params.id)
      .input('orgId', sql.Int, orgId)
      .query(`
        SELECT p.*, s.name AS supplier_name, s.code AS supplier_code,
               s.phone AS supplier_phone, s.email AS supplier_email, s.address AS supplier_address
        FROM purchases p
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        WHERE p.id = @id AND p.organization_id = @orgId
      `);
    if (!poRes.recordset.length) return res.status(404).json({ error: 'Not found' });

    const itemsRes = await pool.request()
      .input('purchase_id', sql.Int, req.params.id)
      .query(`
        SELECT pi.*, t.brand, t.model, t.size,
               p.name AS product_name, p.category AS product_category, p.unit AS product_unit
        FROM purchase_items pi
        LEFT JOIN tires    t ON pi.tire_id    = t.id
        LEFT JOIN products p ON pi.product_id = p.id
        WHERE pi.purchase_id = @purchase_id
      `);
    res.json({ ...poRes.recordset[0], items: itemsRes.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { orgId, branchId } = getContext(req);
  const pool        = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    const { supplier_id, date, items, status = 'pending', notes } = req.body;
    if (!supplier_id) return res.status(400).json({ error: 'Supplier is required' });
    if (!items?.length) return res.status(400).json({ error: 'At least one item is required' });

    const countRes = await pool.request()
      .input('orgId', sql.Int, orgId)
      .query('SELECT COUNT(*) AS cnt FROM purchases WHERE organization_id = @orgId');
    const prefix = await getSetting('po_prefix', 'PO', orgId);
    const poNo   = `${prefix}-${new Date().getFullYear()}-${String(countRes.recordset[0].cnt + 1).padStart(3, '0')}`;

    const subtotal = items.reduce((s, it) => s + (it.qty * it.unit_price), 0);
    const total    = parseFloat(subtotal.toFixed(2));

    await transaction.begin();

    const poRes = await new sql.Request(transaction)
      .input('org_id',     sql.Int,          orgId)
      .input('branch_id',  sql.Int,          branchId)
      .input('po_no',      sql.NVarChar,     poNo)
      .input('supplier_id',sql.Int,          supplier_id)
      .input('date',       sql.Date,         date || new Date())
      .input('subtotal',   sql.Decimal(18,2), subtotal)
      .input('tax',        sql.Decimal(18,2), 0)
      .input('total',      sql.Decimal(18,2), total)
      .input('status',     sql.NVarChar,     status)
      .input('notes',      sql.NVarChar,     notes || '')
      .query(`
        INSERT INTO purchases (organization_id, branch_id, po_no, supplier_id, date, subtotal, tax, total, status, notes)
        OUTPUT INSERTED.*
        VALUES (@org_id, @branch_id, @po_no, @supplier_id, @date, @subtotal, @tax, @total, @status, @notes)
      `);
    const purchaseId = poRes.recordset[0].id;

    for (const item of items) {
      const itemName  = item.tire_name || item.item_name || (item.tire_id ? `Tire #${item.tire_id}` : `Product #${item.product_id}`);
      const amount    = parseFloat((item.qty * item.unit_price).toFixed(2));
      const tireId    = item.tire_id    ? Number(item.tire_id)    : null;
      const productId = item.product_id ? Number(item.product_id) : null;
      await new sql.Request(transaction)
        .input('purchase_id', sql.Int,          purchaseId)
        .input('tire_id',     sql.Int,          tireId)
        .input('product_id',  sql.Int,          productId)
        .input('tire_name',   sql.NVarChar,     itemName)
        .input('qty',         sql.Int,          item.qty)
        .input('unit_price',  sql.Decimal(18,2), item.unit_price)
        .input('amount',      sql.Decimal(18,2), amount)
        .query(`INSERT INTO purchase_items (purchase_id,tire_id,product_id,tire_name,qty,unit_price,amount) VALUES (@purchase_id,@tire_id,@product_id,@tire_name,@qty,@unit_price,@amount)`);

      if (status === 'received' && tireId) {
        await new sql.Request(transaction)
          .input('tire_id', sql.Int, tireId)
          .input('qty',     sql.Int, item.qty)
          .query('UPDATE tires SET stock = stock + @qty WHERE id = @tire_id');
      }
    }

    await transaction.commit();
    res.status(201).json({ ...poRes.recordset[0], po_no: poNo });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  const { orgId } = getContext(req);
  const pool        = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    const { status } = req.body;
    if (!['pending', 'received', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    await transaction.begin();

    const current = await new sql.Request(transaction)
      .input('id',    sql.Int, req.params.id)
      .input('orgId', sql.Int, orgId)
      .query('SELECT status FROM purchases WHERE id = @id AND organization_id = @orgId');

    await new sql.Request(transaction)
      .input('id',     sql.Int,      req.params.id)
      .input('status', sql.NVarChar, status)
      .query('UPDATE purchases SET status = @status WHERE id = @id');

    if (status === 'received' && current.recordset[0]?.status !== 'received') {
      const itemsRes = await new sql.Request(transaction)
        .input('purchase_id', sql.Int, req.params.id)
        .query('SELECT tire_id, qty FROM purchase_items WHERE purchase_id = @purchase_id');
      for (const item of itemsRes.recordset) {
        if (item.tire_id) {
          await new sql.Request(transaction)
            .input('tire_id', sql.Int, item.tire_id).input('qty', sql.Int, item.qty)
            .query('UPDATE tires SET stock = stock + @qty WHERE id = @tire_id');
          await new sql.Request(transaction)
            .input('tire_id',   sql.Int,      item.tire_id)
            .input('qty',       sql.Int,      item.qty)
            .input('reason',    sql.NVarChar, 'grn_received')
            .input('ref_id',    sql.Int,      Number(req.params.id))
            .query(`INSERT INTO stock_movements (tire_id,organization_id,branch_id,qty_change,reason,ref_id)
                    SELECT @tire_id,organization_id,branch_id,@qty,@reason,@ref_id FROM purchases WHERE id = @ref_id`);
        }
      }
    }

    if (status === 'cancelled' && current.recordset[0]?.status === 'received') {
      const itemsRes = await new sql.Request(transaction)
        .input('purchase_id', sql.Int, req.params.id)
        .query('SELECT tire_id, qty FROM purchase_items WHERE purchase_id = @purchase_id');
      for (const item of itemsRes.recordset) {
        if (item.tire_id) {
          await new sql.Request(transaction)
            .input('tire_id', sql.Int, item.tire_id).input('qty', sql.Int, item.qty)
            .query('UPDATE tires SET stock = CASE WHEN stock - @qty < 0 THEN 0 ELSE stock - @qty END WHERE id = @tire_id');
          await new sql.Request(transaction)
            .input('tire_id',   sql.Int,      item.tire_id)
            .input('qty',       sql.Int,      -item.qty)
            .input('reason',    sql.NVarChar, 'grn_cancelled')
            .input('ref_id',    sql.Int,      Number(req.params.id))
            .query(`INSERT INTO stock_movements (tire_id,organization_id,branch_id,qty_change,reason,ref_id)
                    SELECT @tire_id,organization_id,branch_id,@qty,@reason,@ref_id FROM purchases WHERE id = @ref_id`);
        }
      }
    }

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const { orgId } = getContext(req);
  const pool        = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();

    const poRes = await new sql.Request(transaction)
      .input('id',    sql.Int, req.params.id)
      .input('orgId', sql.Int, orgId)
      .query('SELECT status FROM purchases WHERE id = @id AND organization_id = @orgId');

    if (poRes.recordset[0]?.status === 'received') {
      const itemsRes = await new sql.Request(transaction)
        .input('purchase_id', sql.Int, req.params.id)
        .query('SELECT tire_id, qty FROM purchase_items WHERE purchase_id = @purchase_id');
      for (const item of itemsRes.recordset) {
        if (item.tire_id) {
          await new sql.Request(transaction)
            .input('tire_id', sql.Int, item.tire_id)
            .input('qty',     sql.Int, item.qty)
            .query('UPDATE tires SET stock = CASE WHEN stock - @qty < 0 THEN 0 ELSE stock - @qty END WHERE id = @tire_id');
        }
      }
    }

    await new sql.Request(transaction)
      .input('id',    sql.Int, req.params.id)
      .input('orgId', sql.Int, orgId)
      .query('DELETE FROM purchases WHERE id = @id AND organization_id = @orgId');

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk', async (req, res) => {
  const { orgId, branchId } = getContext(req);
  const { pos } = req.body;
  if (!Array.isArray(pos) || pos.length === 0) {
    return res.status(400).json({ error: 'No purchase orders provided' });
  }
  const pool   = await getPool();
  const prefix = await getSetting('po_prefix', 'PO', orgId);
  let inserted = 0;
  const errors = [];

  for (const po of pos) {
    const transaction = new sql.Transaction(pool);
    try {
      const suppRes = await pool.request()
        .input('name',  sql.NVarChar, String(po.supplier_name || '').trim())
        .input('orgId', sql.Int,      orgId)
        .query('SELECT TOP 1 id FROM suppliers WHERE LOWER(name) = LOWER(@name) AND organization_id = @orgId');
      if (!suppRes.recordset.length) {
        errors.push({ ref: po.po_ref, message: `Supplier "${po.supplier_name}" not found` });
        continue;
      }
      const supplier_id = suppRes.recordset[0].id;
      const items       = Array.isArray(po.items) ? po.items : [];
      if (!items.length) { errors.push({ ref: po.po_ref, message: 'No line items' }); continue; }

      const resolvedItems = [];
      for (const item of items) {
        const itemName = String(item.item_name || '').trim();
        let tire_id = null, product_id = null;
        const prodRes = await pool.request()
          .input('n',     sql.NVarChar, itemName)
          .input('orgId', sql.Int,      orgId)
          .query('SELECT TOP 1 id FROM products WHERE LOWER(name) = LOWER(@n) AND is_active = 1 AND organization_id = @orgId');
        if (prodRes.recordset.length) {
          product_id = prodRes.recordset[0].id;
        } else {
          const tireRes = await pool.request()
            .input('n',        sql.NVarChar, itemName)
            .input('orgId',    sql.Int,      orgId)
            .input('branchId', sql.Int,      branchId)
            .query("SELECT TOP 1 id FROM tires WHERE LOWER(CONCAT(brand,' ',model,' ',size)) = LOWER(@n) AND organization_id = @orgId AND branch_id = @branchId");
          if (tireRes.recordset.length) tire_id = tireRes.recordset[0].id;
        }
        resolvedItems.push({ item_name: itemName, qty: Number(item.qty) || 1, unit_price: parseFloat(item.unit_price) || 0, tire_id, product_id });
      }

      const subtotal = resolvedItems.reduce((s, it) => s + it.qty * it.unit_price, 0);
      const total    = parseFloat(subtotal.toFixed(2));
      const status   = po.status || 'pending';

      await transaction.begin();
      const countRes = await new sql.Request(transaction)
        .input('orgId', sql.Int, orgId)
        .query('SELECT COUNT(*) AS cnt FROM purchases WHERE organization_id = @orgId');
      const po_no = `${prefix}-${new Date().getFullYear()}-${String(countRes.recordset[0].cnt + 1).padStart(3, '0')}`;

      const poRes = await new sql.Request(transaction)
        .input('org_id',     sql.Int,          orgId)
        .input('branch_id',  sql.Int,          branchId)
        .input('po_no',      sql.NVarChar,     po_no)
        .input('supplier_id',sql.Int,          supplier_id)
        .input('date',       sql.Date,         po.date || new Date())
        .input('subtotal',   sql.Decimal(18,2), subtotal)
        .input('tax',        sql.Decimal(18,2), 0)
        .input('total',      sql.Decimal(18,2), total)
        .input('status',     sql.NVarChar,     status)
        .input('notes',      sql.NVarChar,     po.notes || '')
        .query(`INSERT INTO purchases (organization_id,branch_id,po_no,supplier_id,date,subtotal,tax,total,status,notes)
                OUTPUT INSERTED.id VALUES (@org_id,@branch_id,@po_no,@supplier_id,@date,@subtotal,@tax,@total,@status,@notes)`);
      const purchaseId = poRes.recordset[0].id;

      for (const item of resolvedItems) {
        const amount = parseFloat((item.qty * item.unit_price).toFixed(2));
        await new sql.Request(transaction)
          .input('purchase_id', sql.Int,          purchaseId)
          .input('tire_id',     sql.Int,          item.tire_id)
          .input('product_id',  sql.Int,          item.product_id)
          .input('tire_name',   sql.NVarChar,     item.item_name)
          .input('qty',         sql.Int,          item.qty)
          .input('unit_price',  sql.Decimal(18,2), item.unit_price)
          .input('amount',      sql.Decimal(18,2), amount)
          .query(`INSERT INTO purchase_items (purchase_id,tire_id,product_id,tire_name,qty,unit_price,amount) VALUES (@purchase_id,@tire_id,@product_id,@tire_name,@qty,@unit_price,@amount)`);
        if (status === 'received' && item.tire_id) {
          await new sql.Request(transaction)
            .input('tire_id', sql.Int, item.tire_id)
            .input('qty',     sql.Int, item.qty)
            .query('UPDATE tires SET stock = stock + @qty WHERE id = @tire_id');
        }
      }
      await transaction.commit();
      inserted++;
    } catch (err) {
      try { await transaction.rollback(); } catch {}
      errors.push({ ref: po.po_ref, message: err.message });
    }
  }
  res.json({ inserted, errors });
});

module.exports = router;
