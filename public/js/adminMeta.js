// public/js/adminMeta.js
async function loadMetaOptions() {
  try {
    const [rolesRes, locRes] = await Promise.all([
      fetch("/api/meta/roles").then(r => r.json()),
      fetch("/api/meta/locations").then(r => r.json())
    ]);

    const roleSelect = document.getElementById("roleSelect");
    const locSelect = document.getElementById("locationSelect");

    if (rolesRes.ok && roleSelect) {
      roleSelect.innerHTML = rolesRes.roles
        .map(r => `<option value="${r.id}">${r.name}</option>`)
        .join("");
    }

    if (locRes.ok && locSelect) {
      locSelect.innerHTML = locRes.locations
        .map(l => `<option value="${l.id}">${l.name}</option>`)
        .join("");
    }
  } catch (err) {
    console.error("❌ Failed to load metadata:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadMetaOptions);
