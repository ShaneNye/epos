document.addEventListener("DOMContentLoaded", () => {
    console.log("📄 Delivery Schedule Report Loaded");

    setupReportTabs();
    setupReportPostcodeSearch();

    loadReportSchedule(7); // default Sussex
});

/**************************************************
 * SUBTAB SWITCHING
 **************************************************/
function setupReportTabs() {
    document.querySelectorAll(".delivery-subtab").forEach(tab => {
        tab.addEventListener("click", () => {

            document.querySelectorAll(".delivery-subtab")
                .forEach(t => t.classList.remove("active"));

            document.querySelectorAll(".delivery-subtab-content")
                .forEach(c => c.classList.add("hidden"));

            tab.classList.add("active");

            const target = document.getElementById(tab.dataset.target);
            target.classList.remove("hidden");

            loadReportSchedule(Number(tab.dataset.warehouse));
        });
    });
}

/**************************************************
 * LOAD SCHEDULE (READ ONLY)
 **************************************************/
let reportScheduleData = null;

async function loadReportSchedule(warehouseId) {
    try {
        const res = await fetch(`/api/delivery-schedule/${warehouseId}`);
        const data = await res.json();

        if (!data.ok) {
            console.warn("⚠ No schedule data found.");
            return;
        }

        reportScheduleData = data;

        populateReportGrid(warehouseId, data);

    } catch (err) {
        console.error("❌ Failed loading schedule:", err);
    }
}

/**************************************************
 * POPULATE READ ONLY GRID
 **************************************************/
function populateReportGrid(warehouseId, data) {
    const grid = document.querySelector(
        `#schedule-${warehouseId === 7 ? "sussex-report" : "kent-report"}`
    );
    if (!grid) return;

    // HEADERS (read-only)
    grid.querySelectorAll("thead th").forEach((header, i) => {
        if (i === 0) return; // skip empty day column

        const zone = i;
        const record = data.headers.find(h => h.zone_number === zone);

        if (record?.label) {
            header.innerHTML = record.label.replace(/\n/g, "<br>");
        }
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
 * POSTCODE SEARCH (REPORT READ ONLY)
 **************************************************/
function setupReportPostcodeSearch() {
    const btn = document.getElementById("postcodeSearchBtnReport");
    const input = document.getElementById("postcodeSearchInputReport");

    if (!btn || !input) return;

    btn.addEventListener("click", () => {
        runReportPostcodeSearch(input.value);
    });

    input.addEventListener("keyup", (e) => {
        if (e.key === "Enter") runReportPostcodeSearch(input.value);
    });
}

function runReportPostcodeSearch(prefix) {
    prefix = prefix.trim().toUpperCase();
    if (!prefix || !reportScheduleData) return;

    document.querySelectorAll(".cell-highlight-pulse")
        .forEach(c => c.classList.remove("cell-highlight-pulse"));

    let matches = 0;
    let firstMatch = null;

    ["sussex-report", "kent-report"].forEach(gridName => {
        const grid = document.getElementById(`schedule-${gridName}`);
        if (!grid) return;

        grid.querySelectorAll(".cell").forEach(cell => {
            const day = cell.dataset.day;
            const zone = Number(cell.dataset.zone);

            const cellData = reportScheduleData.cells.find(
                c => c.day === day && c.zone_number === zone
            );

            if (!cellData?.postcodes) return;

            const arr = cellData.postcodes.map(x => x.trim().toUpperCase());
            const match = arr.some(pc => pc.startsWith(prefix));

            if (match) {
                matches++;
                cell.classList.add("cell-highlight-pulse");

                if (!firstMatch) firstMatch = cell;
            }
        });
    });

    document.getElementById("postcodeSearchResultReport").textContent =
        matches ? `Found ${matches} matching cells` : `No matches found`;

    if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}
