document.addEventListener("DOMContentLoaded", () => {
  const els = {
    widget: document.getElementById("homeRotaWidget"),
    range: document.getElementById("homeRotaRange"),
    loading: document.getElementById("homeRotaLoading"),
    empty: document.getElementById("homeRotaEmpty"),
    error: document.getElementById("homeRotaError"),
    list: document.getElementById("homeRotaList"),
  };

  if (!els.widget) return;

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

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function fullUserName(user) {
    return normalizeText(`${user?.firstName || ""} ${user?.lastName || ""}`);
  }

  function localDate(value = new Date()) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function startOfWeek(date) {
    const d = localDate(date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }

  function addDays(date, days) {
    const d = localDate(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function toIsoDate(date) {
    const d = localDate(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseRotaDate(value) {
    const raw = normalizeText(value);
    const ukMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ukMatch) {
      return new Date(Number(ukMatch[3]), Number(ukMatch[2]) - 1, Number(ukMatch[1]));
    }

    const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : localDate(parsed);
  }

  function formatRange(start, end) {
    const fmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
    const endFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    return `${fmt.format(start)} to ${endFmt.format(end)}`;
  }

  function formatDay(date) {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
    }).format(date);
  }

  function datesBetween(start, end) {
    const dates = [];
    let cursor = localDate(start);
    while (cursor <= end) {
      dates.push(localDate(cursor));
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  function getRowDate(row) {
    return parseRotaDate(row.Date || row.date || row.rotaDate || row["Rota Date"]);
  }

  function normalizeRow(row) {
    const date = getRowDate(row);
    return {
      location: normalizeText(row.Location || row.location),
      employee: normalizeText(row.Employee || row.employee),
      role: normalizeText(row.Role || row.role || row.employeeRole || row["Employee Role"]),
      date,
      isoDate: date ? toIsoDate(date) : "",
    };
  }

  function sameEmployee(a, b) {
    return normalizeText(a).toLowerCase().replace(/\s+/g, " ") ===
      normalizeText(b).toLowerCase().replace(/\s+/g, " ");
  }

  function setVisible(isVisible) {
    els.widget.hidden = !isVisible;
    els.widget.style.display = isVisible ? "flex" : "none";
  }

  function setState(state) {
    els.loading.classList.toggle("hidden", state !== "loading");
    els.empty.classList.toggle("hidden", state !== "empty");
    els.error.classList.toggle("hidden", state !== "error");
    els.list.classList.toggle("hidden", state !== "ready");
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, { cache: "no-store", ...options });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed: ${url}`);
    return data;
  }

  async function userCanAccessRota(activeRole) {
    if (!activeRole) return false;
    const data = await fetchJson(`/api/meta/roles?_=${Date.now()}`);
    const role = (data.roles || []).find((r) =>
      normalizeText(r.name).toLowerCase() === normalizeText(activeRole).toLowerCase()
    );
    const access = Array.isArray(role?.access) ? role.access.map(normalizeAccessSlug) : [];
    return access.includes("rota") || access.includes("admin");
  }

  async function fetchActiveRole(fallback = "") {
    if (fallback) return fallback;
    try {
      const data = await fetchJson(`/api/session/role?_=${Date.now()}`);
      return data.role || "";
    } catch (err) {
      console.warn("Failed to load active role for homepage rota:", err);
      return "";
    }
  }

  function getDashboardRange() {
    const range = window.DashboardDateFilter?.getRange();
    if (range?.start && range?.end) return range;

    const today = localDate(new Date());
    return {
      label: "Today",
      start: today,
      end: today,
    };
  }

  function renderRows(rows, start, end) {
    els.list.innerHTML = "";

    const uniqueRows = [];
    const seen = new Set();
    rows
      .filter((row) => row.date && row.date >= start && row.date <= end)
      .sort((a, b) =>
        (a.isoDate || "").localeCompare(b.isoDate || "") ||
        (a.location || "").localeCompare(b.location || "") ||
        (a.role || "").localeCompare(b.role || "")
      )
      .forEach((row) => {
        const key = `${row.isoDate}__${row.location}__${row.role}`;
        if (seen.has(key)) return;
        seen.add(key);
        uniqueRows.push(row);
      });

    if (!uniqueRows.length) {
      setState("empty");
      return;
    }

    const byDate = new Map();
    uniqueRows.forEach((row) => {
      if (!byDate.has(row.isoDate)) byDate.set(row.isoDate, []);
      byDate.get(row.isoDate).push(row);
    });

    datesBetween(start, end).forEach((dateValue) => {
      const isoDate = toIsoDate(dateValue);
      const shifts = byDate.get(isoDate) || [];
      const item = document.createElement("div");
      item.className = `home-rota-day${shifts.length ? " has-shift" : ""}`;

      const date = document.createElement("div");
      date.className = "home-rota-date";
      date.textContent = formatDay(dateValue);
      item.appendChild(date);

      if (!shifts.length) {
        const empty = document.createElement("span");
        empty.className = "home-rota-off";
        empty.textContent = "Off";
        item.appendChild(empty);
      }

      shifts.slice(0, 2).forEach((row) => {
        const detail = document.createElement("div");
        detail.className = "home-rota-detail";

        const location = document.createElement("strong");
        location.textContent = row.location || "Location not listed";
        detail.appendChild(location);

        const role = document.createElement("span");
        role.textContent = row.role || "No role listed";
        detail.appendChild(role);

        item.appendChild(detail);
      });

      if (shifts.length > 2) {
        const more = document.createElement("span");
        more.className = "home-rota-more";
        more.textContent = `+${shifts.length - 2} more`;
        item.appendChild(more);
      }

      els.list.appendChild(item);
    });

    setState("ready");
  }

  async function initHomeRota() {
    setVisible(false);
    setState("loading");

    try {
      const me = await fetchJson(`/api/me?_=${Date.now()}`);
      const saved = typeof storageGet === "function" ? storageGet() : null;
      const activeRole = await fetchActiveRole(me.activeRole || saved?.activeRole?.name || saved?.activeRole || "");

      if (!(await userCanAccessRota(activeRole))) {
        setVisible(false);
        return;
      }

      const employee = fullUserName(me.user);
      const selectedRange = getDashboardRange();
      const start = selectedRange.start;
      const end = selectedRange.end;
      els.range.textContent = formatRange(start, end);
      setVisible(true);

      const params = new URLSearchParams({
        startDate: toIsoDate(start),
        endDate: toIsoDate(end),
        employee,
        refresh: "1",
        _: String(Date.now()),
      });
      const data = await fetchJson(`/api/netsuite/breathe-rota?${params.toString()}`);
      const sourceRows = Array.isArray(data.results) ? data.results : Array.isArray(data.data) ? data.data : [];
      const rows = sourceRows
        .map(normalizeRow)
        .filter((row) => row.location && row.employee && row.date && sameEmployee(row.employee, employee));

      renderRows(rows, start, end);
    } catch (err) {
      console.error("Failed to load homepage rota:", err);
      setVisible(true);
      setState("error");
    }
  }

  window.addEventListener("dashboard:date-range-change", initHomeRota);
  initHomeRota();
});
