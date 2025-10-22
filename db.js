// db.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://eposdb_user:aobpjyQlCEEi4sN1uf61rAFDttL2Er7i@dpg-d3rq7a24d50c73de1d7g-a.frankfurt-postgres.render.com/eposdb",
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
