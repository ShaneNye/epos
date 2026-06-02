document.addEventListener("DOMContentLoaded", () => {
  const state = {
    rows: [],
    locationsByName: new Map(),
    usersByName: new Map(),
    currentUserName: "",
    googleConnected: false,
    defaultEmployeeApplied: false,
    filtersReady: false,
  };

  const els = {
    calendar: document.getElementById("rotaCalendar"),
    empty: document.getElementById("rotaEmpty"),
    loading: document.getElementById("rotaLoading"),
    summary: document.getElementById("rotaSummary"),
    startDate: document.getElementById("startDateFilter"),
    endDate: document.getElementById("endDateFilter"),
    employee: document.getElementById("employeeFilter"),
    location: document.getElementById("locationFilter"),
    refresh: document.getElementById("refreshRotaBtn"),
    previousWeek: document.getElementById("previousWeekBtn"),
    thisWeek: document.getElementById("thisWeekBtn"),
    nextWeek: document.getElementById("nextWeekBtn"),
  };

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

  function formatHeaderDate(date) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
    }).format(date);
  }

  function formatSummaryDate(date) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeLookupKey(value) {
    return normalizeText(value).toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ");
  }

  function initialsForName(name) {
    const parts = normalizeText(name).split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "?";
  }

  function fullUserName(user) {
    return normalizeText(`${user?.firstName || ""} ${user?.lastName || ""}`);
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

  function setDefaultWeek() {
    const monday = startOfWeek(new Date());
    els.startDate.value = toIsoDate(monday);
    els.endDate.value = toIsoDate(addDays(monday, 6));
  }

  function setLoading(isLoading) {
    els.loading.classList.toggle("hidden", !isLoading);
    els.refresh.disabled = isLoading;
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function uniqueSortedRotaEntries(entries) {
    const byEmployeeRole = new Map();
    entries.forEach((entry) => {
      if (!entry?.employee) return;
      const key = `${entry.employee}__${entry.role || ""}`;
      if (!byEmployeeRole.has(key)) byEmployeeRole.set(key, entry);
    });
    return Array.from(byEmployeeRole.values()).sort((a, b) =>
      a.employee.localeCompare(b.employee) || (a.role || "").localeCompare(b.role || "")
    );
  }

  function preserveSelectValue(select, values, allLabel) {
    const previous = select.value;
    select.innerHTML = `<option value="">${allLabel}</option>`;
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    if (values.includes(previous)) select.value = previous;
  }

  function hydrateFilters() {
    const employeeOptions = uniqueSorted(state.rows.map((row) => row.employee));
    preserveSelectValue(
      els.employee,
      employeeOptions,
      "All Employees"
    );
    if (
      !state.defaultEmployeeApplied &&
      !els.employee.value &&
      employeeOptions.includes(state.currentUserName)
    ) {
      els.employee.value = state.currentUserName;
      state.defaultEmployeeApplied = true;
    }
    preserveSelectValue(
      els.location,
      uniqueSorted(state.rows.map((row) => row.location)),
      "All Locations"
    );
    state.filtersReady = true;
  }

  function selectedRange() {
    const start = parseRotaDate(els.startDate.value);
    const end = parseRotaDate(els.endDate.value);
    return {
      start,
      end: end && start && end < start ? start : end,
    };
  }

  function datesInRange(start, end) {
    if (!start || !end) return [];
    const dates = [];
    for (let d = localDate(start); d <= end; d = addDays(d, 1)) {
      dates.push(d);
      if (dates.length >= 62) break;
    }
    return dates;
  }

  function filteredRows() {
    const { start, end } = selectedRange();
    const employee = els.employee.value;
    const location = els.location.value;

    const dateLocationRows = state.rows.filter((row) => {
      if (!row.date) return false;
      if (start && row.date < start) return false;
      if (end && row.date > end) return false;
      if (location && row.location !== location) return false;
      return true;
    });

    if (!employee) return dateLocationRows;

    const matchingLocationDates = new Set(
      dateLocationRows
        .filter((row) => row.employee === employee)
        .map((row) => `${row.location}__${row.isoDate}`)
    );

    return dateLocationRows.filter((row) =>
      matchingLocationDates.has(`${row.location}__${row.isoDate}`)
    );
  }

  function phoneForLocation(locationName) {
    const location = state.locationsByName.get(normalizeLookupKey(locationName));
    return normalizeText(
      location?.location_phone_number ||
        location?.phone ||
        location?.telephone ||
        location?.tel
    );
  }

  function emailForLocation(locationName) {
    const location = state.locationsByName.get(normalizeLookupKey(locationName));
    return normalizeText(location?.location_email || location?.email);
  }

  function userForEmployee(employeeName) {
    return state.usersByName.get(normalizeLookupKey(employeeName)) || null;
  }

  async function fetchGoogleStatus() {
    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      const res = await fetch("/api/google/status", {
        cache: "no-store",
        headers: saved?.token ? { Authorization: `Bearer ${saved.token}` } : {},
      });
      const data = await res.json();
      state.googleConnected = Boolean(res.ok && data.ok && data.connected);
      return state.googleConnected;
    } catch (err) {
      console.warn("Failed to load Google connection status:", err);
      state.googleConnected = false;
      return false;
    }
  }

  async function connectGoogle() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    if (!saved?.token) {
      alert("Please sign in again before connecting Google.");
      return false;
    }

    const authUrl = `/api/google/auth?format=json&returnTo=${encodeURIComponent(window.location.pathname)}`;
    const res = await fetch(authUrl, {
      headers: { Authorization: `Bearer ${saved.token}` },
    });
    const data = await res.json();
    if (!res.ok || data.ok === false || !data.url) {
      alert(data.error || "Could not start Google connection.");
      return false;
    }

    return new Promise((resolve) => {
      const popup = window.open(
        data.url,
        "GoogleConnect",
        "width=520,height=720,resizable=yes,scrollbars=yes"
      );

      if (!popup) {
        alert("Please allow pop-ups to connect Google.");
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(false);
      }, 2 * 60 * 1000);

      function onMessage(event) {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== "google-auth-complete") return;
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        popup.close();
        fetchGoogleStatus().then(resolve);
      }

      window.addEventListener("message", onMessage);
    });
  }

  async function ensureGoogleConnected() {
    if (state.googleConnected) return true;

    const shouldConnect = confirm("Connect your Google account to start Meet calls from the rota?");
    if (!shouldConnect) return false;

    return connectGoogle();
  }

  async function startMeetCall(email, displayName) {
    email = normalizeText(email);
    if (!email) {
      alert(`No Google email is stored for ${displayName}.`);
      return;
    }

    const connected = await ensureGoogleConnected();
    if (!connected) return;

    const saved = typeof storageGet === "function" ? storageGet() : null;
    try {
      const res = await fetch("/api/google/meet-call", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
        },
        body: JSON.stringify({ email, name: displayName }),
      });
      const data = await res.json();

      if (!res.ok || data.ok === false) {
        if (data.code === "GOOGLE_NOT_CONNECTED" || data.code === "GOOGLE_RECONNECT_REQUIRED") {
          state.googleConnected = false;
        }
        alert(data.error || "Could not start the Google Meet call.");
        if (data.meetUrl) window.open(data.meetUrl, "GoogleMeetCall", "width=980,height=760,resizable=yes,scrollbars=yes");
        return;
      }

      const popup = window.open(
        data.meetUrl,
        "GoogleMeetCall",
        "width=980,height=760,resizable=yes,scrollbars=yes"
      );
      if (!popup) {
        alert("Please allow pop-ups to open Google Meet.");
      }
    } catch (err) {
      console.error("Could not start Google Meet call:", err);
      alert("Could not start the Google Meet call. Please try again.");
    }
  }

  async function startMeetCallForUser(user, employee) {
    return startMeetCall(user?.email, employee);
  }

  function createEmployeeChip(employee, role = "", options = {}) {
    const user = userForEmployee(employee);
    const chip = document.createElement("div");
    chip.className = "rota-chip";

    const avatar = document.createElement("span");
    avatar.className = "rota-avatar";
    const imageUrl = normalizeText(user?.profileImage);

    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        img.remove();
        avatar.classList.add("has-initials");
        avatar.textContent = initialsForName(employee);
      }, { once: true });
      avatar.appendChild(img);
    } else {
      avatar.classList.add("has-initials");
      avatar.textContent = initialsForName(employee);
    }

    const text = document.createElement("span");
    text.className = "rota-employee-text";

    const name = document.createElement("span");
    name.className = "rota-employee-name";
    name.textContent = employee;
    text.appendChild(name);

    if (role) {
      const roleEl = document.createElement("span");
      roleEl.className = "rota-employee-role";
      roleEl.textContent = role;
      text.appendChild(roleEl);
    }

    chip.appendChild(avatar);
    chip.appendChild(text);

    if (options.showCallButton && normalizeText(user?.email)) {
      const callButton = document.createElement("button");
      callButton.type = "button";
      callButton.className = "rota-call-btn";
      callButton.title = `Start Google Meet call with ${employee}`;
      callButton.setAttribute("aria-label", `Start Google Meet call with ${employee}`);
      callButton.textContent = "\u260E";
      callButton.addEventListener("click", (event) => {
        event.stopPropagation();
        startMeetCallForUser(user, employee);
      });
      chip.appendChild(callButton);
    }

    return chip;
  }

  function renderCalendar() {
    if (!state.filtersReady) return;

    const { start, end } = selectedRange();
    if (end && start && els.endDate.value !== toIsoDate(end)) {
      els.endDate.value = toIsoDate(end);
    }

    const dates = datesInRange(start, end);
    const rows = filteredRows();
    const locations = uniqueSorted(rows.map((row) => row.location));
    const byLocationDate = new Map();

    rows.forEach((row) => {
      const key = `${row.location}__${row.isoDate}`;
      const existing = byLocationDate.get(key) || [];
      existing.push(row);
      byLocationDate.set(key, existing);
    });

    els.calendar.innerHTML = "";
    els.empty.classList.toggle("hidden", rows.length > 0);

    if (!dates.length || !locations.length) {
      updateSummary(rows.length, start, end);
      return;
    }

    const grid = document.createElement("div");
    grid.className = "rota-grid";
    grid.style.setProperty("--rota-days", String(dates.length));

    const corner = document.createElement("div");
    corner.className = "rota-corner";
    corner.textContent = "Location";
    grid.appendChild(corner);

    dates.forEach((date) => {
      const header = document.createElement("div");
      header.className = "rota-day-header";
      header.innerHTML = `
        <div class="rota-day-name">${date.toLocaleDateString("en-GB", { weekday: "short" })}</div>
        <div class="rota-day-date">${formatHeaderDate(date)}</div>
      `;
      grid.appendChild(header);
    });

    const todayIso = toIsoDate(new Date());
    locations.forEach((location) => {
      const locationCell = document.createElement("div");
      locationCell.className = "rota-location";
      const phone = phoneForLocation(location);
      const locationEmail = emailForLocation(location);
      const locationName = document.createElement("div");
      locationName.className = "rota-location-name";
      locationName.textContent = location;
      locationCell.appendChild(locationName);

      if (phone) {
        const phoneLink = document.createElement("a");
        phoneLink.className = "rota-location-phone";
        phoneLink.href = `tel:${phone.replace(/[^+\d]/g, "")}`;
        phoneLink.textContent = phone;
        locationCell.appendChild(phoneLink);
      }

      if (locationEmail) {
        const storeCallButton = document.createElement("button");
        storeCallButton.type = "button";
        storeCallButton.className = "rota-location-call-btn";
        storeCallButton.title = `Start Google Meet call with ${location}`;
        storeCallButton.setAttribute("aria-label", `Start Google Meet call with ${location}`);
        storeCallButton.textContent = "\u260E";
        storeCallButton.addEventListener("click", (event) => {
          event.stopPropagation();
          startMeetCall(locationEmail, location);
        });
        locationCell.appendChild(storeCallButton);
      }
      grid.appendChild(locationCell);

      dates.forEach((date) => {
        const iso = toIsoDate(date);
        const cell = document.createElement("div");
        cell.className = `rota-cell${iso === todayIso ? " is-today" : ""}`;
        const rotaEntries = uniqueSortedRotaEntries(byLocationDate.get(`${location}__${iso}`) || []);
        rotaEntries.forEach((entry) => {
          cell.appendChild(createEmployeeChip(entry.employee, entry.role, { showCallButton: iso === todayIso }));
        });
        grid.appendChild(cell);
      });
    });

    els.calendar.appendChild(grid);
    updateSummary(rows.length, start, end);
  }

  function updateSummary(count, start, end) {
    const dateText = start && end
      ? `${formatSummaryDate(start)} to ${formatSummaryDate(end)}`
      : "selected range";
    const uniqueEmployees = uniqueSorted(filteredRows().map((row) => row.employee)).length;
    els.summary.textContent = `${count} rota entr${count === 1 ? "y" : "ies"} across ${uniqueEmployees} employee${uniqueEmployees === 1 ? "" : "s"} for ${dateText}.`;
  }

  async function fetchRota() {
    setLoading(true);
    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      const params = new URLSearchParams({
        startDate: els.startDate.value,
        endDate: els.endDate.value,
        refresh: "1",
        _: String(Date.now()),
      });
      if (els.employee.value) params.set("employee", els.employee.value);
      if (els.location.value) params.set("location", els.location.value);

      const res = await fetch(`/api/netsuite/breathe-rota?${params.toString()}`, {
        cache: "no-store",
        headers: saved?.token ? { Authorization: `Bearer ${saved.token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "Failed to load rota");

      const sourceRows = Array.isArray(data.results) ? data.results : Array.isArray(data.data) ? data.data : [];
      state.rows = sourceRows.map(normalizeRow).filter((row) => row.location && row.employee && row.date);
      hydrateFilters();
      renderCalendar();
    } catch (err) {
      console.error("Failed to load rota:", err);
      els.summary.textContent = "Could not load rota data.";
      els.calendar.innerHTML = "";
      els.empty.textContent = "Could not load rota data. Please refresh and try again.";
      els.empty.classList.remove("hidden");
    } finally {
      setLoading(false);
    }
  }

  async function fetchLocationMeta() {
    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      const res = await fetch("/api/meta/locations", {
        headers: saved?.token ? { Authorization: `Bearer ${saved.token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "Failed to load locations");

      state.locationsByName = new Map(
        (data.locations || [])
          .filter((location) => normalizeText(location.name))
          .map((location) => [normalizeLookupKey(location.name), location])
      );
    } catch (err) {
      console.warn("Failed to load location phone numbers:", err);
      state.locationsByName = new Map();
    }
  }

  async function fetchUserMeta() {
    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      const res = await fetch("/api/users", {
        headers: saved?.token ? { Authorization: `Bearer ${saved.token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "Failed to load users");

      state.usersByName = new Map(
        (data.users || [])
          .filter((user) => fullUserName(user))
          .map((user) => [normalizeLookupKey(fullUserName(user)), user])
      );
    } catch (err) {
      console.warn("Failed to load user profile pictures:", err);
      state.usersByName = new Map();
    }
  }

  async function fetchCurrentUser() {
    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      const res = await fetch("/api/me", {
        headers: saved?.token ? { Authorization: `Bearer ${saved.token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "Failed to load current user");

      state.currentUserName = fullUserName(data.user);
    } catch (err) {
      console.warn("Failed to set current user as rota default:", err);
      state.currentUserName = "";
    }
  }

  function shiftWeek(days) {
    const start = parseRotaDate(els.startDate.value) || startOfWeek(new Date());
    const nextStart = addDays(start, days);
    els.startDate.value = toIsoDate(nextStart);
    els.endDate.value = toIsoDate(addDays(nextStart, 6));
    renderCalendar();
  }

  [els.startDate, els.endDate, els.employee, els.location].forEach((input) => {
    input.addEventListener("change", renderCalendar);
  });
  els.refresh.addEventListener("click", fetchRota);
  els.previousWeek.addEventListener("click", () => shiftWeek(-7));
  els.nextWeek.addEventListener("click", () => shiftWeek(7));
  els.thisWeek.addEventListener("click", () => {
    setDefaultWeek();
    renderCalendar();
  });

  setDefaultWeek();
  Promise.all([fetchLocationMeta(), fetchUserMeta(), fetchCurrentUser(), fetchGoogleStatus()])
    .then(fetchRota)
    .then(renderCalendar);
});
