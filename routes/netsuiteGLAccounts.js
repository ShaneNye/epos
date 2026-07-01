const express = require("express");
const router = express.Router();

const { fetchNetSuiteData } = require("../utils/fetchNetSuiteData"); 
// adjust this import to wherever fetchNetSuiteData actually lives

router.get("/glaccounts", async (req, res) => {
  return fetchNetSuiteData(
    "GL_ACCOUNTS_URL",
    "GL_ACCOUNTS",
    req,
    res,
    "GL accounts"
  );
});

module.exports = router;