const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { getContext }   = require('../context');

const TYPE_MAP = {
  'Passenger Radial':  'Passenger',
  'Light Truck Bias':  'Light Truck',
  'Light Truck Radial':'Light Truck',
  'Truck/Bus':         'Truck',
  'Tractor Front':     'Tractor',
  'Tractor Rear':      'Tractor',
};

function buildModel(design, plyRating, category) {
  return category === 'Passenger Radial' ? design : `${design} ${plyRating}PR`;
}

// GET /api/price-lists
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`
      SELECT pl.id, pl.supplier_name, pl.effective_date, pl.notes, pl.created_at,
             COUNT(pi.id) AS item_count
      FROM dealer_price_lists pl
      LEFT JOIN dealer_price_items pi ON pi.list_id = pl.id
      GROUP BY pl.id, pl.supplier_name, pl.effective_date, pl.notes, pl.created_at
      ORDER BY pl.effective_date DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/price-lists/:id/items — includes auto-detected inventory match + linked tire
router.get('/:id/items', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const pool   = await getPool();
    const result = await pool.request()
      .input('listId',   sql.Int, parseInt(req.params.id))
      .input('orgId',    sql.Int, orgId)
      .input('branchId', sql.Int, branchId)
      .query(`
        SELECT
          dpi.id, dpi.list_id, dpi.category, dpi.size, dpi.design,
          dpi.ply_rating, dpi.dealer_price, dpi.tyre_total,
          dpi.tube_total, dpi.flap_total, dpi.linked_tire_id,
          -- auto-detected match (BG brand+model+size)
          t.id         AS tire_id,
          t.cost_price AS current_cost,
          t.sale_price AS current_sale,
          t.stock      AS current_stock,
          -- manually linked tire (may differ from auto-detected)
          lt.id        AS lt_id,
          lt.brand     AS linked_brand,
          lt.model     AS linked_model,
          lt.size      AS linked_size,
          lt.cost_price AS linked_cost,
          lt.sale_price AS linked_sale
        FROM dealer_price_items dpi
        LEFT JOIN tires t
          ON  t.brand           = 'BG'
          AND t.model           = CASE
                WHEN dpi.category = 'Passenger Radial' THEN dpi.design
                ELSE dpi.design + ' ' + CAST(dpi.ply_rating AS NVARCHAR(10)) + 'PR'
              END
          AND t.size            = dpi.size
          AND t.organization_id = @orgId
          AND t.branch_id       = @branchId
        LEFT JOIN tires lt
          ON  lt.id             = dpi.linked_tire_id
          AND lt.organization_id = @orgId
          AND lt.branch_id      = @branchId
        WHERE dpi.list_id = @listId
        ORDER BY dpi.category, dpi.size, dpi.design, dpi.ply_rating
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/price-lists/items/:itemId/link — manually link or unlink to an inventory tire
router.put('/items/:itemId/link', async (req, res) => {
  try {
    const pool   = await getPool();
    const tireId = req.body.tire_id ?? null;
    await pool.request()
      .input('id',      sql.Int, parseInt(req.params.itemId))
      .input('tire_id', sql.Int, tireId)
      .query(`UPDATE dealer_price_items SET linked_tire_id=@tire_id WHERE id=@id`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/price-lists/:id/import — upsert selected items into tires inventory
router.post('/:id/import', async (req, res) => {
  try {
    const { orgId, branchId } = getContext(req);
    const pool = await getPool();
    const { item_ids, margin } = req.body;
    if (!Array.isArray(item_ids) || !item_ids.length)
      return res.status(400).json({ error: 'No items selected' });

    const marginPct = Math.max(0, parseFloat(margin) || 0);
    let imported = 0, updated = 0;

    for (const itemId of item_ids) {
      const itemRes = await pool.request()
        .input('id', sql.Int, itemId)
        .query(`SELECT * FROM dealer_price_items WHERE id=@id`);
      if (!itemRes.recordset.length) continue;

      const item      = itemRes.recordset[0];
      const salePrice = Math.round(item.dealer_price * (1 + marginPct / 100));

      if (item.linked_tire_id) {
        await pool.request()
          .input('id',         sql.Int,            item.linked_tire_id)
          .input('orgId',      sql.Int,            orgId)
          .input('branchId',   sql.Int,            branchId)
          .input('cost_price', sql.Decimal(18, 2), item.dealer_price)
          .query(`UPDATE tires SET cost_price=@cost_price WHERE id=@id AND organization_id=@orgId AND branch_id=@branchId`);
        updated++;
      } else {
        const model    = buildModel(item.design, item.ply_rating, item.category);
        const tireType = TYPE_MAP[item.category] || 'Passenger';

        const existsRes = await pool.request()
          .input('orgId',    sql.Int,      orgId)
          .input('branchId', sql.Int,      branchId)
          .input('model',    sql.NVarChar, model)
          .input('size',     sql.NVarChar, item.size)
          .query(`SELECT id FROM tires WHERE organization_id=@orgId AND branch_id=@branchId AND brand='BG' AND model=@model AND size=@size`);

        if (existsRes.recordset.length) {
          await pool.request()
            .input('id',         sql.Int,            existsRes.recordset[0].id)
            .input('cost_price', sql.Decimal(18, 2), item.dealer_price)
            .query(`UPDATE tires SET cost_price=@cost_price WHERE id=@id`);
          updated++;
        } else {
          await pool.request()
            .input('orgId',      sql.Int,            orgId)
            .input('branchId',   sql.Int,            branchId)
            .input('model',      sql.NVarChar,       model)
            .input('size',       sql.NVarChar,       item.size)
            .input('type',       sql.NVarChar,       tireType)
            .input('cost_price', sql.Decimal(18, 2), item.dealer_price)
            .input('sale_price', sql.Decimal(18, 2), salePrice)
            .query(`
              INSERT INTO tires (organization_id,branch_id,brand,model,size,type,stock,cost_price,sale_price)
              VALUES (@orgId,@branchId,'BG',@model,@size,@type,0,@cost_price,@sale_price)
            `);
          imported++;
        }
      }
    }

    res.json({ imported, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
