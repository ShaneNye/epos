/**************************************************
 * POSTCODE MAP VARS
 **************************************************/
let logisticsMap = null;
let coverageLayer = null;
const districtGeoCache = {};
let districtLabels = [];

/**************************************************
 * (future) DELIVERY SCHEDULE VARS – safe to leave
 **************************************************/
let scheduleMap = null;
let scheduleLayer = null;
const scheduleGeoCache = {};
let scheduleLabels = [];

/**************************************************
 * PAGE READY
 **************************************************/
document.addEventListener("DOMContentLoaded", () => {
  /* -----------------------------
     MAIN TAB SWITCHING
  ----------------------------- */
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // deactivate all tabs
      document.querySelectorAll(".tab").forEach((t) =>
        t.classList.remove("active")
      );
      // hide all tab panels
      document.querySelectorAll(".tab-content").forEach((c) => {
        c.classList.add("hidden");
      });

      // activate clicked
      tab.classList.add("active");
      const target = document.getElementById(tab.dataset.target);
      if (target) target.classList.remove("hidden");

      // load data for the chosen tab
      if (tab.dataset.target === "postcodes") {
        loadLogisticsTable();
      } else if (tab.dataset.target === "deliverySchedule") {
        // placeholder for later schedule loading
        // loadScheduleTable();
      }
    });
  });

  /* -----------------------------
     OPEN ADD WAREHOUSE POPUP
  ----------------------------- */
  const addBtn = document.getElementById("addWarehouseBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      window.open(
        "/logisticsPopup/logisticPopup.html",
        "logisticsPopup",
        "width=650,height=700,left=250,top=120"
      );
    });
  }

  /* -----------------------------
     LABEL TOGGLER (Postcodes)
  ----------------------------- */
  const toggle = document.getElementById("toggleLabels");
  if (toggle) {
    toggle.addEventListener("change", (e) => {
      const show = e.target.checked;
      if (!coverageLayer) return;

      districtLabels.forEach((label) => {
        if (show) {
          coverageLayer.addLayer(label);
        } else {
          coverageLayer.removeLayer(label);
        }
      });
    });
  }

  /* -----------------------------
     DELIVERY SUB-TABS (Sussex / Kent)
     👉 uses style.display instead of .hidden
  ----------------------------- */
  const subtabs = document.querySelectorAll(".delivery-subtab");
  const subtabPanels = document.querySelectorAll(".delivery-subtab-content");

  if (subtabs.length && subtabPanels.length) {
    // initial state: show Sussex, hide others
    subtabPanels.forEach((panel) => {
      if (panel.id === "schedule-sussex") {
        panel.style.display = "block";
      } else {
        panel.style.display = "none";
      }
    });

    subtabs.forEach((subtab) => {
      subtab.addEventListener("click", () => {
        // deactivate all subtabs
        subtabs.forEach((t) => t.classList.remove("active"));
        // hide all panels
        subtabPanels.forEach((p) => (p.style.display = "none"));

        // activate clicked
        subtab.classList.add("active");
        const targetId = subtab.dataset.target;
        const panel = document.getElementById(targetId);
        if (panel) panel.style.display = "block";
      });
    });
  }

  /* -----------------------------
     CLICK HANDLER FOR CELLS (popup later)
  ----------------------------- */
  document.addEventListener("click", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell) return;

    const day = cell.dataset.day;
    const zone = cell.dataset.zone;
    const activeSubtab = document.querySelector(
      ".delivery-subtab.active"
    );
    const warehouse = activeSubtab
      ? activeSubtab.textContent.trim()
      : "";

    console.log("Clicked schedule cell:", { warehouse, day, zone });
    // TODO: open popup UI in next step
  });

  /* -----------------------------
     INITIAL LOAD (Postcodes tab)
  ----------------------------- */
  loadLogisticsTable();
});

/***************************************************************
 *  POSTCODES: LOAD TABLE
 ***************************************************************/
async function loadLogisticsTable() {
  try {
    const res = await fetch("/api/logistics");
    const data = await res.json();

    const tbody = document.querySelector("#logisticsTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!data.ok) {
      tbody.innerHTML =
        `<tr><td colspan="5">Error loading logistics data</td></tr>`;
      return;
    }

    data.logistics.forEach((row) => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${row.id}</td>
        <td>${row.warehouse_name || "Unknown"}</td>
        <td>
          <div style="
            width: 22px;
            height: 22px;
            border: 1px solid #ccc;
            border-radius: 4px;
            background: ${row.hex_color || "#0081ab"};
          "></div>
        </td>
        <td class="actions">
          <button class="action-btn action-edit" onclick="editLogistics(${row.id})">Edit</button>
          <button class="action-btn action-delete" onclick="deleteLogistics(${row.id})">Delete</button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    await renderCoverageMap(data.logistics);
  } catch (err) {
    console.error("❌ Failed to load logistics data:", err);
  }
}

/***************************************************************
 *  POSTCODES: EDIT / DELETE
 ***************************************************************/
function editLogistics(id) {
  window.open(
    `/logisticsPopup/logisticPopup.html?id=${id}`,
    "logisticsPopup",
    "width=650,height=700,left=250,top=120"
  );
}

async function deleteLogistics(id) {
  if (!confirm("Are you sure you want to delete this logistics area?")) return;

  try {
    await fetch(`/api/logistics/${id}`, { method: "DELETE" });
    loadLogisticsTable();
  } catch (err) {
    console.error("❌ Failed to delete logistics row:", err);
  }
}

/***************************************************************
 *  POSTCODES MAP INIT
 ***************************************************************/
function ensureLogisticsMap() {
  if (logisticsMap) return;

  const mapDiv = document.getElementById("logisticsMap");
  if (!mapDiv) return;

  logisticsMap = L.map("logisticsMap").setView([51.0, 0.3], 7.5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(logisticsMap);

  coverageLayer = L.layerGroup().addTo(logisticsMap);
}

/***************************************************************
 *  POSTCODES: DRAW MAP
 ***************************************************************/
async function renderCoverageMap(rows) {
  ensureLogisticsMap();
  if (!logisticsMap || !coverageLayer) return;

  coverageLayer.clearLayers();
  districtLabels = [];

  const tasks = [];

  rows.forEach((row) => {
    const colour = row.hex_color || "#0081ab";

    (row.postcodes || []).forEach((pc) => {
      const district = pc.replace("*", "").trim().toUpperCase();
      if (!district) return;

      tasks.push(addDistrictToMap(district, row.warehouse_name, colour));
    });
  });

  await Promise.allSettled(tasks);
}

/***************************************************************
 *  POSTCODES: DRAW SINGLE AREA
 ***************************************************************/
async function addDistrictToMap(district, warehouseName, colour) {
  try {
    if (!districtGeoCache[district]) {
      const res = await fetch(`/geo/postcodes/${district}.geojson`);
      if (!res.ok) {
        console.warn(`⚠️ No GeoJSON for district ${district}`);
        return;
      }
      districtGeoCache[district] = await res.json();
    }

    const layer = L.geoJSON(districtGeoCache[district], {
      style: { color: colour, weight: 2, fillOpacity: 0.15 },
    });

    layer.eachLayer((poly) => {
      if (!poly.getBounds) return;
      const center = poly.getBounds().getCenter();

      const label = L.marker(center, {
        icon: L.divIcon({
          className: "district-label-zoom",
          html: `<span>${district}</span>`,
        }),
        interactive: false,
      });

      districtLabels.push(label);

      const toggle = document.getElementById("toggleLabels");
      if (toggle && toggle.checked && coverageLayer) {
        coverageLayer.addLayer(label);
      }
    });

    layer.bindPopup(`<strong>${district}</strong><br>${warehouseName}`);
    coverageLayer.addLayer(layer);
  } catch (err) {
    console.error(`❌ Failed to render district ${district}:`, err);
  }
}
