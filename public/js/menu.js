// Load menu.html and inject into #menu
async function loadMenu() {
  try {
    const res = await fetch("/menu.html");
    if (!res.ok) throw new Error("Failed to load menu");
    const html = await res.text();
    document.getElementById("menu").innerHTML = html;
    initMenuLogic();
  } catch (err) {
    console.error("Menu load failed:", err);
  }
}

function initMenuLogic() {
  const burger = document.getElementById("burger");
  const sidebar = document.getElementById("sidebar");
  if (burger && sidebar) {
    burger.addEventListener("click", () => sidebar.classList.toggle("expanded"));
  }

  // Highlight current page
  const currentPath = normalizePath(window.location.pathname);
  const menuRoot = document.getElementById("menu");
  if (menuRoot) {
    menuRoot.querySelectorAll(".menu-item").forEach(link => {
      const href = normalizePath(link.getAttribute("href"));
      link.classList.toggle("active", href === currentPath);
    });
  }

  // Load current user
  loadUser();

// Logout
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem("eposAuth");
    localStorage.removeItem("eposAuth");
    window.location.href = "/index.html";
  });
}

const manageBtn = document.getElementById("manageBtn");
if (manageBtn) {
    manageBtn.addEventListener("click", () => {
        const saved = storageGet();

        // 🔥 FIX: ensure popup can access the token
        if (sessionStorage.getItem("eposAuth")) {
            localStorage.setItem("eposAuth", sessionStorage.getItem("eposAuth"));
        }

        const popup = window.open(
            "/manage.html",
            "ManageProfile",
            "width=500,height=650,resizable=yes,scrollbars=yes"
        );

        if (!popup) alert("Please allow pop-ups to use the Manage feature.");
    });
}

}

// --- Helpers ---
function normalizePath(path) {
  if (!path) return "/";
  let normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (normalized.endsWith(".html")) normalized = normalized.replace(/\.html$/, "");
  return normalized;
}

function isHexColor(v) {
  return typeof v === "string" && /^#([0-9A-F]{3}){1,2}$/i.test(v.trim());
}

function applyUserTheme(themeHex) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  if (isHexColor(themeHex)) {
    sidebar.style.background = themeHex.trim();
  } else {
    // if null/blank/invalid => remove inline style so CSS default applies
    sidebar.style.removeProperty("background");
  }
}


async function loadUser() {
  const saved = storageGet(); // from storage.js
  if (!saved || !saved.token) {
    return (window.location.href = "/index.html");
  }

  try {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${saved.token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error("Invalid session");

    const user = data.user;

    // 🎨 Apply user theme (only if set)
applyUserTheme(user.themeHex || user.themehex);


    // --- Display user info immediately
    const userNameEl = document.getElementById("userName");
    const avatar = document.getElementById("userAvatar");
    if (userNameEl) userNameEl.textContent = `${user.firstName} ${user.lastName}`;
    if (avatar) {
      if (user.profileImage) {
        avatar.innerHTML = `<img src="${user.profileImage}" alt="Profile" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      } else {
        avatar.textContent = `${user.firstName?.charAt(0) ?? ""}${user.lastName?.charAt(0) ?? ""}`;
      }
    }

    // --- Roles Dropdown ---
    const roleSelect = document.getElementById("activeRoleSelect");
    if (roleSelect) {
      roleSelect.innerHTML = "";
      if (user.roles && user.roles.length) {
        user.roles.forEach(role => {
          const opt = document.createElement("option");
          opt.value = role;
          opt.textContent = role;
          roleSelect.appendChild(opt);
        });
      }

      // Restore role from localStorage first (fast)
      let activeRole = saved.activeRole && user.roles.includes(saved.activeRole)
        ? saved.activeRole
        : null;

      // If not found, get from session
      if (!activeRole) {
        const roleRes = await fetch("/api/session/role", {
          headers: { Authorization: `Bearer ${saved.token}` },
        });
        const roleData = await roleRes.json();
        if (roleData.ok && roleData.role && user.roles.includes(roleData.role)) {
          activeRole = roleData.role;
        } else {
          activeRole = user.roles[0];
          await updateActiveRole(activeRole);
        }
      }

      // Save role to local storage
      saved.activeRole = activeRole;
      storageSet(true, saved);

      // Apply UI and access restrictions
      roleSelect.value = activeRole;
      await applyAccessRestrictions(activeRole, saved.token);

roleSelect.addEventListener("change", async e => {
  const newRole = e.target.value;
  await updateActiveRole(newRole);
  saved.activeRole = newRole;
  storageSet(true, saved);
  await applyAccessRestrictions(newRole, saved.token);
  console.log(`✅ Switched active role to '${newRole}'`);

  // 🔄 Refresh page to re-render dashboard/widgets under new role
  setTimeout(() => {
    window.location.reload();
  }, 500);
});

    }
  } catch (err) {
    console.error("Failed to load user:", err);
    window.location.href = "/index.html";
  }
}

// --- Update role in session ---
async function updateActiveRole(role) {
  const saved = storageGet();
  if (!saved?.token) return;

  try {
    const res = await fetch("/api/session/role", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${saved.token}`,
      },
      body: JSON.stringify({ role }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to update role");
    console.log(`🎯 Active role persisted to DB: ${role}`);
  } catch (err) {
    console.error("❌ Failed to update role:", err);
  }
}

// --- Apply Access Restrictions ---
async function applyAccessRestrictions(activeRole, token) {
  try {
    if (!activeRole || !token) {
      console.warn("⚠️ Skipping access restriction (no active role or token yet)");
      return;
    }

    const res = await fetch("/api/meta/roles", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error("Failed to fetch roles metadata");

    const roleInfo = data.roles.find(
      r => r.name.toLowerCase() === activeRole.toLowerCase()
    );
    const allowed = Array.isArray(roleInfo?.access) ? roleInfo.access : [];

    console.log(`🔐 Role '${activeRole}' has access to:`, allowed);

    // Update visible menu items based on access list
    document.querySelectorAll(".menu-item").forEach(link => {
      const href = link.getAttribute("href")
        .replace(/^\//, "")
        .replace(/\.html$/, "");
      link.style.display = allowed.includes(href) ? "" : "none";
    });

    // Normalize paths
    const pathNow = window.location.pathname.toLowerCase();
    const currentPath = normalizePath(window.location.pathname).replace(/^\//, "");
    const normalizedAllowed = allowed.map(a =>
      a.replace(/^\//, "").replace(/\.html$/, "").toLowerCase()
    );

    // ✅ Always allow Sales Order viewer pages & SalesOrder APIs
    if (
      pathNow.startsWith("/sales/view") ||
      pathNow.startsWith("/quote/view") ||
      pathNow.startsWith("/api/netsuite/salesorder")
    ) {
      console.log("🟢 Sales Order view detected — skipping access redirect");
      return;
    }

    // ✅ Skip redirect for home, login, or if role not yet applied
    if (
      !currentPath ||
      ["", "home", "index.html"].includes(currentPath)
    ) {
      console.log("🏠 Base or home path detected — skipping access redirect");
      return;
    }

    // 🚫 Redirect if page not in allowed list
    if (!normalizedAllowed.includes(currentPath)) {
      console.warn(`🚫 Access denied to '${currentPath}', redirecting to /home`);
      window.location.href = "/home";
    }
  } catch (err) {
    console.error("❌ Failed to apply access restrictions:", err);
  }
}


loadMenu();
