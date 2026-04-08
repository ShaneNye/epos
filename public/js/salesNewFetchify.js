/* === Fetchify (CraftyClicks) Postcode Lookup === */

document.addEventListener("DOMContentLoaded", () => {
  const findBtn = document.getElementById("findAddressBtn");
  const postcodeInput = document.getElementById("postcode");
  const resultsSelect = document.getElementById("addressResults");

  if (!findBtn) return;

  findBtn.addEventListener("click", async () => {
    const postcode = postcodeInput.value.trim();

    if (!postcode) {
      alert("Please enter a postcode.");
      return;
    }

    resultsSelect.innerHTML = "<option>Searching...</option>";
    resultsSelect.classList.remove("hidden");

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

        document.querySelector('input[name="address1"]').value = a.line_1 || "";
        document.querySelector('input[name="address2"]').value = a.line_2 || "";
        document.querySelector('input[name="address3"]').value =
          a.line_3 || a.post_town || "";
        document.querySelector('input[name="county"]').value = a.county || "";
        document.querySelector('input[name="postcode"]').value = a.postcode || "";

        ["address1", "address2", "address3", "county", "postcode"].forEach((name) => {
          const field = document.querySelector(`input[name="${name}"]`);
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