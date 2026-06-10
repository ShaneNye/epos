// public/js/widgets/dashboardDateFilter.js
(function () {
  const FILTERS = {
    today: "Today",
    yesterday: "Yesterday",
    thisWeek: "This week",
    lastWeek: "Last week",
    thisMonth: "This Month",
    lastMonth: "Last Month",
    custom: "Custom",
  };

  let currentKey = "today";
  let customStart = null;
  let customEnd = null;

  function localDate(value = new Date()) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function addDays(date, days) {
    const d = localDate(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function startOfWeek(date) {
    const d = localDate(date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function toIsoDate(date) {
    const d = localDate(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseUkDate(value) {
    const raw = String(value || "").trim();
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

  function getRange(key = currentKey) {
    const today = localDate(new Date());

    if (key === "custom") {
      const start = customStart || today;
      const end = customEnd || start;
      return { key, label: FILTERS[key], start, end };
    }

    if (key === "yesterday") {
      const yesterday = addDays(today, -1);
      return { key, label: FILTERS[key], start: yesterday, end: yesterday };
    }

    if (key === "thisWeek") {
      const start = startOfWeek(today);
      return { key, label: FILTERS[key], start, end: addDays(start, 6) };
    }

    if (key === "lastWeek") {
      const start = addDays(startOfWeek(today), -7);
      return { key, label: FILTERS[key], start, end: addDays(start, 6) };
    }

    if (key === "thisMonth") {
      return { key, label: FILTERS[key], start: startOfMonth(today), end: endOfMonth(today) };
    }

    if (key === "lastMonth") {
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { key, label: FILTERS[key], start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }

    return { key: "today", label: FILTERS.today, start: today, end: today };
  }

  function isDateInRange(value, range = getRange()) {
    const date = parseUkDate(value);
    return Boolean(date && date >= range.start && date <= range.end);
  }

  function formatRange(range = getRange()) {
    const sameDay = range.start.getTime() === range.end.getTime();
    const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
    return sameDay ? dayFmt.format(range.start) : `${shortFmt.format(range.start)} to ${dayFmt.format(range.end)}`;
  }

  function setRange(key) {
    currentKey = FILTERS[key] ? key : "today";
    const range = getRange(currentKey);
    syncInputs(range);
    window.dispatchEvent(new CustomEvent("dashboard:date-range-change", {
      detail: range,
    }));
  }

  function setCustomRange(startValue, endValue) {
    const start = parseUkDate(startValue);
    const end = parseUkDate(endValue);
    if (!start || !end) return;

    customStart = start <= end ? start : end;
    customEnd = end >= start ? end : start;
    currentKey = "custom";
    const range = getRange(currentKey);
    syncInputs(range);
    window.dispatchEvent(new CustomEvent("dashboard:date-range-change", { detail: range }));
  }

  function syncInputs(range = getRange()) {
    const select = document.getElementById("dashboardDateRange");
    const label = document.getElementById("dashboardDateRangeLabel");
    const fromInput = document.getElementById("dashboardDateFrom");
    const toInput = document.getElementById("dashboardDateTo");

    if (select) select.value = range.key;
    if (label) label.textContent = formatRange(range);
    if (fromInput) fromInput.value = toIsoDate(range.start);
    if (toInput) toInput.value = toIsoDate(range.end);
  }

  function renderFilter() {
    const select = document.getElementById("dashboardDateRange");
    const fromInput = document.getElementById("dashboardDateFrom");
    const toInput = document.getElementById("dashboardDateTo");
    if (!select) return;

    syncInputs(getRange(currentKey));

    select.addEventListener("change", () => {
      if (select.value === "custom") {
        setCustomRange(fromInput?.value, toInput?.value);
        return;
      }
      setRange(select.value);
    });

    [fromInput, toInput].forEach((input) => {
      input?.addEventListener("change", () => {
        setCustomRange(fromInput.value, toInput.value);
      });
    });
  }

  window.DashboardDateFilter = {
    filters: FILTERS,
    getRange,
    setRange,
    setCustomRange,
    isDateInRange,
    formatRange,
    parseUkDate,
    toIsoDate,
  };

  document.addEventListener("DOMContentLoaded", renderFilter);
})();
