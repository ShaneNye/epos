// public/js/widgets/visibility.js
console.log("Dashboard Widget Visibility loaded");

document.addEventListener("DOMContentLoaded", () => {
  let retries = 0;

  const tryLoadVisibility = async () => {
    const saved = storageGet();
    const userRoles = [];

    if (Array.isArray(saved?.user?.roles)) {
      userRoles.push(...saved.user.roles);
    }

    if (typeof saved?.activeRole === "string") {
      userRoles.push(saved.activeRole);
    } else if (saved?.activeRole?.name) {
      userRoles.push(saved.activeRole.name);
    }

    if (saved?.role) {
      userRoles.push(saved.role);
    }

    if (!userRoles.length && retries < 5) {
      retries++;
      console.warn(`No role info found (attempt ${retries}) - retrying...`);
      return setTimeout(tryLoadVisibility, 400);
    }

    if (!userRoles.length) {
      console.warn("No role info found after retries; showing all widgets");
      return;
    }

    try {
      const res = await fetch("/api/dashboard-widgets");
      if (!res.ok) throw new Error("Failed to load widget config");
      const data = await res.json();
      if (!data.ok || !data.widgets) throw new Error("Invalid config data");

      const allowedWidgets = new Set(
        data.widgets
          .filter((w) => {
            if (!w.roles.length) return true;
            return w.roles.some((r) => userRoles.includes(r));
          })
          .map((w) => w.widget)
      );
      const configuredWidgets = new Set(data.widgets.map((w) => w.widget));

      const allWidgets = [
        { key: "salesToday", id: "salesTodayWidget" },
        { key: "salesThisMonth", id: "salesThisMonthWidget" },
        { key: "salesByStore", id: "salesByStoreWidget" },
        { key: "topThree", id: "topThreeWidget" },
        { key: "outstandingActions", id: "outstandingActionsWidget" },
        { key: "kpiMeter", id: "kpiMeterWidget" },
        { key: "salesForcast", id: "salesForecastWidget" },
        { key: "homeRota", id: "homeRotaWidget", selfManaged: true },
      ];

      allWidgets.forEach(({ key, id }) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === "homeRotaWidget") return;

        if (!configuredWidgets.has(key) || allowedWidgets.has(key)) {
          el.style.display = "flex";
        } else {
          el.style.display = "none";
        }
      });

      const visible = allWidgets.some(({ id }) => {
        const el = document.getElementById(id);
        return el && !el.hidden && el.style.display !== "none";
      });
      const hasSelfManagedWidget = allWidgets.some(({ id, selfManaged }) =>
        selfManaged && document.getElementById(id)
      );

      if (!visible && !hasSelfManagedWidget) {
        const grid = document.getElementById("dashboardGrid");
        if (grid) {
          grid.innerHTML = `
            <div class="no-data" style="padding:40px;text-align:center;color:#777;">
              <p>You don't have permission to view any widgets.</p>
            </div>`;
        }
      }
    } catch (err) {
      console.error("Widget visibility load failed:", err);
    }
  };

  tryLoadVisibility();
});
