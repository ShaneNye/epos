const typeEl = document.getElementById("adjType");
const locEl = document.getElementById("adjLocation");
const reasonEl = document.getElementById("adjReason");
const amountEl = document.getElementById("adjAmount");

const saveBtn = document.getElementById("saveAdjBtn");
const cancelBtn = document.getElementById("cancelAdjBtn");

/* ----------------------------
   TYPE CHANGES
---------------------------- */
typeEl.addEventListener("change", () => {
    const type = typeEl.value;

    if (type === "petty") {
        locEl.value = "float";
        locEl.disabled = true;
        locEl.style.opacity = 0.6;

        // Force negative amounts
        amountEl.addEventListener("input", () => {
            let v = parseFloat(amountEl.value || 0);
            if (v > 0) amountEl.value = (v * -1).toFixed(2);
        });

    } else if (type === "misc") {
        locEl.disabled = false;
        locEl.style.opacity = 1;

        // Force positive amounts
        amountEl.addEventListener("input", () => {
            let v = parseFloat(amountEl.value || 0);
            if (v < 0) amountEl.value = Math.abs(v).toFixed(2);
        });
    }
});

/* ----------------------------
   SAVE + CLOSE
---------------------------- */
saveBtn.addEventListener("click", () => {
    const result = {
        type: typeEl.value,
        location: locEl.value,
        reason: reasonEl.value,
        amount: parseFloat(amountEl.value || 0)
    };

    window.opener.postMessage({ action: "cashflowAdjustment", data: result }, "*");

    window.close();
});

cancelBtn.addEventListener("click", () => window.close());
