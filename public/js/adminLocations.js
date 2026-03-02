document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#locationTable tbody");
  const addBtn = document.getElementById("addLocationBtn");

  async function fetchLocations() {
    try {
      const res = await fetch("/api/meta/locations");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to fetch locations");
      renderLocations(data.locations || []);
    } catch (err) {
      console.error("❌ Failed to load locations:", err);
      alert("Failed to load locations. Check console for details.");
    }
  }

  function safe(val) {
    const v = val === null || val === undefined ? "" : String(val);
    return v.trim() ? v : "-";
  }

  function renderLocations(locations) {
    tableBody.innerHTML = locations
      .map(
        (l) => `
      <tr>
        <td>${safe(l.id)}</td>
        <td>${safe(l.name)}</td>
        <td>${safe(l.netsuite_internal_id)}</td>
        <td>${safe(l.invoice_location_id)}</td>
        <td>${safe(l.intercompany_customer)}</td>
        <td>${safe(l.distribution_location_id)}</td>
        <td>${safe(l.petty_cash_account)}</td>
        <td>${safe(l.current_account)}</td>
        <td>
          <button class="edit-btn" data-id="${l.id}">Edit</button>
          <button class="delete-btn" data-id="${l.id}">Delete</button>
        </td>
      </tr>`
      )
      .join("");
  }

  // === Add new ===
  addBtn.addEventListener("click", () => openPopup(null));

  // === Edit existing / Delete ===
  tableBody.addEventListener("click", (e) => {
    if (e.target.classList.contains("edit-btn")) {
      const id = e.target.dataset.id;
      openPopup(id);
    } else if (e.target.classList.contains("delete-btn")) {
      const id = e.target.dataset.id;
      if (confirm("Delete this location?")) deleteLocation(id);
    }
  });

  async function openPopup(id) {
    const win = window.open(
      "/adminLocationPopup.html",
      "EditLocation",
      "width=650,height=750,resizable=yes,scrollbars=yes"
    );

    // if popup blocked
    if (!win) {
      alert("Popup blocked — please allow popups for this site.");
      return;
    }

    // helper to send payload once popup is ready
    const post = (payload) => {
      // give popup time to load its listeners
      setTimeout(() => {
        try {
          win.postMessage(payload, "*");
        } catch (err) {
          console.warn("⚠️ Failed to postMessage to popup:", err);
        }
      }, 300);
    };

    if (!id) {
      // New record
      post({ action: "edit-location", location: null });
      return;
    }

    // Existing record
    try {
      const res = await fetch(`/api/meta/locations`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to fetch locations for edit");

      const loc = (data.locations || []).find((l) => String(l.id) === String(id));
      if (!loc) {
        alert("Location not found.");
        post({ action: "edit-location", location: null });
        return;
      }

      // ✅ Pass full location object including new fields
      post({ action: "edit-location", location: loc });
    } catch (err) {
      console.error("❌ Failed to load location for edit:", err);
      alert("Failed to load location for editing. Check console.");
      post({ action: "edit-location", location: null });
    }
  }

  async function deleteLocation(id) {
    try {
      const res = await fetch(`/api/meta/locations/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) fetchLocations();
      else alert("Failed to delete location: " + (data.error || "Unknown"));
    } catch (err) {
      console.error("❌ Delete failed:", err);
      alert("Delete failed. Check console.");
    }
  }

  // Popup -> parent refresh
  window.addEventListener("message", (event) => {
    if (event.data?.action === "refresh-locations") {
      fetchLocations();
    }
  });

  fetchLocations();
});