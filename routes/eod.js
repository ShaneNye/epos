// public/eod/footfallPopup.js
document.addEventListener("DOMContentLoaded", async () => {

  console.log("🟢 Footfall popup script loaded.");

  /* =====================================================
     AUTH HEADERS
  ===================================================== */
  const auth = storageGet?.();
  const token = auth?.token;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  console.log("🔐 Auth headers:", headers);


  /* =====================================================
     LOAD USERS
  ===================================================== */
  console.log("📡 Fetching users…");

  let users = [];
  try {
    const res = await fetch("/api/users", { headers });
    const data = await res.json();
    console.log("📥 Users response:", data);

    if (!data.ok) throw new Error("User load failed");

    users = data.users || [];
    console.log(`👤 Loaded ${users.length} users`);
  } catch (err) {
    console.error("❌ Failed to load users:", err);
  }

  function populateUserDropdowns() {
    console.log("🔄 Populating user dropdowns…");
    const selects = document.querySelectorAll(".user-select");
    selects.forEach((sel) => {
      sel.innerHTML = `<option value="">Select...</option>`;
      users.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = `${u.firstName} ${u.lastName}`;
        sel.appendChild(opt);
      });
    });
  }


  /* =====================================================
     LOAD STORES
  ===================================================== */
  console.log("📡 Fetching locations…");

  const storeSelect = document.getElementById("storeSelect");
  const headerRow = document.getElementById("footfallHeaderRow");
  const tbody = document.getElementById("footfallTableBody");

  let locations = [];

  try {
    const locRes = await fetch("/api/meta/locations", { headers });
    const locData = await locRes.json();
    console.log("📥 Locations response:", locData);

    if (!locData.ok) throw new Error("Location load failed");

    locations = locData.locations || [];
    console.log(`📍 Loaded ${locations.length} locations`);
  } catch (err) {
    console.error("❌ Failed to load locations:", err);
  }

  // Populate dropdown
  storeSelect.innerHTML = `<option value="">Select Store...</option>`;
  locations.forEach((loc) => {
    const raw = loc.name || "";
    const clean = raw.includes(":") ? raw.split(":")[1].trim() : raw.trim();
    const opt = document.createElement("option");
    opt.value = clean;
    opt.textContent = clean;
    storeSelect.appendChild(opt);
  });
  console.log("🏪 Store dropdown populated.");


  /* =====================================================
     LOAD FOOTFALL RESULTS
  ===================================================== */
  console.log("📡 Fetching footfall results…");

  let footfallResults = [];

  async function loadFootfall() {
    try {
      const res = await fetch("/api/eod/footfall", { headers });
      const text = await res.text();

      console.log("📥 Raw /api/eod/footfall response:", text);

      let json;
      try { json = JSON.parse(text); }
      catch { 
        console.error("❌ Could not parse JSON from footfall API:", text);
        return [];
      }

      if (!json.ok) {
        console.warn("⚠️ Footfall API not ok:", json);
        return [];
      }

      return json.results || [];

    } catch (err) {
      console.error("❌ Footfall fetch error:", err);
      return [];
    }
  }

  footfallResults = await loadFootfall();
  console.log("📊 Final footfall results array:", footfallResults);


  /* =====================================================
     FIELDS TO SKIP
  ===================================================== */
  const skipFields = new Set([
    "Internal ID",
    "Store",
    "Date",
    "Day",
    "Name",
    "Script ID",
    "Store Manager",
    "Email Trigger",
    "Other Web Reason",
    "What Was Too Expensive?",
    "What was Too Expensive? - Old",
    "What was not Available? - old",
    "What was not available?",
    "Bed Specialist",
    "Bed Specialist 2",
  ]);


  /* =====================================================
     BUILD HEADER
  ===================================================== */
  function buildHeaderRow(row) {
    console.log("🧱 Building header row for:", row);

    headerRow.innerHTML = "";

    headerRow.innerHTML += `<th>Internal ID</th>`;
    headerRow.innerHTML += `<th>Bed Specialist</th>`;
    headerRow.innerHTML += `<th>Bed Specialist 2</th>`;

    Object.entries(row).forEach(([key, value]) => {
      if (skipFields.has(key)) return;

      const raw = value == null || value === "" ? "0" : String(value).replace(/,/g, "");
      const num = Number(raw);

      if (!isNaN(num)) {
        headerRow.innerHTML += `<th>${key}</th>`;
      }
    });

    console.log("🧱 Header row complete:", headerRow.innerHTML);
  }


  /* =====================================================
     STORE SELECTION → BUILD ROW
  ===================================================== */
  storeSelect.addEventListener("change", () => {
    const storeName = storeSelect.value.trim().toLowerCase();
    console.log("🏪 Store selected:", storeName);

    tbody.innerHTML = "";
    headerRow.innerHTML = "";

    if (!storeName) {
      console.log("⚠️ No store selected.");
      return;
    }

    console.log("🔍 Searching for matching footfall row…");

    const todayRow = footfallResults.find((r) => {
      const raw = (r["Store"] || "").toLowerCase();
      const clean = raw.includes(":")
        ? raw.split(":")[1].trim().toLowerCase()
        : raw.trim();

      console.log(`Comparing: clean="${clean}" vs selected="${storeName}"`);
      return clean.includes(storeName);
    });

    console.log("➡️ Matched row:", todayRow);

    if (!todayRow) {
      console.warn("⚠️ No matching footfall row found for store:", storeName);
      return;
    }

    buildHeaderRow(todayRow);

    console.log("🧱 Building table row…");

    const tr = document.createElement("tr");

    // Internal ID
    tr.innerHTML += `
      <td><input type="text" readonly class="readonly-cell" value="${todayRow["Internal ID"] || ""}" /></td>
    `;

    // Bed Specialist
    tr.innerHTML += `<td><select id="bedSpecialist" class="user-select"></select></td>`;

    // Bed Specialist 2
    tr.innerHTML += `<td><select id="bedSpecialist2" class="user-select"></select></td>`;

    // Numeric fields
    Object.entries(todayRow).forEach(([key, val]) => {
      if (skipFields.has(key)) return;

      const raw = val == null || val === "" ? "0" : String(val).replace(/,/g, "");
      const num = Number(raw);
      if (isNaN(num)) return;

      tr.innerHTML += `
        <td><input type="number" class="num-input" min="0" value="${num}" data-field="${key}" /></td>
      `;
    });

    tbody.appendChild(tr);

    console.log("🧱 Row created:", tr);

    // Populate specialists
    populateUserDropdowns();

    // Preselect
    const bs1 = document.getElementById("bedSpecialist");
    const bs2 = document.getElementById("bedSpecialist2");

    console.log("🧩 Preselecting bed specialists…");

    const bs1Name = todayRow["Bed Specialist"];
    const bs2Name = todayRow["Bed Specialist 2"];

    if (bs1Name) {
      [...bs1.options].forEach((o) => {
        if (o.textContent.trim().toLowerCase() === bs1Name.trim().toLowerCase()) {
          bs1.value = o.value;
        }
      });
    }

    if (bs2Name) {
      [...bs2.options].forEach((o) => {
        if (o.textContent.trim().toLowerCase() === bs2Name.trim().toLowerCase()) {
          bs2.value = o.value;
        }
      });
    }

    console.log("✅ Finished populating UI for store:", storeName);
  });


  /* =====================================================
     SAVE HANDLER
  ===================================================== */
  document.getElementById("saveFootfallBtn").addEventListener("click", () => {
    console.log("💾 Save button clicked");
    alert("Saving coming soon…");
  });

});
