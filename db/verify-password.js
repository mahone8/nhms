const bcrypt = require("bcryptjs");
const { Client } = require("pg");

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: node db/verify-password.js <username> "<password>"');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query(
      "SELECT username, password_hash FROM users WHERE username = $1",
      [username]
    );
    if (!rows.length) {
      console.log("No such user in this database.");
      return;
    }
    const match = bcrypt.compareSync(password, rows[0].password_hash);
    console.log("Stored hash:", rows[0].password_hash);
    console.log("Password matches:", match);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
