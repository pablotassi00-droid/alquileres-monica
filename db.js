const { Pool, types } = require('pg');

// Devolver las columnas DATE como texto plano 'YYYY-MM-DD' en vez de un objeto Date
// (evita corrimientos de zona horaria y hace mas simple el frontend).
types.setTypeParser(1082, (val) => val);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Falta la variable de entorno DATABASE_URL (conectala al servicio de Postgres en Railway).');
}

const useSsl = /railway|render|amazonaws|neon\.tech|supabase/.test(connectionString || '') || process.env.PGSSL === 'true';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      creado TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS properties (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      tipo TEXT,
      alquiler_base NUMERIC DEFAULT 0,
      notas TEXT,
      creado TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY,
      property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
      inquilino TEXT NOT NULL,
      contacto TEXT,
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE,
      monto_mensual NUMERIC NOT NULL DEFAULT 0,
      deposito NUMERIC DEFAULT 0,
      estado TEXT DEFAULT 'activo',
      notas TEXT,
      creado TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      property_id INTEGER,
      mes TEXT NOT NULL,
      monto_esperado NUMERIC DEFAULT 0,
      monto_pagado NUMERIC DEFAULT 0,
      fecha_pago DATE,
      notas TEXT,
      creado TIMESTAMPTZ DEFAULT now(),
      UNIQUE(contract_id, mes)
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
      categoria TEXT,
      monto NUMERIC DEFAULT 0,
      fecha DATE NOT NULL,
      descripcion TEXT,
      creado TIMESTAMPTZ DEFAULT now()
    );
  `);
}

module.exports = { pool, init };
