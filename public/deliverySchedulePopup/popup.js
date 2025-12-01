document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(window.location.search);

    const warehouseId = params.get("warehouseId");
    const day = params.get("day");
    const zone = params.get("zone");

    console.log("Popup params →", { warehouseId, day, zone });

    // Insert info in popup header
    document.getElementById("popup-warehouse").textContent = warehouseId;
    document.getElementById("popup-day").textContent = day;
    document.getElementById("popup-zone").textContent = zone;

    /* -----------------------------
       LOAD EXISTING CELL VALUES
    ----------------------------- */
    try {
        const res = await fetch(`/api/delivery-schedule/cell/${warehouseId}/${day}/${zone}`);
        const json = await res.json();

        console.log("Loaded cell →", json);

        if (json.ok && json.cell) {
            const cell = json.cell;

            document.getElementById("label").value = cell.label || "";
            document.getElementById("ampm").value = cell.ampm || "";
            document.getElementById("color").value = cell.color || "#0081ab";

            document.getElementById("postcodes").value = cell.postcodes
                ? cell.postcodes.split(",").join(", ")
                : "";
        }

    } catch (err) {
        console.error("Failed to load cell", err);
    }

    /* -----------------------------
       SAVE BUTTON
    ----------------------------- */
    document.getElementById("saveBtn").addEventListener("click", async () => {

        const payload = {
            label: document.getElementById("label").value.trim(),
            ampm: document.getElementById("ampm").value || null,
            postcodes: document.getElementById("postcodes").value
                .split(",")
                .map(p => p.trim())
                .filter(p => p !== "") || null,
            color: document.getElementById("color").value || null
        };

        console.log("SAVE payload →", payload);

        try {
            const res = await fetch(`/api/delivery-schedule/cell/${warehouseId}/${day}/${zone}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const json = await res.json();
            console.log("Server response →", json);

            if (!json.ok) {
                alert("Failed to save: " + json.error);
                return;
            }

            /* -----------------------------
               NOTIFY PARENT & CLOSE POPUP
            ----------------------------- */
            if (window.opener && !window.opener.closed) {
                // Tell parent to refresh the table
                window.opener.postMessage({ action: "schedule-updated" }, "*");
            }

            window.close();

        } catch (err) {
            console.error("Save error", err);
            alert("Could not save changes.");
        }
    });
});
