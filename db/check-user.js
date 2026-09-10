const { Client } = require("pg");

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: node db/check-user.js <username>");
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
      "SELECT id, username, role, status FROM users WHERE username = $1",
      [username]
    );
    console.log(rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
