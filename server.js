const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookie = require('cookie');
const { pool, init } = require('./db');

const PORT = process.env.PORT || 3000;
const PIN = process.env.PANEL_PIN || '';
const SECRET = process.env.SESSION_SECRET || 'change-me-please-alquileres-monica';
const COOKIE_NAME = 'am_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 45; // 45 dias

if (!PIN) {
  console.warn('ADVERTENCIA: no configuraste PANEL_PIN. El panel va a rechazar todos los logins hasta que lo configures.');
}

function sign(value) {
  const h = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  return value + '.' + h;
}
function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return value;
}

const app = express();
app.use(express.json());

app.post('/api/login', (req, res) => {
  const pin = String((req.body && req.body.pin) || '');
  if (!PIN || pin.length === 0 || pin.length !== PIN.length ||
      !crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(PIN))) {
    return res.status(401).json({ ok: false, error: 'PIN incorrecto' });
  }
  const token = sign('authed:' + Date.now());
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS / 1000,
    path: '/'
  }));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', { maxAge: 0, path: '/' }));
  res.json({ ok: true });
});

function isAuthed(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const raw = cookies[COOKIE_NAME];
  const value = verify(raw);
  return !!value && value.startsWith('authed:');
}

app.get('/api/session', (req, res) => {
  res.json({ authenticated: isAuthed(req) });
});

function requireAuth(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'no autenticado' });
  next();
}

app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/session') return next();
  return requireAuth(req, res, next);
});

app.get('/api/state', async (req, res) => {
  try {
    const [properties, contracts, payments, expenses] = await Promise.all([
      pool.query('SELECT * FROM properties ORDER BY nombre'),
      pool.query('SELECT * FROM contracts ORDER BY fecha_inicio DESC'),
      pool.query('SELECT * FROM payments'),
      pool.query('SELECT * FROM expenses ORDER BY fecha DESC')
    ]);
    res.json({
      properties: properties.rows,
      contracts: contracts.rows,
      payments: payments.rows,
      expenses: expenses.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'error de base de datos' });
  }
});

function crud(table, fields) {
  const cols = fields.join(', ');
  const placeholders = fields.map((_, i) => '$' + (i + 1)).join(', ');

  app.post('/api/' + table, async (req, res) => {
    try {
      const values = fields.map(f => req.body[f] === undefined ? null : req.body[f]);
      const q = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
      const r = await pool.query(q, values);
      res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/' + table + '/:id', async (req, res) => {
    try {
      const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
      const values = fields.map(f => req.body[f] === undefined ? null : req.body[f]);
      values.push(req.params.id);
      const q = `UPDATE ${table} SET ${sets} WHERE id = $${fields.length + 1} RETURNING *`;
      const r = await pool.query(q, values);
      if (!r.rows[0]) return res.status(404).json({ error: 'no encontrado' });
      res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/' + table + '/:id', async (req, res) => {
    try {
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  });
}

crud('properties', ['nombre', 'tipo', 'alquiler_base', 'notas']);
crud('contracts', ['property_id', 'inquilino', 'contacto', 'fecha_inicio', 'fecha_fin', 'monto_mensual', 'deposito', 'estado', 'notas']);
crud('expenses', ['property_id', 'categoria', 'monto', 'fecha', 'descripcion']);

// payments: upsert by (contract_id, mes)
app.post('/api/payments', async (req, res) => {
  try {
    const { contract_id, property_id, mes, monto_esperado, monto_pagado, fecha_pago, notas } = req.body;
    const q = `
      INSERT INTO payments (contract_id, property_id, mes, monto_esperado, monto_pagado, fecha_pago, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (contract_id, mes)
      DO UPDATE SET monto_pagado = EXCLUDED.monto_pagado, fecha_pago = EXCLUDED.fecha_pago,
                    notas = EXCLUDED.notas, monto_esperado = payments.monto_esperado
      RETURNING *`;
    const r = await pool.query(q, [contract_id, property_id, mes, monto_esperado || 0, monto_pagado || 0, fecha_pago || null, notas || '']);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});
app.put('/api/payments/:id', async (req, res) => {
  try {
    const { monto_pagado, fecha_pago, notas } = req.body;
    const r = await pool.query(
      'UPDATE payments SET monto_pagado=$1, fecha_pago=$2, notas=$3 WHERE id=$4 RETURNING *',
      [monto_pagado || 0, fecha_pago || null, notas || '', req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'no encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

init()
  .then(() => {
    app.listen(PORT, () => console.log('Alquileres Monica escuchando en puerto ' + PORT));
  })
  .catch(err => {
    console.error('No se pudo inicializar la base de datos:', err);
    process.exit(1);
  });
