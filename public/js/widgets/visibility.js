// public/js/widgets/visibility.js
console.log("🎛️ Dashboard Widget Visibility loaded");

document.addEventListener("DOMContentLoaded", () => {
  let retries = 0;

  const tryLoadVisibility = async () => {
    const saved = storageGet();
    const userRoles = [];

    /* ============================================================
       Detect role from different storage formats
    ============================================================ */
    if (Array.isArray(saved?.user?.roles)) {
      userRoles.push(...saved.user.roles);
    }

    // ✅ Handle both string and object formats for activeRole
    if (typeof saved?.activeRole === "string") {
      userRoles.push(saved.activeRole); // e.g. "Admin"
    } else if (saved?.activeRole?.name) {
      userRoles.push(saved.activeRole.name);
    }

    if (saved?.role) {
      userRoles.push(saved.role);
    }

    // Retry a few times if role info not yet loaded
    if (!userRoles.length && retries < 5) {
      retries++;
      console.warn(`⚠️ No role info found (attempt ${retries}) — retrying...`);
      return setTimeout(tryLoadVisibility, 400);
    }

    // Stop after retries and show all widgets if still missing
    if (!userRoles.length) {
      console.warn("⚠️ No role info found after retries; showing all widgets");
      return;
    }

    console.log("👤 Current user roles:", userRoles);

    /* ============================================================
       Fetch dashboard widget visibility configuration
    ============================================================ */
    try {
      const res = await fetch("/api/dashboard-widgets");
      if (!res.ok) throw new Error("Failed to load widget config");
      const data = await res.json();
      if (!data.ok || !data.widgets) throw new Error("Invalid config data");

      console.log("🧩 Widget visibility config:", data.widgets);

      /* ============================================================
         Determine which widgets this user can see
      ============================================================ */
      const allowedWidgets = new Set(
        data.widgets
          .filter((w) => {
            // ✅ Show widget if unrestricted or user has at least one matching role
            if (!w.roles.length) return true;
            return w.roles.some((r) => userRoles.includes(r));
          })
          .map((w) => w.widget)
      );

      console.log("✅ Allowed widgets:", Array.from(allowedWidgets));

      /* ============================================================
         Map widget keys to element IDs
      ============================================================ */
      const allWidgets = [
        { key: "salesToday", id: "salesTodayWidget" },
        { key: "salesByStore", id: "salesByStoreWidget" },
        { key: "topThree", id: "topThreeWidget" },
      ];

      /* ============================================================
         Apply visibility
      ============================================================ */
      allWidgets.forEach(({ key, id }) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (allowedWidgets.has(key)) {
          el.style.display = "flex";
        } else {
          console.log(`🚫 Hiding widget: ${key}`);
          el.style.display = "none";
        }
      });

      /* ============================================================
         Handle "no visible widgets" fallback
      ============================================================ */
      const visible = allWidgets.some(({ id }) => {
        const el = document.getElementById(id);
        return el && el.style.display !== "none";
      });

      if (!visible) {
        const grid = document.getElementById("dashboardGrid");
        if (grid) {
          grid.innerHTML = `
            <div class="no-data" style="padding:40px;text-align:center;color:#777;">
              <p>🙈 You don’t have permission to view any widgets.</p>
            </div>`;
        }
      }
    } catch (err) {
      console.error("❌ Widget visibility load failed:", err);
    }
  };

  tryLoadVisibility();
});
