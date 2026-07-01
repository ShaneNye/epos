(function () {
  const state = {
    options: [],
    promise: null,
  };

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function countyRows(payload) {
    const rows = Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];

    return rows
      .map((row) => ({
        id: String(row.Id || row.id || row.ID || "").trim(),
        name: String(row["Full Name"] || row.fullName || row.name || row["Short Name"] || "").trim(),
      }))
      .filter((row) => row.id && row.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function loadCounties() {
    if (state.options.length) return state.options;
    if (state.promise) return state.promise;

    const saved = typeof storageGet === "function" ? storageGet() : null;
    state.promise = fetch("/api/netsuite/customer-counties", {
      cache: "no-store",
      headers: saved?.token ? { Authorization: `Bearer ${saved.token}` } : {},
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || "Failed to load counties");
        state.options = countyRows(data);
        return state.options;
      })
      .catch((err) => {
        console.error("County lookup failed:", err);
        state.options = [];
        return state.options;
      })
      .finally(() => {
        state.promise = null;
      });

    return state.promise;
  }

  function optionMatches(option, value) {
    const wanted = normalize(value);
    if (!wanted) return false;
    return normalize(option.id) === wanted || normalize(option.name) === wanted;
  }

  function selectedCountyName(select) {
    return select?.selectedOptions?.[0]?.dataset?.countyName || "";
  }

  function setSelectValue(select, value) {
    if (!select) return;
    const raw =
      value && typeof value === "object"
        ? String(value.id || value.value || value.refName || value.name || "").trim()
        : String(value || "").trim();
    if (!raw) {
      select.value = "";
      select.dataset.countyName = "";
      return;
    }

    const match = state.options.find((option) => optionMatches(option, raw));
    if (match) {
      select.value = match.id;
      select.dataset.countyName = match.name;
      return;
    }

    let fallback = select.querySelector('option[data-temp-county="1"]');
    if (!fallback) {
      fallback = document.createElement("option");
      fallback.dataset.tempCounty = "1";
      select.appendChild(fallback);
    }
    fallback.value = raw;
    fallback.textContent = raw;
    fallback.dataset.countyName = raw;
    select.value = raw;
    select.dataset.countyName = raw;
  }

  function populateSelect(select, currentValue) {
    const selected = currentValue ?? select.value ?? select.dataset.pendingCounty ?? "";
    const placeholder = select.dataset.placeholder || "Select County";
    select.innerHTML = "";

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);

    state.options.forEach((county) => {
      const option = document.createElement("option");
      option.value = county.id;
      option.textContent = county.name;
      option.dataset.countyName = county.name;
      select.appendChild(option);
    });

    setSelectValue(select, selected);
  }

  function makeCountySelect(field) {
    if (!field) return null;

    if (field.tagName === "SELECT") {
      field.classList.add("county-select");
      return field;
    }

    const select = document.createElement("select");
    [...field.attributes].forEach((attr) => {
      if (attr.name === "type" || attr.name === "value") return;
      select.setAttribute(attr.name, attr.value);
    });
    select.name = field.name || select.name || "county";
    select.className = `${field.className || ""} county-select`.trim();
    select.dataset.pendingCounty = field.value || field.getAttribute("value") || "";
    select.dataset.placeholder = field.placeholder || "Select County";
    field.replaceWith(select);
    return select;
  }

  function countyFields(root = document) {
    return [
      ...root.querySelectorAll('input[name="county"], select[name="county"], input[data-address-field="county"], select[data-address-field="county"]'),
    ];
  }

  async function enhance(root = document) {
    const selects = countyFields(root).map(makeCountySelect).filter(Boolean);
    if (!selects.length) return [];
    await loadCounties();
    selects.forEach((select) => {
      populateSelect(select, select.dataset.pendingCounty || select.value || "");
      select.addEventListener("change", () => {
        select.dataset.countyName = selectedCountyName(select);
      });
    });
    return selects;
  }

  async function setValue(target, value) {
    const field = typeof target === "string" ? document.querySelector(target) : target;
    const select = makeCountySelect(field);
    if (!select) return;
    select.dataset.pendingCounty = value || "";
    await loadCounties();
    populateSelect(select, value || "");
  }

  function getValue(target) {
    const field = typeof target === "string" ? document.querySelector(target) : target;
    return field?.value || "";
  }

  function getName(target) {
    const field = typeof target === "string" ? document.querySelector(target) : target;
    if (!field) return "";
    if (field.tagName === "SELECT") return selectedCountyName(field) || field.selectedOptions?.[0]?.textContent || "";
    return field.value || "";
  }

  window.EposCountySelect = {
    enhance,
    getName,
    getValue,
    load: loadCounties,
    setValue,
  };

  document.addEventListener("DOMContentLoaded", () => {
    enhance(document);
  });
})();
