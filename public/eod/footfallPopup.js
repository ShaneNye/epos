// public/eod/footfallPopup.js
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🟢 Footfall popup loaded");

  /* ============================================================================
      NORMALISE LABEL
     ============================================================================ */
  function normalizeLabel(label) {
    return String(label || "")
      .replace(/\u00A0/g, " ")
      .replace(/[\s\r\n]+/g, " ")
      .trim()
      .toLowerCase();
  }

  /* ============================================================================
      RAW FIELD MAP (FULL & EXACT)
     ============================================================================ */
  const RAW_FIELD_MAP = {
    "Date": "custrecord_ff_date",
    "Day": "custrecord_ff_day",
    "Footfall Count": "custrecord_ff_footfallcount",
    "Store Manager": "custrecord_ff_storemanager",
    "Team Footfall Count": "custrecord_sb_team_ff_count",

    // Personnel
    "Bed Specialist": "custrecord_sb_bed_specialist_1",
    "Bed Specialist 2": "custrecord_sb_bed_specialist_2",
    "Team Leader": "custrecord_sb_team_leader",

    "Email Trigger": "custrecord1425",
    "What was not available?": "custrecord1512",
    "What Was Too Expensive?": "custrecord1513",
    "Cold Call Web": "custrecord_sb_ff_cold_call",
    "Transfer to Store Web": "custrecord1694",
    "Product Enquiry Web": "custrecord1695",
    "Customer Service Web": "custrecord1696",
    "Ring and Arrange Web": "custrecord1697",
    "Other Web": "custrecord1698",
    "Other Web Reason": "custrecord1699",
    "Sales Order Count": "custrecord_ff_salesordercount",
    "Sales Order Amount": "custrecord_ff_salesorderamount",
    "Total Sales Order Count": "custrecord_ff_totalsalesordercount",
    "Total Sales Order Amount": "custrecord_ff_totalsalesorderamount",
    "Average Sales Order Value": "custrecord_ff_averagesalesordervalue",
    "Sales Order Pillows": "custrecord_ff_salesorderpillows",
    "Sales Order Matt Pros": "custrecord_ff_salesordermattpros",
    "Average Gross Profit": "custrecord_ff_averagegrossprofit",
    "Average Gross Profit %": "custrecord_ff_averagegrossprofitpercent",
    "Quote Count": "custrecord_ff_quotecount",
    "Quote Amount": "custrecord_ff_quoteamount",
    "Total Quote Count": "custrecord_ff_totalquotecount",
    "Total Quote Amount": "custrecord_ff_totalquoteamount",
    "Needs to Measure Up": "custrecord_ff_needstomeasureup",
    "Needs to Choose Colour": "custrecord_sb_needstochoosecolour",
    "Needs to Ask Partner": "custrecord_ff_needstoaskpartner",
    "Wants to Visit Competitor": "custrecord_ff_wantstovisitcompetitor",
    "Product not Available": "custrecord_ff_productnotavailable",
    "Couldn't get to, Busy Serving": "custrecord_ff_couldntgettobusyserving",
    "Couldn't Connect with Customer": "custrecord_ff_coudlntconnectwithcustomer",
    "Lead Time Too Long": "custrecord_ff_leadtimetoolong",
    "Running out of Time": "custrecord_ff_runningoutoftime",
    "Too Expensive": "custrecord_ff_tooexpensive",
    "Finance Declined": "custrecord_ff_financedeclined",
    "Couldn't Decide on Product": "custrecord_ff_couldntdecideonproduct",
    "What was not Available? - old": "custrecord_ff_whatwasnotavailable",
    "What was Too Expensive? - Old": "custrecord_ff_whatwastooexpensive"
  };

  /* ============================================================================
      NORMALISED FIELD MAP (lowercased)
     ============================================================================ */
  const FIELD_MAP = {};
  Object.entries(RAW_FIELD_MAP).forEach(([k, v]) => {
    FIELD_MAP[normalizeLabel(k)] = v;
  });

  /* ============================================================================
      AUTH
     ============================================================================ */
  const auth = storageGet?.();
  const token = auth?.token;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  /* ============================================================================
      DOM ELEMENTS
     ============================================================================ */
  const storeSelect = document.getElementById("storeSelect");
  const theadRow = document.getElementById("footfallHeaderRow");
  const tbody = document.getElementById("footfallTableBody");

  /* ============================================================================
      STATE
     ============================================================================ */
  let users = [];
  let footfallResults = [];
  let locations = [];
  let currentRow = null;

  /* ============================================================================
      LOAD USERS
     ============================================================================ */
  try {
    const res = await fetch("/api/users", { headers });
    const data = await res.json();
    users = data.users || [];
    console.log("👤 Loaded users:", users);
  } catch (err) {
    console.error("❌ Load users failed:", err);
  }

  function populateUserOptions() {
    document.querySelectorAll(".user-select").forEach(sel => {
      sel.innerHTML = `<option value="">Select...</option>`;
      users.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = `${u.firstName} ${u.lastName}`;
        sel.appendChild(opt);
      });
    });
  }

  /* ============================================================================
      LOAD LOCATIONS
     ============================================================================ */
  try {
    const res = await fetch("/api/meta/locations", { headers });
    const data = await res.json();
    locations = data.locations || [];
  } catch (err) {
    console.error("❌ Failed to load locations:", err);
  }

  storeSelect.innerHTML = `<option value="">Select Store...</option>`;
  locations.forEach(loc => {
    const clean = loc.name.includes(":")
      ? loc.name.split(":")[1].trim()
      : loc.name.trim();

    const opt = document.createElement("option");
    opt.value = clean;
    opt.textContent = clean;
    storeSelect.appendChild(opt);
  });

  /* ============================================================================
      LOAD FOOTFALL RESULTS
     ============================================================================ */
  try {
    const res = await fetch("/api/eod/footfall", { headers });
    const data = await res.json();
    footfallResults = data.results || [];
  } catch (err) {
    console.error("❌ Footfall fetch failed:", err);
  }

  /* ============================================================================
      FIELDS TO SKIP (NOT SHOWN AS COLUMNS)
     ============================================================================ */
  const skipFields = new Set([
    "store", "date", "day", "name", "script id", "store manager",
    "email trigger", "other web reason", "what was too expensive?",
    "what was too expensive? - old", "what was not available? - old",
    "what was not available?", "inactive",
    "footfall count", // replaced by team footfall count
    "team footfall count",
    "bed specialist", "bed specialist 2", "team leader",
    "internal id"
  ]);

  /* ============================================================================
      BUILD FULL NON-PAGINATED TABLE
     ============================================================================ */
  function buildFullTable() {
    tbody.innerHTML = "";
    theadRow.innerHTML = "";

    // ---- FIXED FIRST COLUMNS ----
    const fixedCols = [
      "Internal ID",
      "Team Leader",
      "Bed Specialist",
      "Bed Specialist 2",
      "Team Footfall Count"
    ];

    fixedCols.forEach(c => theadRow.innerHTML += `<th>${c}</th>`);

    // ---- DYNAMIC COLUMNS ----
    const dynamicFields = Object.keys(currentRow).filter(k => {
      const normalized = normalizeLabel(k);
      if (skipFields.has(normalized)) return false;
      return !isNaN(Number(String(currentRow[k] || "0").replace(/,/g, "")));
    });

    dynamicFields.forEach(f => theadRow.innerHTML += `<th>${f}</th>`);

    // ---- BUILD ROW ----
    const tr = document.createElement("tr");

    tr.innerHTML += `<td><input readonly value="${currentRow["Internal ID"]}" /></td>`;

    tr.innerHTML += `<td><select id="storeLeader" class="user-select"></select></td>`;
    tr.innerHTML += `<td><select id="bedSpecialist" class="user-select"></select></td>`;
    tr.innerHTML += `<td><select id="bedSpecialist2" class="user-select"></select></td>`;

    tr.innerHTML += `
      <td>
        <input type="number" 
               data-field="team footfall count"
               value="${Number(currentRow["Team Footfall Count"] || 0)}"
               min="0"/>
      </td>
    `;

    dynamicFields.forEach(label => {
      const val = Number(String(currentRow[label] || "0").replace(/,/g, ""));
      tr.innerHTML += `
        <td>
          <input type="number"
                 class="num-input"
                 data-field="${normalizeLabel(label)}"
                 value="${val}"
                 min="0"/>
        </td>
      `;
    });

    tbody.appendChild(tr);

    populateUserOptions();

    // ----- PRESELECT STORE LEADER -----
    const sl = document.getElementById("storeLeader");
    const slName = currentRow["Team Leader"];
    if (slName) {
      [...sl.options].forEach(o => {
        if (o.textContent.trim() === slName.trim()) sl.value = o.value;
      });
    }

    // ----- PRESELECT BS1 -----
    const bs1 = document.getElementById("bedSpecialist");
    const bs1Name = currentRow["Bed Specialist"];
    if (bs1Name) {
      [...bs1.options].forEach(o => {
        if (o.textContent.trim() === bs1Name.trim()) bs1.value = o.value;
      });
    }

    // ----- PRESELECT BS2 -----
    const bs2 = document.getElementById("bedSpecialist2");
    const bs2Name = currentRow["Bed Specialist 2"];
    if (bs2Name) {
      [...bs2.options].forEach(o => {
        if (o.textContent.trim() === bs2Name.trim()) bs2.value = o.value;
      });
    }
  }

  /* ============================================================================
      STORE SELECTION
     ============================================================================ */
  storeSelect.addEventListener("change", () => {
    const selected = storeSelect.value.trim().toLowerCase();

    currentRow = footfallResults.find(r => {
      let raw = r["Store"] || "";
      raw = raw.replace(/\u00A0/g, " ");
      let clean = raw.includes(":") ? raw.split(":")[1].trim() : raw.trim();
      return clean.toLowerCase() === selected;
    });

    if (!currentRow) return;

    buildFullTable();
  });

  /* ============================================================================
      SAVE FOOTFALL
     ============================================================================ */
document.getElementById("saveFootfallBtn").addEventListener("click", async () => {
  if (!currentRow) return alert("No store selected.");

  const internalId = currentRow["Internal ID"];
  const payload = {};

  const overlay = document.getElementById("savingOverlay");

  // 🔵 SHOW SPINNER
  overlay.classList.remove("hidden");

  /* ---- TEAM FOOTFALL COUNT ---- */
  const teamFF = document.querySelector(`input[data-field="team footfall count"]`);
  if (teamFF) payload[FIELD_MAP["team footfall count"]] = Number(teamFF.value);

  /* ---- STORE LEADER ---- */
  const sl = document.getElementById("storeLeader");
  if (sl?.value) {
    const user = users.find(u => String(u.id) === String(sl.value));
    const nsId = user?.netsuiteId || user?.netsuiteid;
    if (nsId) payload[FIELD_MAP["team leader"]] = String(nsId);
  }

  /* ---- BED SPECIALISTS ---- */
  const bs1 = document.getElementById("bedSpecialist");
  if (bs1?.value) {
    const user = users.find(u => String(u.id) === String(bs1.value));
    const nsId = user?.netsuiteId || user?.netsuiteid;
    if (nsId) payload[FIELD_MAP["bed specialist"]] = String(nsId);
  }

  const bs2 = document.getElementById("bedSpecialist2");
  if (bs2?.value) {
    const user = users.find(u => String(u.id) === String(bs2.value));
    const nsId = user?.netsuiteId || user?.netsuiteid;
    if (nsId) payload[FIELD_MAP["bed specialist 2"]] = String(nsId);
  }

  /* ---- ALL DYNAMIC NUMBER FIELDS ---- */
  document.querySelectorAll(".num-input[data-field]").forEach(input => {
    const norm = normalizeLabel(input.dataset.field);
    const mapped = FIELD_MAP[norm];
    if (mapped) payload[mapped] = Number(input.value);
  });

  console.log("📤 Final PATCH Payload:", payload);

  // ---- SEND PATCH ----
  const res = await fetch("/api/eod/footfall/update", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify({ internalId, values: payload })
  });

  const json = await res.json();
  console.log("📥 Patch response:", json);

  if (!json.ok) {
    overlay.classList.add("hidden"); // hide overlay before showing error
    return alert("❌ Update failed: " + json.error);
  }

  // 🌟 SUCCESS
  setTimeout(() => {
    // reload parent page
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.location.reload();
      }
    } catch (e) {
      console.warn("⚠ Could not refresh opener:", e);
    }

    // close popup
    window.close();
  }, 400); // small delay feels smoother
});

});
