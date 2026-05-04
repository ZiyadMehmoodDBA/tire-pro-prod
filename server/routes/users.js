const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const { getPool, sql } = require('../db');
const { getContext }   = require('../context');
const { requireRole }  = require('../middleware/auth');

// All user-management endpoints are org_admin only
router.use(requireRole('org_admin'));

const VALID_ROLES = ['org_admin', 'branch_manager', 'staff'];

// GET /api/users — list all users in this organisation
router.get('/', async (req, res) => {
  try {
    const { orgId } = getContext(req);
    const pool = await getPool();
    const result = await pool.request()
      .input('orgId', sql.Int, orgId)
      .query(`
        SELECT u.id, u.name, u.email, u.phone, u.role,
               u.branch_id, b.name AS branch_name,
               u.is_active, u.created_at
        FROM users u
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE u.organization_id = @orgId
        ORDER BY u.name
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — create a new staff account in this org
router.post('/', async (req, res) => {
  try {
    const { orgId } = getContext(req);
    const { name, email, phone, password, role, branch_id } = req.body;

    if (!name?.trim())                    return res.status(400).json({ error: 'Name is required' });
    if (!email?.includes('@'))            return res.status(400).json({ error: 'A valid email is required' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!VALID_ROLES.includes(role))      return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });

    const pool = await getPool();

    // Global email uniqueness check (users are unique by email across all orgs)
    const dup = await pool.request()
      .input('email', sql.NVarChar, email.toLowerCase().trim())
      .query('SELECT id FROM users WHERE email = @email');
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.request()
      .input('orgId',    sql.Int,      orgId)
      .input('name',     sql.NVarChar, name.trim())
      .input('email',    sql.NVarChar, email.toLowerCase().trim())
      .input('phone',    sql.NVarChar, phone?.trim() || '')
      .input('hash',     sql.NVarChar, hash)
      .input('role',     sql.NVarChar, role)
      .input('branchId', sql.Int,      branch_id || null)
      .query(`
        INSERT INTO users (organization_id, name, email, phone, password_hash, role, branch_id, is_active)
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.email, INSERTED.phone,
               INSERTED.role, INSERTED.branch_id, INSERTED.is_active, INSERTED.created_at
        VALUES (@orgId, @name, @email, @phone, @hash, @role, @branchId, 1)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — update name, phone, role, branch (not password)
router.put('/:id', async (req, res) => {
  try {
    const { orgId } = getContext(req);
    const { name, phone, role, branch_id } = req.body;

    if (!name?.trim())               return res.status(400).json({ error: 'Name is required' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });

    // Prevent an admin from demoting their own account (to avoid lockout)
    if (Number(req.params.id) === req.user.userId && role !== 'org_admin') {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('id',       sql.Int,      req.params.id)
      .input('orgId',    sql.Int,      orgId)
      .input('name',     sql.NVarChar, name.trim())
      .input('phone',    sql.NVarChar, phone?.trim() || '')
      .input('role',     sql.NVarChar, role)
      .input('branchId', sql.Int,      branch_id || null)
      .query(`
        UPDATE users
        SET name=@name, phone=@phone, role=@role, branch_id=@branchId
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.email, INSERTED.phone,
               INSERTED.role, INSERTED.branch_id, INSERTED.is_active
        WHERE id=@id AND organization_id=@orgId
      `);
    if (!result.recordset.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/password — admin resets another user's password
router.patch('/:id/password', async (req, res) => {
  try {
    const { orgId } = getContext(req);
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    // Admins may not reset their own password via this endpoint (use login flow)
    if (Number(req.params.id) === req.user.userId) {
      return res.status(400).json({ error: 'Use the account settings to change your own password' });
    }
    const pool = await getPool();

    const userCheck = await pool.request()
      .input('id',    sql.Int, req.params.id)
      .input('orgId', sql.Int, orgId)
      .query(`SELECT is_active FROM users WHERE id=@id AND organization_id=@orgId`);
    if (!userCheck.recordset.length) return res.status(404).json({ error: 'User not found' });
    if (!userCheck.recordset[0].is_active) {
      return res.status(400).json({ error: 'Cannot reset password of an inactive user. Activate the account first.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.request()
      .input('id',    sql.Int,      req.params.id)
      .input('orgId', sql.Int,      orgId)
      .input('hash',  sql.NVarChar, hash)
      .query(`UPDATE users SET password_hash=@hash OUTPUT INSERTED.id WHERE id=@id AND organization_id=@orgId`);
    if (!result.recordset.length) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/status — activate or deactivate
router.patch('/:id/status', async (req, res) => {
  try {
    const { orgId } = getContext(req);
    const is_active = req.body.is_active !== false;   // default true

    if (Number(req.params.id) === req.user.userId && !is_active) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('id',       sql.Int, req.params.id)
      .input('orgId',    sql.Int, orgId)
      .input('isActive', sql.Bit, is_active ? 1 : 0)
      .query(`
        UPDATE users SET is_active=@isActive
        OUTPUT INSERTED.id, INSERTED.is_active
        WHERE id=@id AND organization_id=@orgId
      `);
    if (!result.recordset.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
