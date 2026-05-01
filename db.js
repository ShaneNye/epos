// db.js
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL. Refusing to start without an explicit database target.");
}

function logDatabaseTarget() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log("Database target:", {
      host: url.host,
      database: url.pathname.replace(/^\//, ""),
      user: url.username,
    });
  } catch {
    console.warn("Database target: DATABASE_URL is set but could not be parsed.");
  }
}

logDatabaseTarget();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Render-managed PostgreSQL
  },
});

pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL database");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL connection error:", err.message);
});

module.exports = pool;
