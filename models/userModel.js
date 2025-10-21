// models/userModel.js
const db = require('../db');

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function createUser({ email, passwordHash, firstName, lastName, roles, primaryStore }) {
  return db.prepare(`
    INSERT INTO users (email, password_hash, firstName, lastName, roles, primaryStore)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(email, passwordHash, firstName, lastName, roles, primaryStore);
}

function listUsers() {
  return db.prepare('SELECT * FROM users').all();
}

module.exports = { getUserByEmail, createUser, listUsers };
