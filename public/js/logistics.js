/**************************************************
 * GLOBAL VARS — POSTCODES MAP
 **************************************************/
let logisticsMap = null;
let coverageLayer = null;
const districtGeoCache = {};
let districtLabels = [];

/**************************************************
 * GLOBAL VARS — DELIVERY SCHEDULE
 **************************************************/
let currentScheduleWarehouse = 7; // default Sussex
let scheduleData = null;

/**************************************************
 * INIT PAGE
 **************************************************/
document.addEventListener("DOMContentLoaded", () => {
    console.log("📦 Logistics JS Loaded");

    setupMainTabs();
    setupDeliverySubTabs();

    setupPostcodeLabelToggle();

    setupCellClickHandler();

    // Load initial tab
    loadLogisticsTable();
});

/**************************************************
 * MAIN TAB SWITCHING
 **************************************************/
function setupMainTabs() {
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {

            document.querySelectorAll(".tab")
                .forEach(t => t.classList.remove("active"));

            document.querySelectorAll(".tab-content")
                .forEach(c => c.classList.add("hidden"));

            tab.classList.add("active");

            const target = document.getElementById(tab.dataset.target);
            if (target) target.classList.remove("hidden");

            if (tab.dataset.target === "postcodes") {
                loadLogisticsTable();
            } else if (tab.dataset.target === "deliverySchedule") {
                console.log("📅 Switching to Delivery Schedule");
                loadScheduleForWarehouse(currentScheduleWarehouse);
            }
        });
    });
}

/**************************************************
 * POSTCODE TABLE LOAD
 **************************************************/
async function loadLogisticsTable() {
    console.log("📦 Loading logistics table…");

    try {
        const res = await fetch("/api/logistics");
        const data = await res.json();

        const tbody = document.querySelector("#logisticsTable tbody");
        tbody.innerHTML = "";

        if (!data.ok) {
            tbody.innerHTML = `<tr><td colspan="4">Error loading logistics data</td></tr>`;
            return;
        }

        data.logistics.forEach(row => {
            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${row.id}</td>
                <td>${row.warehouse_name || "Unknown"}</td>
                <td>
                    <div style="
                        width: 22px; 
                        height: 22px; 
                        background: ${row.hex_color || "#0081ab"};
                        border: 1px solid #ccc; 
                        border-radius: 4px;">
                    </div>
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
        console.error("❌ Failed to load logistics:", err);
    }
}

/**************************************************
 * EDIT POPUP
 **************************************************/
function editLogistics(id) {
    window.open(
        `/logisticsPopup/logisticPopup.html?id=${id}`,
        "logisticsPopup",
        "width=650,height=700,left=250,top=120"
    );
}

/**************************************************
 * DELETE LOGISTICS
 **************************************************/
async function deleteLogistics(id) {
    if (!confirm("Delete this logistics entry?")) return;

    await fetch(`/api/logistics/${id}`, { method: "DELETE" });

    loadLogisticsTable();
}

/**************************************************
 * POSTCODES MAP INIT
 **************************************************/
function ensureLogisticsMap() {
    if (logisticsMap) return;

    const div = document.getElementById("logisticsMap");
    if (!div) return;

    logisticsMap = L.map("logisticsMap").setView([51.0, 0.3], 7.5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png")
        .addTo(logisticsMap);

    coverageLayer = L.layerGroup().addTo(logisticsMap);
}

/**************************************************
 * POSTCODES MAP RENDER
 **************************************************/
async function renderCoverageMap(rows) {
    ensureLogisticsMap();
    if (!coverageLayer) return;

    coverageLayer.clearLayers();
    districtLabels = [];

    const tasks = [];

    rows.forEach(row => {
        const colour = row.hex_color || "#0081ab";

        (row.postcodes || []).forEach(pc => {
            const district = pc.replace("*", "").trim().toUpperCase();
            if (district) tasks.push(addDistrictToMap(district, row.warehouse_name, colour));
        });
    });

    await Promise.allSettled(tasks);
}

/**************************************************
 * DRAW SINGLE POSTCODE DISTRICT
 **************************************************/
async function addDistrictToMap(district, warehouseName, colour) {
    try {
        if (!districtGeoCache[district]) {
            const res = await fetch(`/geo/postcodes/${district}.geojson`);
            if (!res.ok) return;
            districtGeoCache[district] = await res.json();
        }

        const layer = L.geoJSON(districtGeoCache[district], {
            style: { color: colour, weight: 2, fillOpacity: 0.15 }
        });

        layer.eachLayer(poly => {
            const center = poly.getBounds().getCenter();

            const label = L.marker(center, {
                icon: L.divIcon({
                    className: "district-label-zoom",
                    html: `<span>${district}</span>`
                }),
                interactive: false
            });

            districtLabels.push(label);

            if (document.getElementById("toggleLabels")?.checked) {
                coverageLayer.addLayer(label);
            }
        });

        layer.bindPopup(`<strong>${district}</strong><br>${warehouseName}`);
        coverageLayer.addLayer(layer);

    } catch (err) {
        console.error(`❌ Failed postal district ${district}`, err);
    }
}

/**************************************************
 * LABEL TOGGLE
 **************************************************/
function setupPostcodeLabelToggle() {
    const toggle = document.getElementById("toggleLabels");
    if (!toggle) return;

    toggle.addEventListener("change", e => {
        const show = e.target.checked;
        districtLabels.forEach(label => {
            if (show) coverageLayer.addLayer(label);
            else coverageLayer.removeLayer(label);
        });
    });
}

/**************************************************
 * DELIVERY SUBTAB SWITCHING
 **************************************************/
function setupDeliverySubTabs() {
    document.querySelectorAll(".delivery-subtab").forEach(sub => {
        sub.addEventListener("click", () => {

            document.querySelectorAll(".delivery-subtab")
                .forEach(t => t.classList.remove("active"));

            document.querySelectorAll(".delivery-subtab-content")
                .forEach(c => c.style.display = "none");

            sub.classList.add("active");

            const target = document.getElementById(sub.dataset.target);
            target.style.display = "block";

            currentScheduleWarehouse = Number(sub.dataset.warehouse);

            loadScheduleForWarehouse(currentScheduleWarehouse);
        });
    });
}

/**************************************************
 * LOAD SCHEDULE DATA FROM SERVER
 **************************************************/
async function loadScheduleForWarehouse(warehouseId) {
    console.log("📥 Loading schedule for warehouse:", warehouseId);

    try {
        const res = await fetch(`/api/delivery-schedule/${warehouseId}`);
        const data = await res.json();

        if (!data.ok) {
            console.warn("⚠ No schedule data loaded");
            return;
        }

        scheduleData = data;

        populateScheduleGrid(warehouseId, data);

    } catch (err) {
        console.error("❌ Failed loading schedule:", err);
    }
}

/**************************************************
 * POPULATE GRID WITH SCHEDULE DATA
 **************************************************/
function populateScheduleGrid(warehouseId, data) {
    const grid = document.querySelector(`#schedule-${warehouseId === 7 ? "sussex" : "kent"}`);

    if (!grid) return;

    // Headers
    grid.querySelectorAll(".zone-header").forEach((header, i) => {
        const h = data.headers.find(h => h.zone_number === i + 1);
header.innerHTML = (h?.label || `Zone ${i + 1}`)
    .replace(/\n/g, "<br>");


header.addEventListener("blur", () => {
    const html = header.innerHTML;
    saveZoneHeader(warehouseId, i + 1, html);
});

    });

    // Cells
    grid.querySelectorAll(".cell").forEach(cell => {
        const day = cell.dataset.day;
        const zone = Number(cell.dataset.zone);

        const match = data.cells.find(c => c.day === day && c.zone_number === zone);

        cell.textContent = match?.label || "";
        cell.style.background = match?.color || "transparent";
    });
}

/**************************************************
 * SAVE HEADER
 **************************************************/
async function saveZoneHeader(warehouseId, zone, rawText) {
    const cleaned = rawText
        .replace(/<br\s*\/?>/gi, "\n")  // convert HTML <br> to newline
        .replace(/\r/g, "");           // clean Windows line breaks

    await fetch(`/api/delivery-schedule/header/${warehouseId}/${zone}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: cleaned })
    });
}


/**************************************************
 * CELL CLICK → OPEN POPUP
 **************************************************/
function setupCellClickHandler() {
    document.addEventListener("click", e => {
        const cell = e.target.closest(".cell");
        if (!cell) return;

        const warehouseId = Number(document.querySelector(".delivery-subtab.active").dataset.warehouse);
        const day = cell.dataset.day;
        const zone = cell.dataset.zone;

        const url = `/deliverySchedulePopup/popup.html?warehouseId=${warehouseId}&day=${day}&zone=${zone}`;

        window.open(url, "deliveryPopup", "width=520,height=620,left=350,top=150");
    });
}
