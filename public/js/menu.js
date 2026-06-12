const USER_THEME_CACHE_KEY = "eposUserTheme";
const MENU_ACCESS_CACHE_KEY = "eposMenuAccess";

ensureThemeStylesheet();
applyCachedUserTheme();

// Load menu.html and inject into #menu
async function loadMenu() {
  try {
    ensureThemeStylesheet();
    const res = await fetch("/menu.html");
    if (!res.ok) throw new Error("Failed to load menu");
    const html = await res.text();
    document.getElementById("menu").innerHTML = html;
    initMenuLogic();
  } catch (err) {
    console.error("Menu load failed:", err);
  }
}

function ensureThemeStylesheet() {
  if (document.querySelector('link[href="/css/app-theme.css"]')) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/css/app-theme.css";
  document.head.appendChild(link);
}

function initMenuLogic() {
  const burger = document.getElementById("burger");
  const sidebar = document.getElementById("sidebar");
  if (burger && sidebar) {
    burger.addEventListener("click", () => {
      const expanded = sidebar.classList.toggle("expanded");
      document.body.classList.toggle("sidebar-expanded", expanded);
    });
  }

  // Highlight current page
  const currentPath = normalizePath(window.location.pathname);
  const menuRoot = document.getElementById("menu");
  if (menuRoot) {
    const menu = menuRoot.querySelector(".menu");
    const newsLink = menuRoot.querySelector('a[href="/news"]');
    if (menu && newsLink && newsLink.parentElement === menu) {
      menu.appendChild(newsLink);
    }

    menuRoot.querySelectorAll(".menu-item").forEach(link => {
      const href = normalizePath(link.getAttribute("href"));
      link.classList.toggle("active", href === currentPath);
    });

    const saved = typeof storageGet === "function" ? storageGet() : null;
    const cachedRole = getActiveRoleName(saved);
    const cachedAccess = getCachedMenuAccess(cachedRole);
    if (cachedAccess) applyMenuAccess(cachedAccess);
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
            "width=760,height=780,resizable=yes,scrollbars=yes"
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

function normalizeAccessSlug(value) {
  const slug = String(value || "")
    .replace(/^\//, "")
    .replace(/\.html$/i, "")
    .trim()
    .toLowerCase();

  if (slug === "end-of-day" || slug === "endofday") return "eod";
  if (slug === "cash-flow") return "cashflow";
  if (slug === "suitepim" || slug.startsWith("suitepim/")) return "suitepim";
  return slug;
}

function getActiveRoleName(session) {
  if (typeof session?.activeRole === "string") return session.activeRole;
  if (session?.activeRole?.name) return session.activeRole.name;
  if (typeof session?.role === "string") return session.role;
  if (session?.role?.name) return session.role.name;
  return "";
}

function userScopedCacheKey(baseKey, suffix = "") {
  const saved = typeof storageGet === "function" ? storageGet() : null;
  const userKey = String(saved?.username || saved?.email || saved?.user?.email || "").trim().toLowerCase();
  return [baseKey, userKey, suffix].filter(Boolean).join(":");
}

function menuAccessCacheKey(role) {
  const roleKey = String(role || "").trim().toLowerCase();
  return userScopedCacheKey(MENU_ACCESS_CACHE_KEY, roleKey);
}

function getCachedMenuAccess(role) {
  if (!role) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(menuAccessCacheKey(role)) || "null");
    return Array.isArray(cached?.allowed) ? cached.allowed : null;
  } catch {
    return null;
  }
}

function cacheMenuAccess(role, allowed) {
  if (!role || !Array.isArray(allowed)) return;
  localStorage.setItem(menuAccessCacheKey(role), JSON.stringify({
    allowed,
    savedAt: new Date().toISOString(),
  }));
}

function canMenuLinkShow(href, normalizedAllowed) {
  const canSeeNews =
    href === "news" &&
    (normalizedAllowed.includes("news") ||
      normalizedAllowed.includes("news-post") ||
      normalizedAllowed.includes("admin"));
  const canSeeAdminDefault =
    normalizedAllowed.includes("admin") && ["admin", "rota"].includes(href);

  return canSeeNews || canSeeAdminDefault || normalizedAllowed.includes(href);
}

function applyMenuAccess(allowed) {
  const normalizedAllowed = (allowed || []).map(normalizeAccessSlug);
  document.querySelectorAll(".menu-item").forEach(link => {
    const href = normalizeAccessSlug(link.getAttribute("href"));
    link.style.display = canMenuLinkShow(href, normalizedAllowed) ? "" : "none";
  });
}

function isHexColor(v) {
  return typeof v === "string" && /^#([0-9A-F]{3}){1,2}$/i.test(v.trim());
}

function getCachedUserTheme() {
  try {
    return JSON.parse(localStorage.getItem(userThemeCacheKey()) || localStorage.getItem(USER_THEME_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

function userThemeCacheKey() {
  const saved = typeof storageGet === "function" ? storageGet() : null;
  const userKey = String(saved?.username || saved?.email || saved?.user?.email || "").trim().toLowerCase();
  return userKey ? `${USER_THEME_CACHE_KEY}:${userKey}` : USER_THEME_CACHE_KEY;
}

function cacheUserTheme(theme) {
  const primary = normalizeHexColor(theme?.primary || theme?.themeHex || theme?.themehex);
  const accent = normalizeHexColor(theme?.accent || theme?.themeAccentHex || theme?.themeaccenthex);

  if (!primary && !accent) {
    clearCachedUserTheme();
    return;
  }

  localStorage.setItem(userThemeCacheKey(), JSON.stringify({ primary, accent }));
  localStorage.removeItem(USER_THEME_CACHE_KEY);
}

function clearCachedUserTheme() {
  localStorage.removeItem(userThemeCacheKey());
  localStorage.removeItem(USER_THEME_CACHE_KEY);
}

function applyCachedUserTheme() {
  const cached = getCachedUserTheme();
  if (cached) applyUserTheme(cached);
}

function normalizeHexColor(value) {
  if (!isHexColor(value)) return "";
  let hex = value.trim();
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex.toUpperCase();
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const int = parseInt(normalized.slice(1), 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function mixColors(a, b, weight) {
  const colorA = hexToRgb(a);
  const colorB = hexToRgb(b);
  if (!colorA || !colorB) return normalizeHexColor(a);
  const w = Math.max(0, Math.min(1, weight));
  return rgbToHex({
    r: colorA.r * (1 - w) + colorB.r * w,
    g: colorA.g * (1 - w) + colorB.g * w,
    b: colorA.b * (1 - w) + colorB.b * w,
  });
}

function applyUserTheme(theme) {
  const primary = normalizeHexColor(theme?.primary || theme?.themeHex || theme);
  const accent = normalizeHexColor(theme?.accent || theme?.themeAccentHex || theme?.themeaccenthex);
  const root = document.documentElement;
  const themedVars = [
    "--brand",
    "--brand-50",
    "--brand-100",
    "--brand-600",
    "--brand-700",
    "--brand-rgb",
    "--brand-shadow",
    "--brand-shadow-strong",
    "--focus-ring",
    "--selection-bg",
    "--row-hover-bg",
    "--sidebar-bg",
    "--sidebar-shadow",
    "--accent",
    "--accent-600",
    "--accent-rgb",
    "--accent-soft",
  ];

  if (!primary && !accent) {
    themedVars.forEach(name => root.style.removeProperty(name));
    return;
  }

  if (primary) {
    const rgb = hexToRgb(primary);
    const rgbText = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    root.style.setProperty("--brand", primary);
    root.style.setProperty("--brand-50", mixColors(primary, "#FFFFFF", 0.92));
    root.style.setProperty("--brand-100", mixColors(primary, "#FFFFFF", 0.84));
    root.style.setProperty("--brand-600", mixColors(primary, "#000000", 0.12));
    root.style.setProperty("--brand-700", mixColors(primary, "#000000", 0.24));
    root.style.setProperty("--brand-rgb", rgbText);
    root.style.setProperty("--brand-shadow", `rgba(${rgbText}, 0.18)`);
    root.style.setProperty("--brand-shadow-strong", `rgba(${rgbText}, 0.25)`);
    root.style.setProperty("--focus-ring", `0 0 0 3px rgba(${rgbText}, 0.18)`);
    root.style.setProperty("--selection-bg", `rgba(${rgbText}, 0.18)`);
    root.style.setProperty("--row-hover-bg", `rgba(${rgbText}, 0.08)`);
    root.style.setProperty(
      "--sidebar-bg",
      `linear-gradient(180deg, ${mixColors(primary, "#000000", 0.18)} 0%, ${primary} 58%, ${mixColors(primary, "#000000", 0.28)} 100%)`
    );
    root.style.setProperty("--sidebar-shadow", `10px 0 30px rgba(${rgbText}, 0.18)`);
  }

  if (accent) {
    const rgb = hexToRgb(accent);
    const rgbText = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-600", mixColors(accent, "#000000", 0.16));
    root.style.setProperty("--accent-rgb", rgbText);
    root.style.setProperty("--accent-soft", `rgba(${rgbText}, 0.16)`);
  }
}

function redirectToLoginWithReturn() {
  const next = `${window.location.pathname}${window.location.search || ""}`;
  sessionStorage.setItem("eposLoginNext", next);
  window.location.href = `/index.html?next=${encodeURIComponent(next)}`;
}


async function loadUser() {
  const saved = storageGet(); // from storage.js
  if (!saved || !saved.token) {
    return redirectToLoginWithReturn();
  }

  try {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${saved.token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error("Invalid session");

    const user = data.user;

    // 🎨 Apply user theme (only if set)
const userTheme = {
  primary: user.themeHex || user.themehex,
  accent: user.themeAccentHex || user.themeaccenthex,
};
applyUserTheme(userTheme);
if (normalizeHexColor(userTheme.primary) || normalizeHexColor(userTheme.accent)) {
  cacheUserTheme(userTheme);
} else {
  clearCachedUserTheme();
}


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
      await refreshNewsNotification();

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
    redirectToLoginWithReturn();
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
    const normalizedAllowed = allowed.map(normalizeAccessSlug);
    cacheMenuAccess(activeRole, allowed);

    console.log(`🔐 Role '${activeRole}' has access to:`, allowed);

    applyMenuAccess(allowed);

    // Normalize paths
    const pathNow = window.location.pathname.toLowerCase();
    const currentPath = normalizeAccessSlug(normalizePath(window.location.pathname));

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
      ["", "home", "index.html", "news"].includes(currentPath)
    ) {
      console.log("🏠 Base or home path detected — skipping access redirect");
      return;
    }

    if (currentPath === "rota" && normalizedAllowed.includes("admin")) {
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

async function refreshNewsNotification() {
  const dot = document.getElementById("newsNotificationDot");
  const newsItem = document.getElementById("newsMenuItem");
  const saved = storageGet();

  if (!dot || !newsItem || !saved?.token) return;

  try {
    const res = await fetch("/api/news/summary", {
      headers: { Authorization: `Bearer ${saved.token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to fetch news summary");

    dot.classList.toggle("hidden", !data.hasUnread);
    newsItem.setAttribute(
      "aria-label",
      data.hasUnread ? "News, unread posts available" : "News"
    );
  } catch (err) {
    console.warn("Failed to refresh news notification:", err.message || err);
    dot.classList.add("hidden");
  }
}

window.refreshNewsNotification = refreshNewsNotification;


loadMenu();
