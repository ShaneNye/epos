let editingUserId = null;
let allUsers = []; // cache of all users

// --- Fetch & Render Users ---
async function fetchUsers() {
  try {
    const res = await fetch("/api/users");
    const data = await res.json();
    if (!data.ok) throw new Error("Failed to fetch users");
    allUsers = data.users;
    renderUsers(allUsers);
  } catch (err) {
    console.error("Fetch users failed:", err);
    alert("Unable to load users. Check console for details.");
  }
}

function renderUsers(users) {
  const tbody = document.querySelector("#userTable tbody");
  tbody.innerHTML = "";

  if (!users || users.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="text-align:center; padding:1rem; color:var(--muted);">No users found</td>`;
    tbody.appendChild(tr);
    return;
  }

  users.forEach(user => {
    const initials = `${(user.firstName || "").charAt(0)}${(user.lastName || "").charAt(0)}`.toUpperCase();
    const nameHtml = `
      <div class="user-ident">
        ${user.profileImage
          ? `<img class="avatar" src="${user.profileImage}" alt="Avatar">`
          : `<div class="avatar-initials">${initials || "?"}</div>`}
        <div>${user.firstName || ""} ${user.lastName || ""}</div>
      </div>
    `;

    const rolesList = (user.roles || []).map(r => r.name).join(", ");
    const locationName = user.location?.name || "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="user-ident-cell">${nameHtml}</td>
      <td>${user.email || ""}</td>
      <td>${rolesList}</td>
      <td>${locationName}</td>
      <td class="actions">
        <button class="action-btn action-edit" data-id="${user.id}">Edit</button>
        <button class="action-btn action-delete" data-id="${user.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll("#userTable .action-edit").forEach(btn =>
    btn.addEventListener("click", () => openModalForEdit(btn.dataset.id))
  );
  document.querySelectorAll("#userTable .action-delete").forEach(btn =>
    btn.addEventListener("click", () => revokeUser(btn.dataset.id))
  );
}

// --- Load dropdowns dynamically ---
async function loadRoleAndLocationOptions() {
  try {
    const [rolesRes, locRes] = await Promise.all([
      fetch("/api/meta/roles").then(r => r.json()),
      fetch("/api/meta/locations").then(r => r.json())
    ]);

    const modal = document.querySelector('#userModal:not(.hidden)') || document.getElementById('userModal');
    const roleSelect = modal.querySelector('#roleSelect');
    const locationSelect = modal.querySelector('#locationSelect');

    // Populate roles
    if (rolesRes.ok && rolesRes.roles.length > 0) {
      roleSelect.innerHTML = rolesRes.roles
        .map(r => `<option value="${r.id}">${r.name}</option>`)
        .join("");
    } else {
      roleSelect.innerHTML = "";
    }

    // Populate locations
    if (locRes.ok && locRes.locations.length > 0) {
      locationSelect.innerHTML = locRes.locations
        .map(l => `<option value="${l.id}">${l.name}</option>`)
        .join("");
    } else {
      locationSelect.innerHTML = "";
    }
  } catch (err) {
    console.error("Failed to load roles/locations:", err);
    alert("Failed to load dropdown options — check console for details.");
  }
}

// --- Modal Handling ---
async function openModalForEdit(userId) {
  editingUserId = userId;
  document.getElementById("modalTitle").textContent = "Edit User";
  showModal();
  await new Promise(r => setTimeout(r, 50));
  await loadRoleAndLocationOptions();

  try {
    const res = await fetch(`/api/users/${userId}`);
    const data = await res.json();
    if (!data.ok) throw new Error("User not found");

    const user = data.user;
    const form = document.getElementById("userForm");

    form.id.value = user.id;
    form.firstName.value = user.firstName || "";
    form.lastName.value = user.lastName || "";
    form.email.value = user.email || "";
    form.profileImage.value = user.profileImage || "";
    form.password.value = "";
    form.netsuiteId.value = user.netsuiteId || ""; // ✅ new field populated

    const roleSelect = document.querySelector('#userModal:not(.hidden) #roleSelect');
    const locationSelect = document.querySelector('#userModal:not(.hidden) #locationSelect');

    if (user.roles && Array.isArray(user.roles)) {
      const userRoleIds = user.roles.map(r => String(r.id));
      Array.from(roleSelect.options).forEach(opt => {
        opt.selected = userRoleIds.includes(opt.value);
      });
    }

    if (user.location) locationSelect.value = user.location.id;
    else locationSelect.value = "";

    // Mask NetSuite tokens
    ["sb_netsuite_token_id", "sb_netsuite_token_secret", "prod_netsuite_token_id", "prod_netsuite_token_secret"].forEach(field => {
      form[field].value = user[field] ? "************" : "";
    });
  } catch (err) {
    console.error("Failed to load user:", err);
    alert("Failed to load user details.");
  }
}

async function openModalForCreate() {
  editingUserId = null;
  document.getElementById("modalTitle").textContent = "Add New User";
  const form = document.getElementById("userForm");
  form.reset();
  form.netsuiteId.value = ""; // ✅ clear field
  showModal();
  await new Promise(r => setTimeout(r, 50));
  await loadRoleAndLocationOptions();
}

function showModal() {
  document.getElementById("userModal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("userModal").classList.add("hidden");
}

// --- Delete User ---
function revokeUser(userId) {
  if (!confirm("Are you sure you want to delete this user?")) return;
  fetch(`/api/users/${userId}`, { method: "DELETE" })
    .then(res => res.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || "Delete failed");
      fetchUsers();
    })
    .catch(err => {
      console.error("Delete failed:", err);
      alert("Failed to delete user.");
    });
}

// --- Save User (Create / Update) ---
document.addEventListener("DOMContentLoaded", () => {
  const addUserBtn = document.getElementById("addUserBtn");
  const cancelModal = document.getElementById("cancelModal");
  const userForm = document.getElementById("userForm");

  if (addUserBtn) addUserBtn.addEventListener("click", openModalForCreate);
  if (cancelModal) cancelModal.addEventListener("click", closeModal);

  if (userForm) {
    userForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;

      // ✅ Always send numeric role IDs
      const selectedRoleIds = Array.from(
        document.querySelectorAll('#userModal:not(.hidden) #roleSelect option:checked')
      ).map(opt => parseInt(opt.value, 10));

      const body = {
        firstName: form.firstName.value,
        lastName: form.lastName.value,
        email: form.email.value,
        netsuiteId: form.netsuiteId.value || null, // ✅ include new field
        role_ids: selectedRoleIds,
        location_id: form.locationSelect.value || null,
        profileImage: form.profileImage.value
      };

      if (form.password.value) body.password = form.password.value;

      ["sb_netsuite_token_id", "sb_netsuite_token_secret", "prod_netsuite_token_id", "prod_netsuite_token_secret"].forEach(field => {
        if (form[field] && form[field].value && form[field].value !== "************") {
          body[field] = form[field].value;
        }
        if (form[field] && !form[field].value) {
          body[field] = null;
        }
      });

      try {
        const url = editingUserId ? `/api/users/${editingUserId}` : "/api/users";
        const method = editingUserId ? "PUT" : "POST";

        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Save failed");

        console.log("✅ User saved successfully:", body);
        closeModal();
        fetchUsers();
      } catch (err) {
        console.error("Save user failed:", err);
        alert("Failed to save user. Check console for details.");
      }
    });
  }

  fetchUsers();
});

// --- Expose globally ---
window.AdminUsers = {
  get allUsers() { return allUsers; },
  set allUsers(users) { allUsers = users; },
  renderUsers,
  fetchUsers
};
