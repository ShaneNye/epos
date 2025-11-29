document.addEventListener("DOMContentLoaded", async () => {

    const urlParams = new URLSearchParams(window.location.search);
    const editingId = urlParams.get("id"); // null if new record

    const chipContainer = document.getElementById("chipContainer");
    const chipInput = document.getElementById("chipInput");

    let chipValues = [];
    let selectedColor = "#0081ab"; // default colour

    /* --------------------------------------------------------
       Initialise Colour Picker
    -------------------------------------------------------- */
    const colorPicker = document.getElementById("colorPicker");
    if (colorPicker) {
        colorPicker.value = selectedColor;

        colorPicker.addEventListener("input", e => {
            selectedColor = e.target.value;
        });
    }

    /* --------------------------------------------------------
       Load warehouses for dropdown
    -------------------------------------------------------- */
    async function loadWarehouses() {
        const res = await fetch("/api/meta/locations");
        const data = await res.json();

        const select = document.getElementById("warehouseSelect");
        select.innerHTML = "";

        data.locations.forEach(loc => {
            const clean = loc.name.includes(":")
                ? loc.name.split(":")[1].trim()
                : loc.name.trim();

            const opt = document.createElement("option");
            opt.value = loc.id;
            opt.textContent = clean;
            select.appendChild(opt);
        });
    }

    await loadWarehouses();

    /* --------------------------------------------------------
       CHIP SYSTEM
    -------------------------------------------------------- */
    function addChip(value) {
        if (!value || chipValues.includes(value)) return;

        chipValues.push(value);

        const chip = document.createElement("div");
        chip.className = "chip";
        chip.dataset.value = value;
        chip.innerHTML = `
            ${value}
            <span class="chip-remove">&times;</span>
        `;

        chipContainer.appendChild(chip);
    }

    function removeChip(value) {
        chipValues = chipValues.filter(v => v !== value);
        const chipEl = chipContainer.querySelector(`[data-value="${value}"]`);
        if (chipEl) chipEl.remove();
    }

    chipContainer.addEventListener("click", e => {
        if (e.target.classList.contains("chip-remove")) {
            const value = e.target.parentElement.dataset.value;
            removeChip(value);
        }
    });

    chipInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            const val = chipInput.value.trim().toUpperCase();

            if (!/^[A-Z0-9\*]+$/.test(val)) {
                alert("Invalid format. Example: BN9* or TN2*");
                return;
            }

            addChip(val);
            chipInput.value = "";
        }
    });

    /* --------------------------------------------------------
       EDIT MODE — load existing logistics area
    -------------------------------------------------------- */
    if (editingId) {
        document.querySelector(".popup-header h2").textContent =
            "Edit Logistics Warehouse";

        const res = await fetch("/api/logistics");
        const data = await res.json();

        const record = data.logistics.find(r => String(r.id) === String(editingId));

        if (record) {
            // Set warehouse dropdown
            document.getElementById("warehouseSelect").value = record.warehouse_id;

            // Clear & load chip list
            chipValues = [];
            chipContainer.innerHTML = "";
            record.postcodes.forEach(pc => addChip(pc));

            // Load saved colour
            selectedColor = record.hex_color || "#0081ab";
            if (colorPicker) colorPicker.value = selectedColor;
        }
    }

/* --------------------------------------------------------
   SAVE HANDLER (Create or Update)
-------------------------------------------------------- */
document.getElementById("saveBtn").addEventListener("click", async () => {
    const warehouse_id = document.getElementById("warehouseSelect").value;

    if (!warehouse_id) {
        alert("Select a warehouse.");
        return;
    }

    // 🟢 Make sure latest color is used even if user didn’t touch the picker
    if (colorPicker) {
        selectedColor = colorPicker.value;
    }

    const payload = {
        warehouse_id,
        postcodes: chipValues,
        hex_color: selectedColor
    };

    let url = "/api/logistics";
    let method = "POST";

    if (editingId) {
        url = `/api/logistics/${editingId}`;
        method = "PATCH";
    }

    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const json = await res.json();

    if (!json.ok) {
        alert("Error: " + json.error);
        return;
    }

    if (window.opener && !window.opener.closed) {
        window.opener.loadLogisticsTable();
    }

    window.close();
});

});
