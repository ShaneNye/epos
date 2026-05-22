// public/eod/footfallPopup.js
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Footfall popup loaded");

  function normalizeLabel(label) {
    return String(label || "")
      .replace(/\u00A0/g, " ")
      .replace(/[\s\r\n]+/g, " ")
      .trim()
      .toLowerCase();
  }

  function cleanStoreName(name) {
    const value = String(name || "").replace(/\u00A0/g, " ").trim();
    return value.includes(":") ? value.split(":").pop().trim() : value;
  }

  function toNumber(value) {
    const number = Number(String(value || "0").replace(/,/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const RAW_FIELD_MAP = {
    "Date": "custrecord_ff_date",
    "Day": "custrecord_ff_day",
    "Footfall Count": "custrecord_ff_footfallcount",
    "Store Manager": "custrecord_ff_storemanager",
    "Team Footfall Count": "custrecord_sb_team_ff_count",
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

  const FIELD_MAP = {};
  Object.entries(RAW_FIELD_MAP).forEach(([label, fieldId]) => {
    FIELD_MAP[normalizeLabel(label)] = fieldId;
  });

  const skipFields = new Set([
    "store", "date", "day", "name", "script id", "store manager",
    "email trigger", "other web reason",
    "what was too expensive? - old", "what was not available? - old",
    "inactive", "footfall count", "team footfall count",
    "bed specialist", "bed specialist 2", "team leader", "internal id"
  ]);

  const customerOutcomeFields = [
    "Quote Count",
    "Needs to Measure Up",
    "Needs to Choose Colour",
    "Needs to Ask Partner",
    "Wants to Visit Competitor",
    "Product not Available",
    "Couldn't get to, Busy Serving",
    "Couldn't Connect with Customer",
    "Lead Time Too Long",
    "Running out of Time",
    "Too Expensive",
    "Finance Declined",
    "Couldn't Decide on Product",
    "What was not available?",
    "What Was Too Expensive?"
  ];

  const textAreaFields = new Set([
    normalizeLabel("What was not available?"),
    normalizeLabel("What Was Too Expensive?")
  ]);

  const auth = storageGet?.();
  const token = auth?.token;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const storeSelect = document.getElementById("storeSelect");
  const emptyState = document.getElementById("emptyState");
  const footfallForm = document.getElementById("footfallForm");
  const selectedStoreName = document.getElementById("selectedStoreName");
  const selectedRecordId = document.getElementById("selectedRecordId");
  const metricGrid = document.getElementById("metricGrid");
  const saveBtn = document.getElementById("saveFootfallBtn");
  const overlay = document.getElementById("savingOverlay");

  let users = [];
  let footfallResults = [];
  let locations = [];
  let currentRow = null;

  function populateUserOptions() {
    const sortedUsers = [...users].sort((a, b) => {
      const nameA = `${a.firstName || ""} ${a.lastName || ""}`.trim();
      const nameB = `${b.firstName || ""} ${b.lastName || ""}`.trim();
      return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
    });

    document.querySelectorAll(".user-select").forEach(select => {
      select.innerHTML = `<option value="">Select...</option>`;
      sortedUsers.forEach(user => {
        const option = document.createElement("option");
        option.value = user.id;
        option.textContent = `${user.firstName} ${user.lastName}`;
        select.appendChild(option);
      });
    });
  }

  function preselectUser(selectId, rowLabel) {
    const select = document.getElementById(selectId);
    const userName = currentRow?.[rowLabel];
    if (!select || !userName) return;

    [...select.options].forEach(option => {
      if (option.textContent.trim() === String(userName).trim()) {
        select.value = option.value;
      }
    });
  }

  function updateBedSpecialistVisibility() {
    const first = document.getElementById("storeLeader");
    const second = document.getElementById("bedSpecialist");
    const secondField = document.getElementById("bedSpecialist2Field");
    const thirdField = document.getElementById("bedSpecialist3Field");

    const hasFirst = !!first?.value;
    const hasSecond = !!second?.value;

    if (!hasFirst && second) second.value = "";
    if ((!hasFirst || !hasSecond) && document.getElementById("bedSpecialist2")) {
      document.getElementById("bedSpecialist2").value = "";
    }

    secondField?.classList.toggle("hidden", !hasFirst);
    thirdField?.classList.toggle("hidden", !hasFirst || !second?.value);
  }

  function getDynamicFields() {
    if (!currentRow) return [];

    return customerOutcomeFields.filter(label => {
      const normalized = normalizeLabel(label);
      if (skipFields.has(normalized)) return false;
      if (!FIELD_MAP[normalized]) return false;
      return Object.prototype.hasOwnProperty.call(currentRow, label);
    });
  }

  function buildMetricField(label) {
    const normalized = normalizeLabel(label);
    const isTextArea = textAreaFields.has(normalized);
    const value = isTextArea ? String(currentRow[label] ?? "") : toNumber(currentRow[label]);

    if (isTextArea) {
      return `
        <label class="metric-field metric-field-wide">
          <span>${escapeHtml(label)}</span>
          <textarea
            class="text-input"
            data-field="${escapeHtml(normalized)}"
            rows="4"
          >${escapeHtml(value)}</textarea>
        </label>
      `;
    }

    return `
      <label class="metric-field">
        <span>${escapeHtml(label)}</span>
        <input
          type="number"
          class="num-input"
          data-field="${escapeHtml(normalized)}"
          value="${value}"
          min="0"
          inputmode="numeric"
        />
      </label>
    `;
  }

  function renderFootfallForm() {
    selectedStoreName.textContent = cleanStoreName(currentRow.Store || storeSelect.value);
    selectedRecordId.textContent = currentRow["Internal ID"] || "-";

    populateUserOptions();
    preselectUser("storeLeader", "Team Leader");
    preselectUser("bedSpecialist", "Bed Specialist");
    preselectUser("bedSpecialist2", "Bed Specialist 2");
    updateBedSpecialistVisibility();

    const teamFootfallInput = document.getElementById("teamFootfallCount");
    teamFootfallInput.value = toNumber(currentRow["Team Footfall Count"]);

    const dynamicFields = getDynamicFields();
    metricGrid.innerHTML = dynamicFields.length
      ? dynamicFields.map(buildMetricField).join("")
      : `<div class="empty-state compact">No additional numeric fields found for this record.</div>`;

    emptyState.classList.add("hidden");
    footfallForm.classList.remove("hidden");
    saveBtn.disabled = false;
  }

  function resetForm(message = "Choose a store to start entering today's footfall.") {
    currentRow = null;
    metricGrid.innerHTML = "";
    selectedStoreName.textContent = "";
    selectedRecordId.textContent = "";
    emptyState.textContent = message;
    emptyState.classList.remove("hidden");
    footfallForm.classList.add("hidden");
    saveBtn.disabled = true;
  }

  try {
    const res = await fetch("/api/users", { headers });
    const data = await res.json();
    users = data.users || [];
  } catch (err) {
    console.error("Load users failed:", err);
  }

  try {
    const res = await fetch("/api/meta/locations", { headers });
    const data = await res.json();
    locations = data.locations || [];
  } catch (err) {
    console.error("Failed to load locations:", err);
  }

  storeSelect.innerHTML = `<option value="">Select Store...</option>`;
  locations.forEach(location => {
    const clean = cleanStoreName(location.name);
    const option = document.createElement("option");
    option.value = clean;
    option.textContent = clean;
    storeSelect.appendChild(option);
  });

  try {
    const res = await fetch("/api/eod/footfall", { headers });
    const data = await res.json();
    footfallResults = data.results || [];
  } catch (err) {
    console.error("Footfall fetch failed:", err);
  }

  storeSelect.addEventListener("change", () => {
    const selected = storeSelect.value.trim().toLowerCase();
    if (!selected) return resetForm();

    currentRow = footfallResults.find(row => {
      return cleanStoreName(row.Store).toLowerCase() === selected;
    });

    if (!currentRow) {
      return resetForm("No footfall record was found for the selected store.");
    }

    renderFootfallForm();
  });

  document.getElementById("storeLeader")?.addEventListener("change", updateBedSpecialistVisibility);
  document.getElementById("bedSpecialist")?.addEventListener("change", updateBedSpecialistVisibility);

  saveBtn.addEventListener("click", async () => {
    if (!currentRow) return alert("Please select a store first.");

    const teamLeader = document.getElementById("storeLeader");
    if (!teamLeader?.value) {
      teamLeader.focus();
      return alert("Please select the Bed Specialist before saving.");
    }

    const internalId = currentRow["Internal ID"];
    const payload = {};

    overlay.classList.remove("hidden");
    saveBtn.disabled = true;

    const teamFootfall = document.getElementById("teamFootfallCount");
    if (teamFootfall) {
      payload[FIELD_MAP["team footfall count"]] = toNumber(teamFootfall.value);
    }

    [
      ["storeLeader", "team leader"],
      ["bedSpecialist", "bed specialist"],
      ["bedSpecialist2", "bed specialist 2"]
    ].forEach(([selectId, fieldLabel]) => {
      const select = document.getElementById(selectId);
      if (!select?.value) return;

      const user = users.find(u => String(u.id) === String(select.value));
      const nsId = user?.netsuiteId || user?.netsuiteid;
      if (nsId) payload[FIELD_MAP[fieldLabel]] = String(nsId);
    });

    document.querySelectorAll(".num-input[data-field]").forEach(input => {
      const mapped = FIELD_MAP[normalizeLabel(input.dataset.field)];
      if (mapped) payload[mapped] = toNumber(input.value);
    });

    document.querySelectorAll(".text-input[data-field]").forEach(input => {
      const mapped = FIELD_MAP[normalizeLabel(input.dataset.field)];
      if (mapped) payload[mapped] = input.value.trim();
    });

    try {
      const res = await fetch("/api/eod/footfall/update", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: JSON.stringify({ internalId, values: payload })
      });

      const json = await res.json();

      if (!json.ok) {
        overlay.classList.add("hidden");
        saveBtn.disabled = false;
        return alert("Update failed: " + json.error);
      }

      setTimeout(() => {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.location.reload();
          }
        } catch (err) {
          console.warn("Could not refresh opener:", err);
        }

        window.close();
      }, 400);
    } catch (err) {
      console.error("Save failed:", err);
      overlay.classList.add("hidden");
      saveBtn.disabled = false;
      alert("Failed to save footfall record.");
    }
  });
});
