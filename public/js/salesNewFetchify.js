/* === Fetchify (CraftyClicks) Postcode Lookup === */

document.addEventListener("DOMContentLoaded", () => {
  const findBtn = document.getElementById("findAddressBtn");
  const postcodeInput = document.getElementById("postcode");
  const resultsSelect = document.getElementById("addressResults");

  if (!findBtn) return;

  const setInputValue = (name, value) => {
    const field = document.querySelector(`[name="${name}"]`);
    if (!field) return;
    if (name === "county" && window.EposCountySelect?.setValue) {
      window.EposCountySelect.setValue(field, value || "");
      return;
    }
    field.value = value || "";
  };

  const hideAddressResults = () => {
    if (!resultsSelect) return;
    resultsSelect.blur();
    resultsSelect.selectedIndex = 0;
    resultsSelect.classList.add("hidden");
    resultsSelect.hidden = true;
  };

  findBtn.addEventListener("click", async () => {
    const postcode = postcodeInput.value.trim();

    if (!postcode) {
      alert("Please enter a postcode.");
      return;
    }

    resultsSelect.innerHTML = "<option>Searching...</option>";
    resultsSelect.classList.remove("hidden");
    resultsSelect.hidden = false;

    try {
      const response = await fetch(`/api/fetchify/postcode/${encodeURIComponent(postcode)}`);
      const data = await response.json();

      console.log("📦 Fetchify raw response:", data);
      console.log("📮 Fetchify raw addresses:", data.addresses || []);

      if (!data.addresses || !data.addresses.length) {
        resultsSelect.innerHTML = "<option>No results found</option>";
        return;
      }

      // Populate dropdown with addresses
      resultsSelect.innerHTML = '<option value="">Select an address</option>';
      data.addresses.forEach((addr, i) => {
        console.log(`📍 Address ${i}:`, addr);

        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent =
          `${addr.line_1 || ""}` +
          `${addr.line_2 ? ", " + addr.line_2 : ""}` +
          `${addr.line_3 ? ", " + addr.line_3 : ""}` +
          `${addr.post_town ? ", " + addr.post_town : ""}` +
          `${addr.county ? ", " + addr.county : ""}` +
          `${addr.postcode ? ", " + addr.postcode : ""}`;

        resultsSelect.appendChild(opt);
      });

      resultsSelect.onchange = () => {
        const idx = resultsSelect.value;
        if (idx === "") return;

        const a = data.addresses[idx];
        console.log("✅ Selected address raw data:", a);

        setInputValue("address1", a.line_1);
        setInputValue("address2", a.line_2);
        setInputValue("address3", a.line_3 || a.post_town);
        setInputValue("county", a.county);
        setInputValue("postcode", a.postcode);
        hideAddressResults();

        ["address1", "address2", "address3", "county", "postcode"].forEach((name) => {
          const field = document.querySelector(`[name="${name}"]`);
          if (!field) return;
          field.classList.add("address-filled");
          setTimeout(() => field.classList.remove("address-filled"), 800);
        });
      };
    } catch (err) {
      console.error("Fetchify lookup failed:", err);
      alert("Unable to fetch address details. Please try again.");
    }
  });
});
