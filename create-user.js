// Uso: node create-user.js <usuario> <contraseña>
// Crea o actualiza un usuario del panel. Se ejecuta una sola vez desde la
// consola de Railway (o localmente con DATABASE_URL apuntando a la base).
const crypto = require('crypto');
const { pool, init } = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

async function main() {
  const username = String(process.argv[2] || '').trim().toLowerCase();
  const password = String(process.argv[3] || '');
  if (!username || !password) {
    console.error('Uso: node create-user.js <usuario> <contraseña>');
    process.exit(1);
  }
  await init();
  const { salt, hash } = hashPassword(password);
  await pool.query(
    `INSERT INTO users (username, salt, hash) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET salt = EXCLUDED.salt, hash = EXCLUDED.hash`,
    [username, salt, hash]
  );
  console.log('Usuario "' + username + '" creado/actualizado correctamente.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
