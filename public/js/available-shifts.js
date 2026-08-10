document.addEventListener("DOMContentLoaded", () => {
  const state = {
    shifts: [], currentUserId: null, rotaRows: [], locations: new Map(), rotaLoaded: false,
    rotaError: "", activeTabs: new Map(), editingShiftId: null, openMenuId: null,
  };
  const els = {
    list: document.getElementById("shiftList"), loading: document.getElementById("shiftLoading"),
    empty: document.getElementById("shiftEmpty"), notice: document.getElementById("shiftNotice"),
    modal: document.getElementById("shiftModal"), form: document.getElementById("shiftForm"),
    location: document.getElementById("shiftLocation"), date: document.getElementById("shiftDate"),
    notes: document.getElementById("shiftNotes"), save: document.getElementById("saveShiftBtn"),
    modalTitle: document.getElementById("shiftModalTitle"),
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
  const normalize = (value) => String(value || "").trim().toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ");
  const userName = (response) => escapeHtml(response.userName || "Unknown user");
  const formatDate = (date) => new Intl.DateTimeFormat("en-GB", { weekday:"short", day:"numeric", month:"long", year:"numeric", timeZone:"UTC" }).format(new Date(`${date}T00:00:00Z`));

  function isoRotaDate(value) {
    const raw = String(value || "").trim();
    let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return `${match[3]}-${String(match[2]).padStart(2,"0")}-${String(match[1]).padStart(2,"0")}`;
    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return match ? `${match[1]}-${String(match[2]).padStart(2,"0")}-${String(match[3]).padStart(2,"0")}` : "";
  }

  function normalizeRotaRow(row) {
    return {
      location: String(row.Location || row.location || "").trim(),
      employee: String(row.Employee || row.employee || "").trim(),
      role: String(row.Role || row.role || row.employeeRole || row["Employee Role"] || "").trim(),
      date: isoRotaDate(row.Date || row.date || row.rotaDate || row["Rota Date"]),
    };
  }

  function showNotice(message, error = false) {
    els.notice.textContent = message;
    els.notice.classList.toggle("error", error);
    els.notice.classList.remove("hidden");
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => els.notice.classList.add("hidden"), 4500);
  }

  function responderList(items, emptyText) {
    if (!items.length) return `<p class="tab-empty">${emptyText}</p>`;
    return `<div class="responder-list">${items.map(item => `<span>${userName(item)}</span>`).join("")}</div>`;
  }

  function onShiftContent(shift) {
    if (!state.rotaLoaded && !state.rotaError) return '<p class="tab-empty">Loading the rota...</p>';
    if (state.rotaError) return `<p class="tab-empty">${escapeHtml(state.rotaError)}</p>`;
    const matching = state.rotaRows.filter(row => row.date === shift.shift_date && normalize(row.location) === normalize(shift.location_name));
    if (!matching.length) return '<p class="tab-empty">No one else is shown on the rota at this location on this day.</p>';
    return `<div class="on-shift-list">${matching.map(row => `<div><span class="person-avatar">${escapeHtml(row.employee.split(/\s+/).map(x => x[0]).slice(0,2).join("") || "?")}</span><span><strong>${escapeHtml(row.employee)}</strong>${row.role ? `<small>${escapeHtml(row.role)}</small>` : ""}</span></div>`).join("")}</div>`;
  }

  function locationContent(shift) {
    const location = state.locations.get(String(shift.location_id));
    if (!location) return '<p class="tab-empty">Location details are not available.</p>';
    const addressParts = [location.address_line_1, location.address_line_2, location.postcode]
      .map(value => String(value || "").trim()).filter(Boolean);
    const mapQuery = [location.name, ...addressParts].filter(Boolean).join(", ");
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
    const embedUrl = `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`;
    const phone = String(location.location_phone_number || "").trim();
    const phoneHref = phone.replace(/[^+\d]/g, "");
    return `<div class="location-layout">
      <div class="location-map"><iframe src="${embedUrl}" title="Map of ${escapeHtml(location.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>
      <div class="location-details"><span class="location-label">Location</span><h3>${escapeHtml(location.name)}</h3>
        <address>${addressParts.length ? addressParts.map(escapeHtml).join("<br>") : "Address not recorded"}</address>
        ${phone ? `<a class="location-phone" href="tel:${escapeHtml(phoneHref)}">${escapeHtml(phone)}</a>` : '<span class="location-missing">Phone number not recorded</span>'}
        <a class="navigate-btn" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Navigate in Google Maps</a>
      </div>
    </div>`;
  }

  function render() {
    els.loading.classList.add("hidden");
    els.empty.classList.toggle("hidden", state.shifts.length > 0);
    els.list.innerHTML = state.shifts.map((shift) => {
      const responses = Array.isArray(shift.responses) ? shift.responses : [];
      const available = responses.filter(r => r.response === "available");
      const unavailable = responses.filter(r => r.response === "unavailable");
      const isCreator = Number(shift.created_by) === Number(state.currentUserId);
      const activeTab = state.activeTabs.get(String(shift.id)) || "";
      const needsResponse = !shift.assigned_user_id && !shift.my_response;
      const options = available.map(r => `<option value="${Number(r.userId)}" ${Number(r.userId) === Number(shift.assigned_user_id) ? "selected" : ""}>${userName(r)}</option>`).join("");
      const actions = shift.can_manage ? `<div class="shift-actions">
        <button type="button" class="shift-menu-trigger" data-shift-menu="${shift.id}" aria-label="Actions for ${escapeHtml(shift.location_name)} shift" aria-haspopup="menu" aria-expanded="${state.openMenuId === String(shift.id)}">&#8942;</button>
        <div class="shift-menu ${state.openMenuId === String(shift.id) ? "open" : ""}" role="menu">
          <button type="button" data-edit-shift="${shift.id}" role="menuitem" ${shift.assigned_user_id ? 'disabled title="Assigned shifts cannot be edited"' : ""}>Edit</button>
          <button type="button" class="danger" data-delete-shift="${shift.id}" role="menuitem">Delete</button>
        </div>
      </div>` : "";
      const panel = (name, html) => `<section id="shift-${shift.id}-${name}-panel" class="shift-tab-panel ${activeTab === name ? "active" : ""}" data-panel="${name}" role="tabpanel" aria-labelledby="shift-${shift.id}-${name}-tab" ${activeTab === name ? "" : "hidden"}>${html}</section>`;
      return `<article class="shift-card ${shift.assigned_user_id ? "assigned" : ""}" data-shift-card="${shift.id}">
        <div class="shift-card-top"><div><h2 class="shift-date">${formatDate(shift.shift_date)}</h2><p class="shift-location"><span aria-hidden="true">&#9679;</span> ${escapeHtml(shift.location_name)}</p></div>
        <div class="shift-card-controls">${needsResponse ? '<span class="response-needed-icon" title="Your response is needed" aria-label="Your response is needed">!</span>' : ""}<span class="shift-badge ${shift.assigned_user_id ? "covered" : ""}">${shift.assigned_user_id ? "Covered" : "Needs cover"}</span>${actions}</div></div>
        <nav class="shift-tabs" aria-label="Shift details" role="tablist">
          ${[["overview","Overview"],["on-shift","On shift"],["notes","Notes"],["assign","Assign"],["location","Location"]].map(([key,label]) => `<button type="button" id="shift-${shift.id}-${key}-tab" class="shift-tab ${activeTab === key ? "active" : ""}" data-tab="${key}" data-shift-id="${shift.id}" role="tab" aria-controls="shift-${shift.id}-${key}-panel" aria-selected="${activeTab === key}">${label}</button>`).join("")}
        </nav>
        <div class="response-actions shift-primary-actions"><button class="response-btn available ${shift.my_response === "available" ? "active" : ""}" data-response="available" data-id="${shift.id}">Available</button><button class="response-btn unavailable ${shift.my_response === "unavailable" ? "active" : ""}" data-response="unavailable" data-id="${shift.id}">Unavailable</button></div>
        <div class="shift-tab-content ${activeTab ? "expanded" : ""}">
          ${panel("overview", `
            <div class="response-columns"><div><strong>${available.length} available</strong>${responderList(available,"No available responses")}</div><div><strong>${unavailable.length} unavailable</strong>${responderList(unavailable,"No unavailable responses")}</div></div>
            ${shift.assigned_user_id ? `<div class="status-notices"><div class="assigned-person">Assigned to ${escapeHtml(shift.assigned_user_name)}</div><label class="rota-check"><input type="checkbox" data-rota-updated="${shift.id}" ${shift.rota_updated_at ? "checked" : ""}><span><strong>Added to rota</strong><small>${shift.rota_updated_at ? "Rota update confirmed" : "Currently awaiting rota update"}</small></span></label></div>` : '<div class="rota-status pending">Awaiting assignment</div>'}
            <div class="shift-meta">Added by ${escapeHtml(shift.created_by_name)}</div>`)}
          ${panel("on-shift", onShiftContent(shift))}
          ${panel("notes", `<label class="record-notes-label">Shift notes<textarea class="record-notes" rows="5" readonly>${escapeHtml(shift.notes || "No additional notes were added.")}</textarea></label>`)}
          ${panel("assign", `${isCreator ? `<div class="assignment"><label>Assign this shift<select data-assign="${shift.id}"><option value="">Not assigned</option>${options}</select></label>${available.length ? '<p class="response-summary">Only users who selected Available can be assigned.</p>' : '<p class="tab-empty">No one has marked themselves available yet.</p>'}</div>` : `<p class="tab-empty">Only ${escapeHtml(shift.created_by_name)}, who created this shift, can assign it.</p>${shift.assigned_user_id ? `<div class="assigned-person">Currently assigned to ${escapeHtml(shift.assigned_user_name)}</div>` : ""}`}`)}
          ${panel("location", locationContent(shift))}
        </div>
      </article>`;
    }).join("");
  }

  async function loadShifts() {
    const res = await fetch("/api/available-shifts");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load shifts");
    state.shifts = data.shifts || [];
    state.currentUserId = data.currentUserId;
    const menuDot = document.getElementById("availableShiftsNotificationDot");
    const menuItem = document.getElementById("availableShiftsMenuItem");
    const hasOutstandingResponse = state.shifts.some(shift => !shift.assigned_user_id && !shift.my_response);
    if (menuDot) menuDot.classList.toggle("hidden", !hasOutstandingResponse);
    if (menuItem) menuItem.setAttribute("aria-label", hasOutstandingResponse ? "Available Shifts, response needed" : "Available Shifts");
    render();
  }

  async function loadRota() {
    if (!state.shifts.length) { state.rotaLoaded = true; render(); return; }
    const dates = state.shifts.map(shift => shift.shift_date).sort();
    const params = new URLSearchParams({ startDate:dates[0], endDate:dates[dates.length - 1], _:String(Date.now()) });
    try {
      const res = await fetch(`/api/netsuite/breathe-rota?${params.toString()}`, { cache:"no-store" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "Rota unavailable");
      const rows = Array.isArray(data.results) ? data.results : Array.isArray(data.data) ? data.data : [];
      state.rotaRows = rows.map(normalizeRotaRow).filter(row => row.location && row.employee && row.date);
      state.rotaLoaded = true;
    } catch (err) {
      state.rotaError = "The current rota could not be loaded. Please try again later.";
    }
    render();
  }

  async function loadLocations() {
    const res = await fetch("/api/meta/locations"); const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load locations");
    const locations = data.locations || [];
    state.locations = new Map(locations.map(location => [String(location.id), location]));
    els.location.innerHTML = '<option value="">Select a location</option>' + locations.map(l => `<option value="${Number(l.id)}">${escapeHtml(l.name)}</option>`).join("");
    if (state.shifts.length) render();
  }

  function openModal(shift = null) { els.form.reset(); state.editingShiftId = shift ? Number(shift.id) : null; els.modalTitle.textContent = shift ? "Edit available shift" : "Add an available shift"; els.save.textContent = shift ? "Save changes" : "Add shift"; if (shift) { els.location.value=String(shift.location_id); els.date.value=shift.shift_date; els.notes.value=shift.notes || ""; } else { const today = new Date(); els.date.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`; } els.modal.classList.remove("hidden"); document.body.classList.add("modal-open"); els.location.focus(); }
  function closeModal() { els.modal.classList.add("hidden"); document.body.classList.remove("modal-open"); state.editingShiftId=null; }
  document.getElementById("addShiftBtn").addEventListener("click", () => openModal());
  document.getElementById("closeShiftModal").addEventListener("click", closeModal);
  document.getElementById("cancelShiftModal").addEventListener("click", closeModal);
  els.modal.addEventListener("click", e => { if (e.target === els.modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  els.form.addEventListener("submit", async (e) => { e.preventDefault(); const editingId=state.editingShiftId; els.save.disabled=true; els.save.textContent=editingId?"Saving...":"Adding..."; try { const res=await fetch(editingId?`/api/available-shifts/${editingId}`:"/api/available-shifts",{method:editingId?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locationId:els.location.value,date:els.date.value,notes:els.notes.value})}); const data=await res.json(); if(!res.ok) throw new Error(data.error||(editingId?"Could not update shift":"Could not add shift")); closeModal(); state.rotaLoaded=false; await loadShifts(); await loadRota(); showNotice(editingId?"Shift updated successfully.":"Shift added successfully."); } catch(err){showNotice(err.message,true);} finally{els.save.disabled=false;els.save.textContent=state.editingShiftId?"Save changes":"Add shift";} });

  els.list.addEventListener("click", async (e) => {
    const menuButton=e.target.closest("[data-shift-menu]"); if(menuButton){const id=menuButton.dataset.shiftMenu;state.openMenuId=state.openMenuId===id?null:id;render();return;}
    const editButton=e.target.closest("[data-edit-shift]"); if(editButton){const shift=state.shifts.find(item=>Number(item.id)===Number(editButton.dataset.editShift));state.openMenuId=null;if(shift&&!shift.assigned_user_id)openModal(shift);return;}
    const tab=e.target.closest("[data-tab]"); if(tab){ state.activeTabs.set(tab.dataset.shiftId,tab.dataset.tab); render(); return; }
    const deleteButton=e.target.closest("[data-delete-shift]"); if(deleteButton){const confirmed=window.confirm("Delete this available shift? This will also remove every response and cannot be undone.");if(!confirmed)return;deleteButton.disabled=true;try{const res=await fetch(`/api/available-shifts/${deleteButton.dataset.deleteShift}`,{method:"DELETE"});const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not delete shift");state.activeTabs.delete(String(deleteButton.dataset.deleteShift));state.openMenuId=null;await loadShifts();showNotice("Shift deleted.");}catch(err){deleteButton.disabled=false;showNotice(err.message,true);}return;}
    const button=e.target.closest("[data-response]"); if(!button)return; button.disabled=true;
    try{const res=await fetch(`/api/available-shifts/${button.dataset.id}/response`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({response:button.dataset.response})});const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not save response");await loadShifts();showNotice(`You are marked as ${button.dataset.response}.`);}catch(err){button.disabled=false;showNotice(err.message,true);}
  });

  document.addEventListener("click", (e) => { if(state.openMenuId && !e.target.closest(".shift-actions")){state.openMenuId=null;render();} });

  els.list.addEventListener("change", async (e) => {
    const checkbox=e.target.closest("[data-rota-updated]"); if(checkbox){checkbox.disabled=true;try{const res=await fetch(`/api/available-shifts/${checkbox.dataset.rotaUpdated}/rota-updated`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({updated:checkbox.checked})});const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not update rota status");await loadShifts();showNotice(checkbox.checked?"Shift marked as added to the rota.":"Rota confirmation removed.");}catch(err){await loadShifts();showNotice(err.message,true);}return;}
    const select=e.target.closest("[data-assign]");if(!select)return;select.disabled=true;try{const res=await fetch(`/api/available-shifts/${select.dataset.assign}/assign`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:select.value||null})});const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not assign shift");await loadShifts();showNotice(select.value?"Shift assigned successfully.":"Assignment removed.");}catch(err){await loadShifts();showNotice(err.message,true);}
  });

  (async()=>{try{await Promise.all([loadLocations(),loadShifts()]);await loadRota();}catch(err){els.loading.classList.add("hidden");showNotice(err.message,true);}})();
});
