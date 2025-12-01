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
let currentScheduleWarehouse = 7; 
let scheduleData = null;

/**************************************************
 * INSTANT CELL UPDATE
 **************************************************/
function applyInstantCellUpdate(update) {
    const { warehouseId, day, zone, label, color } = update;

    const tableId = warehouseId == 7 ? "sussex" : "kent";
    const grid = document.querySelector(`#schedule-${tableId}`);
    if (!grid) return;

    const cell = grid.querySelector(`.cell[data-day="${day}"][data-zone="${zone}"]`);
    if (!cell) return;

    cell.textContent = label || "";
    cell.style.background = color || "transparent";

    console.log(`⚡ Instant update applied → day=${day}, zone=${zone}`);
}

/**************************************************
 * CLEAR HIGHLIGHTS
 **************************************************/
function clearPulseHighlights() {
    document.querySelectorAll(".cell-highlight-pulse")
        .forEach(c => c.classList.remove("cell-highlight-pulse"));
}

/**************************************************
 * POSTCODE SEARCH FEATURE
 **************************************************/
function searchScheduleByPostcode(prefix) {
    if (!scheduleData) return;

    prefix = prefix.trim().toUpperCase();
    if (!prefix) return;

    clearPulseHighlights();

    const resultLabel = document.getElementById("postcodeSearchResult");
    let matches = 0;
    let firstMatch = null;

    ["sussex", "kent"].forEach(gridName => {
        const grid = document.querySelector(`#schedule-${gridName}`);
        if (!grid) return;

        grid.querySelectorAll(".cell").forEach(cell => {
            const day = cell.dataset.day;
            const zone = Number(cell.dataset.zone);

            const cellData = scheduleData?.cells?.find(
                c => c.day === day && Number(c.zone_number) === zone
            );

            if (!cellData || !cellData.postcodes) return;

            const arr = cellData.postcodes.map(p => p.toUpperCase().trim());
            const match = arr.some(pc => pc.startsWith(prefix));

            if (match) {
                matches++;
                cell.classList.add("cell-highlight-pulse");

                if (!firstMatch) firstMatch = cell;
            }
        });
    });

    if (resultLabel) {
        resultLabel.textContent = matches
            ? `Found ${matches} matching cells`
            : `No matches found`;
    }

    if (firstMatch) {
        setTimeout(() => {
            firstMatch.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
    }
}

/**************************************************
 * INIT PAGE
 **************************************************/
document.addEventListener("DOMContentLoaded", () => {
    console.log("📦 Logistics JS Loaded");

    setupMainTabs();
    setupDeliverySubTabs();
    setupPostcodeLabelToggle();
    setupCellClickHandler();

    // 📍 Postcode Search Support
    const searchBtn = document.getElementById("postcodeSearchBtn");
    const searchInput = document.getElementById("postcodeSearchInput");

    if (searchBtn) {
        searchBtn.addEventListener("click", () => {
            searchScheduleByPostcode(searchInput.value);
        });
    }

    if (searchInput) {
        searchInput.addEventListener("keyup", (e) => {
            if (e.key === "Enter") {
                searchScheduleByPostcode(searchInput.value);
            }
        });
    }

    loadLogisticsTable();

    // LISTEN FOR POPUP SAVE EVENTS
    window.addEventListener("message", (ev) => {
        if (ev.data?.action === "schedule-updated") {

            if (ev.data.update) {
                applyInstantCellUpdate(ev.data.update);
            }

            loadScheduleForWarehouse(currentScheduleWarehouse);
        }
    });
});

/**************************************************
 * MAIN TAB SWITCHING
 **************************************************/
function setupMainTabs() {
    document.querySelectorAll(".tab").forEach(tab => {
        tab.addEventListener("click", () => {

            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));

            tab.classList.add("active");
            const target = document.getElementById(tab.dataset.target);
            if (target) target.classList.remove("hidden");

            if (tab.dataset.target === "postcodes") {
                loadLogisticsTable();
            }

            if (tab.dataset.target === "deliverySchedule") {
                const sussex = document.querySelector('.delivery-subtab[data-warehouse="7"]');
                if (sussex) sussex.click();
            }
        });
    });
}

/**************************************************
 * POSTCODE TABLE LOAD
 **************************************************/
async function loadLogisticsTable() {
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
                        width:22px;height:22px;
                        background:${row.hex_color || "#0081ab"};
                        border:1px solid #ccc;border-radius:4px;">
                    </div>
                </td>
                <td class="actions">
                    <button onclick="editLogistics(${row.id})" class="action-btn action-edit">Edit</button>
                    <button onclick="deleteLogistics(${row.id})" class="action-btn action-delete">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        await renderCoverageMap(data.logistics);

    } catch (err) {
        console.error("❌ Failed loading logistics:", err);
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
 * INIT MAP
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
 * SINGLE DISTRICT MAP RENDER
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
        console.error(`❌ Failed district ${district}`, err);
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
 * SUB-TAB SWITCHING
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
 * LOAD SCHEDULE FOR WAREHOUSE
 **************************************************/
async function loadScheduleForWarehouse(warehouseId) {
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
 * POPULATE GRID (HEADERS + CELLS)
 * WITH FALLBACK-SAVE PROTECTION
 **************************************************/
function populateScheduleGrid(warehouseId, data) {
    const grid = document.querySelector(`#schedule-${warehouseId === 7 ? "sussex" : "kent"}`);
    if (!grid) return;

    // ZONE HEADERS
    grid.querySelectorAll(".zone-header").forEach((header, i) => {
        const zone = i + 1;
        const record = data.headers.find(h => h.zone_number === zone);

        // Only update if DB has real value
        if (record?.label) {
            header.innerHTML = record.label.replace(/\n/g, "<br>");
        } else {
            console.warn(`⚠ Missing header for zone ${zone} — NOT applying fallback.`);
        }

        header.contentEditable = "true";

        header.addEventListener("blur", () => {
            const html = header.innerHTML.trim();
            const fallback = `Zone ${zone}`;

            if (!html || html === fallback || html === `${fallback}<br>`) {
                console.log(`⛔ Prevented fallback header save for zone ${zone}`);
                return;
            }

            saveZoneHeader(warehouseId, zone, html);
        });
    });

    // CELLS
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
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\r/g, "");

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
