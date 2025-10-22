const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");

const router = express.Router();

router.post("/", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ ok: false, message: "Missing token or password." });
  }

  try {
    // ✅ Find user by reset token
    const result = await pool.query(
      "SELECT id, reset_expires FROM users WHERE reset_token = $1",
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ ok: false, message: "Invalid or expired token." });
    }

    const user = result.rows[0];
    const now = new Date();

    if (!user.reset_expires || now > new Date(user.reset_expires)) {
      return res.status(400).json({ ok: false, message: "This reset link has expired." });
    }

    // ✅ Hash and update password, clear reset fields
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `
      UPDATE users 
         SET password_hash = $1, 
             reset_token = NULL, 
             reset_expires = NULL 
       WHERE id = $2
      `,
      [hash, user.id]
    );

    res.json({ ok: true, message: "Password successfully updated. You can now log in." });
  } catch (err) {
    console.error("❌ Reset password error:", err.message);
    res.status(500).json({ ok: false, message: "Server error." });
  }
});

module.exports = router;
