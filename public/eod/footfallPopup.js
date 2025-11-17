// public/eod/footfallPopup.js
document.addEventListener("DOMContentLoaded", async () => {
  const auth = storageGet?.();
  const token = auth?.token;

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  /* =====================================================
     LOAD USERS (Bed Specialists)
  ===================================================== */
  let users = [];
  try {
    const res = await fetch("/api/users", { headers });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load users");
    users = data.users || [];
  } catch (err) {
    console.error("❌ Failed to load users:", err);
    users = [];
  }

  function populateUserOptions() {
    const selects = document.querySelectorAll(".user-select");
    selects.forEach((sel) => {
      sel.innerHTML = `<option value="">Select...</option>`;
      users.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = `${u.firstName || ""} ${u.lastName || ""}`.trim();
        sel.appendChild(opt);
      });
    });
  }

  /* =====================================================
     LOAD STORES
  ===================================================== */
  const storeSelect = document.getElementById("storeSelect");
  const tbody = document.getElementById("footfallTableBody");
  const theadRow = document.getElementById("footfallHeaderRow");

  let locations = [];

  try {
    const locRes = await fetch("/api/meta/locations", { headers });
    const locData = await locRes.json();
    if (!locData.ok) throw new Error(locData.error || "Failed to load locations");
    locations = locData.locations || [];
  } catch (err) {
    console.error("❌ Failed to load locations:", err);
  }

  storeSelect.innerHTML = `<option value="">Select Store...</option>`;

  locations.forEach((loc) => {
    const raw = loc.name || "";
    const clean = raw.includes(":") ? raw.split(":")[1].trim() : raw;

    const opt = document.createElement("option");
    opt.value = clean;
    opt.textContent = clean;
    storeSelect.appendChild(opt);
  });

  /* =====================================================
     LOAD TODAY'S FOOTFALL DATA
  ===================================================== */
  let footfallResults = [];

  async function fetchFootfall() {
    try {
      const res = await fetch("/api/eod/footfall", { headers });
      const data = await res.json();
      if (!data.ok) return [];
      return Array.isArray(data.results) ? data.results : [];
    } catch (err) {
      console.error("❌ Error fetching footfall:", err);
      return [];
    }
  }

  footfallResults = await fetchFootfall();

  /* =====================================================
     SKIP FIELDS — only show numeric-style fields
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
     BUILD TABLE HEADERS
  ===================================================== */
  function buildHeaderRow(todayRow) {
    theadRow.innerHTML = "";

    // Always first three headers
    theadRow.innerHTML += `<th>Internal ID</th>`;
    theadRow.innerHTML += `<th>Bed Specialist</th>`;
    theadRow.innerHTML += `<th>Bed Specialist 2</th>`;

    Object.entries(todayRow).forEach(([key, value]) => {
      if (skipFields.has(key)) return;

      // Numeric-like fields become columns
      const raw = value == null || value === "" ? "0" : String(value).replace(/,/g, "");
      if (isNaN(Number(raw))) return;

      theadRow.innerHTML += `<th>${key}</th>`;
    });
  }

  /* =====================================================
     BUILD TABLE ROW FOR SELECTED STORE
  ===================================================== */
  storeSelect.addEventListener("change", () => {
    const storeName = storeSelect.value;
    tbody.innerHTML = "";
    theadRow.innerHTML = "";

    if (!storeName) return;

    const todayRow = footfallResults.find((r) => {
      const raw = r["Store"] || "";
      const clean = raw.includes(":") ? raw.split(":")[1].trim() : raw;
      return clean === storeName;
    });

    if (!todayRow) return;

    buildHeaderRow(todayRow);

    const tr = document.createElement("tr");

    // 1️⃣ Internal ID (readonly)
    const internalId = todayRow["Internal ID"] || "";
    tr.innerHTML += `
      <td>
        <input 
          type="text" 
          value="${internalId}" 
          readonly 
          class="readonly-cell"
          data-field="Internal ID"
        />
      </td>
    `;

    // 2️⃣ Bed Specialist (select)
    tr.innerHTML += `
      <td>
        <select id="bedSpecialist" class="user-select"></select>
      </td>
    `;

    // 3️⃣ Bed Specialist 2 (select)
    tr.innerHTML += `
      <td>
        <select id="bedSpecialist2" class="user-select"></select>
      </td>
    `;

    // 4️⃣ Add numeric input fields
    Object.entries(todayRow).forEach(([key, value]) => {
      if (skipFields.has(key)) return;

      const raw =
        value === null || value === "" ? "0" : String(value).replace(/,/g, "");
      const num = Number(raw);
      if (isNaN(num)) return;

      tr.innerHTML += `
        <td>
          <input 
            type="number"
            class="num-input"
            data-field="${key}"
            min="0"
            value="${num}"
          />
        </td>
      `;
    });

    tbody.appendChild(tr);

    // Populate user dropdowns
    populateUserOptions();

    // Preselect BS1 + BS2
    const bs1Name = todayRow["Bed Specialist"];
    const bs2Name = todayRow["Bed Specialist 2"];

    const bs1Select = document.getElementById("bedSpecialist");
    const bs2Select = document.getElementById("bedSpecialist2");

    if (bs1Name && bs1Select) {
      [...bs1Select.options].forEach((o) => {
        if (o.textContent.trim() === bs1Name.trim()) {
          bs1Select.value = o.value;
        }
      });
    }

    if (bs2Name && bs2Select) {
      [...bs2Select.options].forEach((o) => {
        if (o.textContent.trim() === bs2Name.trim()) {
          bs2Select.value = o.value;
        }
      });
    }
  });

  /* =====================================================
     SAVE HANDLER (placeholder)
  ===================================================== */
  document.getElementById("saveFootfallBtn").addEventListener("click", () => {
    alert("Saving Footfall coming soon (RESTlet / customrecord update).");
  });
});
