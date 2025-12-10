document.addEventListener("DOMContentLoaded", () => {
    const postcodeField = document.getElementById("postcode");
    const warehouseField = document.getElementById("warehouse");

    if (!postcodeField || !warehouseField) {
        console.warn("Logistics postcode lookup: required fields not found.");
        return;
    }

    postcodeField.addEventListener("input", async () => {
        const raw = postcodeField.value.toUpperCase().trim();

        // Extract prefix like BN1, BN22, TN4, CT19 etc.
        const match = raw.match(/^([A-Z]{1,2}\d{1,2})/);
        if (!match) return;

        const prefix = match[1];
        console.log("🔍 Checking postcode prefix:", prefix);

        const res = await fetch(`/api/logistics/lookup/${prefix}`);
        const data = await res.json();

        if (!data.ok || !data.found) {
            console.log("❌ No warehouse match for prefix:", prefix);
            return;
        }

        // Select correct warehouse by NAME, not ID
        const options = [...warehouseField.options];

        const matchOption = options.find(opt =>
            opt.textContent.trim().toLowerCase() ===
            data.warehouse_name.trim().toLowerCase()
        );

        if (matchOption) {
            warehouseField.value = matchOption.value;

            // 🔥 CRITICAL: ensure inventory system updates cached warehouse
            warehouseField.dispatchEvent(new Event("change"));

            console.log(
                `📦 Auto-assigned warehouse: ${data.warehouse_name} (select value=${matchOption.value})`
            );
        } else {
            console.warn(
                `⚠️ Warehouse name returned by DB does not exist in dropdown: ${data.warehouse_name}`
            );
        }
    });
});
