document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#locationTable tbody");
  const addBtn = document.getElementById("addLocationBtn");

  async function fetchLocations() {
    try {
      const res = await fetch("/api/meta/locations");
      const data = await res.json();
      if (!data.ok) throw new Error("Failed to fetch locations");
      renderLocations(data.locations);
    } catch (err) {
      console.error("❌ Failed to load locations:", err);
    }
  }

  function renderLocations(locations) {
    tableBody.innerHTML = locations
      .map(
        (l) => `
      <tr>
        <td>${l.id}</td>
        <td>${l.name}</td>
        <td>${l.netsuite_internal_id || "-"}</td>
        <td>${l.invoice_location_id || "-"}</td>
        <td>${l.intercompany_customer || "-"}</td>
        <td>${l.petty_cash_account || "-"}</td>
        <td>${l.current_account || "-"}</td>
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

  // === Edit existing ===
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
      "width=500,height=600,resizable=yes,scrollbars=yes"
    );

    if (id) {
      const res = await fetch(`/api/meta/locations`);
      const data = await res.json();
      if (data.ok) {
        const loc = data.locations.find((l) => String(l.id) === String(id));
        if (loc) {
          setTimeout(() => win.postMessage({ action: "edit-location", location: loc }, "*"), 300);
        }
      }
    } else {
      setTimeout(() => win.postMessage({ action: "edit-location", location: null }, "*"), 300);
    }
  }

  async function deleteLocation(id) {
    const res = await fetch(`/api/meta/locations/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) fetchLocations();
    else alert("Failed to delete location: " + (data.error || "Unknown"));
  }

  window.addEventListener("message", (event) => {
    if (event.data?.action === "refresh-locations") {
      fetchLocations();
    }
  });

  fetchLocations();
});
