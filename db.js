// db.js
const mysql = require("mysql2/promise");

// Create a connection pool to MySQL
const pool = mysql.createPool({
  host: "localhost",
  user: "root",       // adjust if you set a different user
  password: "Pdcjybrt2!",       // add your MySQL root password if you set one
  database: "epos",   // the database we created earlier
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
