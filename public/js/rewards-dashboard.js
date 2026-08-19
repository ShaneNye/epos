(() => {
  const state = { data: null, userName: "", isHrManager: false, query: "", expandedName: "", activeTab: "sales", expandedOrders: new Set() };
  const excludedLeaderboardNames = new Set(["internet user", "drew hopkins", "katrina colebourne"]);
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const byId = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function namesMatch(name) {
    return state.userName && name.trim().toLowerCase() === state.userName.trim().toLowerCase();
  }

  function adjustmentClass(value) {
    return value > 0 ? "adjustment-positive" : value < 0 ? "adjustment-negative" : "adjustment-zero";
  }

  function formatNetSuiteDate(value) {
    const text = String(value || "").trim();
    const ukDate = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s.*)?$/);
    const parsed = ukDate ? new Date(Date.UTC(Number(ukDate[3]), Number(ukDate[2]) - 1, Number(ukDate[1]))) : new Date(text);
    return Number.isNaN(parsed.getTime()) ? "—" : date.format(parsed);
  }

  function renderTransactions(name, type) {
    const isAdjustment = type === "adjustments";
    const sourceRows = isAdjustment ? state.data.adjustmentRows : state.data.rows;
    const orders = new Map();
    sourceRows.filter((row) => row.bedSpecialist === name).forEach((row) => {
      const key = row.transaction || "No order number";
      if (!orders.has(key)) orders.set(key, []);
      orders.get(key).push(row);
    });

    return [...orders.entries()].map(([orderNumber, lines]) => {
      const orderTotal = lines.reduce((total, line) => total + line.amountIncTax, 0);
      const first = lines[0];
      const orderKey = `${type}\u0000${name}\u0000${orderNumber}`;
      const expanded = state.expandedOrders.has(orderKey);
      const closeDate = isAdjustment && first.closeDate ? ` · Closed ${formatNetSuiteDate(first.closeDate)}` : "";
      const displayedOrderAdjustment = -orderTotal * state.data.commissionRate;
      return `<section class="sales-order-group">
        <button type="button" class="sales-order-heading ${expanded ? "is-open" : ""}" data-expand-order="${encodeURIComponent(orderNumber)}" data-specialist="${encodeURIComponent(name)}" aria-expanded="${expanded}">
          <span class="sale-chevron" aria-hidden="true">›</span>
          <span class="sale-identity"><strong>${escapeHtml(orderNumber)}</strong><small>${formatNetSuiteDate(first.date)}${first.subsidiary ? ` · ${escapeHtml(first.subsidiary)}` : ""}${closeDate}</small></span>
          <span class="sale-total"><small>Total amount</small><strong>${money.format(orderTotal)}</strong></span>
          <span class="sale-total ${isAdjustment ? `adjustment-total ${adjustmentClass(displayedOrderAdjustment)}` : "reward-total"}"><small>${isAdjustment ? "Adjustment" : "Total reward"}</small><strong>${money.format(isAdjustment ? displayedOrderAdjustment : orderTotal * state.data.commissionRate)}</strong></span>
        </button>
        ${expanded ? `<div class="nested-table-scroll"><table class="sales-lines-table">
          <thead><tr><th>Item sold</th>${isAdjustment ? "<th>Reason</th>" : ""}<th>Amount inc. tax</th><th>${isAdjustment ? "Adjustment" : "Reward"}</th></tr></thead>
          <tbody>${lines.map((line) => { const displayedAdjustment = -line.adjustment; return `<tr><td>${escapeHtml(line.item) || "—"}</td>${isAdjustment ? `<td>${escapeHtml(line.reason) || "—"}</td>` : ""}<td>${money.format(line.amountIncTax)}</td><td class="${isAdjustment ? `adjustment-cell ${adjustmentClass(displayedAdjustment)}` : "reward-cell"}">${money.format(isAdjustment ? displayedAdjustment : line.reward)}</td></tr>`; }).join("")}</tbody>
        </table></div>` : ""}
      </section>`;
    }).join("") || `<p class="empty">No ${type} found for this specialist.</p>`;
  }

  function renderExpandedPanel(name) {
    const encodedName = encodeURIComponent(name);
    return `<tr class="expanded-detail-row"><td colspan="${state.isHrManager ? 8 : 7}"><div class="expanded-panel">
      <div class="detail-tabs" role="tablist" aria-label="${escapeHtml(name)} reward details">
        <button type="button" class="detail-tab ${state.activeTab === "sales" ? "active" : ""}" data-reward-tab="sales" data-name="${encodedName}">Sales</button>
        <button type="button" class="detail-tab ${state.activeTab === "adjustments" ? "active" : ""}" data-reward-tab="adjustments" data-name="${encodedName}">Adjustments</button>
      </div>
      <div class="detail-tab-content">${renderTransactions(name, state.activeTab)}</div>
    </div></td></tr>`;
  }

  function render() {
    const { summary, lastUpdated, capped } = state.data;
    const people = [...summary.leaderboard]
      .filter((person) => !excludedLeaderboardNames.has(person.name.trim().toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }))
      .filter((person) => person.name.toLowerCase().includes(state.query));
    byId("leaderboardBody").innerHTML = people.length ? people.map((person) => {
      const expanded = state.expandedName === person.name;
      const encodedName = encodeURIComponent(person.name);
      const leaveControls = state.isHrManager ? `<td class="annual-leave-quantity"><button type="button" data-leave-delta="-1" data-leave-name="${encodedName}" aria-label="Remove one annual leave day for ${escapeHtml(person.name)}">−</button><strong>${person.annualLeaveQuantity || 0}</strong><button type="button" data-leave-delta="1" data-leave-name="${encodedName}" aria-label="Add one annual leave day for ${escapeHtml(person.name)}">+</button></td>` : "";
      const row = `<tr class="reward-summary-row ${namesMatch(person.name) ? "is-current-user" : ""} ${expanded ? "is-expanded" : ""}" data-expand-name="${encodedName}" tabindex="0" aria-expanded="${expanded}">
        <td><span class="expand-chevron" aria-hidden="true">›</span></td>
        <td><strong>${escapeHtml(person.name)}</strong>${namesMatch(person.name) ? '<span class="you-badge">You</span>' : ""}</td>
        <td class="reward-cell">${money.format(person.reward)}</td><td class="adjustment-cell ${adjustmentClass(-person.adjustment)}">${money.format(-person.adjustment)}</td><td class="manager-reward-cell">${money.format(person.managerReward || 0)}</td>${leaveControls}<td class="annual-leave-reward-cell">${money.format(person.annualLeaveReward || 0)}</td><td class="total-reward-cell">${money.format(person.totalReward)}</td>
      </tr>`;
      return row + (expanded ? renderExpandedPanel(person.name) : "");
    }).join("") : `<tr><td colspan="${state.isHrManager ? 8 : 7}" class="empty">No specialists match your search.</td></tr>`;
    byId("rewardsStatus").textContent = `${capped ? "Results capped · " : ""}Updated ${new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }

  async function load() {
    const button = byId("refreshRewards");
    button.disabled = true;
    byId("rewardsStatus").classList.remove("error");
    byId("rewardsStatus").textContent = "Loading live rewards from NetSuite…";
    try {
      const [rewardsResponse, meResponse] = await Promise.all([fetch("/api/rewards"), fetch("/api/me")]);
      const rewards = await rewardsResponse.json();
      if (rewardsResponse.status === 403) return window.location.replace("/home");
      if (!rewardsResponse.ok || !rewards.ok) throw new Error(rewards.error || "Could not load rewards");
      if (meResponse.ok) {
        const me = await meResponse.json();
        state.userName = `${me.user?.firstName || ""} ${me.user?.lastName || ""}`.trim();
        state.isHrManager = String(me.activeRole || "").trim().toLowerCase() === "hr manager";
      }
      state.data = rewards;
      state.isHrManager = state.isHrManager || rewards.canEditAnnualLeave === true;
      byId("annualLeaveDaysHeader").hidden = !state.isHrManager;
      render();
    } catch (error) {
      byId("rewardsStatus").textContent = error.message;
      byId("rewardsStatus").classList.add("error");
    } finally { button.disabled = false; }
  }

  byId("refreshRewards").addEventListener("click", load);
  byId("specialistSearch").addEventListener("input", (event) => { state.query = event.target.value.trim().toLowerCase(); if (state.data) render(); });
  byId("leaderboardBody").addEventListener("click", (event) => {
    const leaveButton = event.target.closest("[data-leave-delta]");
    if (leaveButton) {
      event.stopPropagation();
      const person = state.data.summary.leaderboard.find((entry) => entry.name === decodeURIComponent(leaveButton.dataset.leaveName));
      if (!person) return;
      leaveButton.disabled = true;
      fetch(`/api/rewards/annual-leave/${person.userId || "by-name"}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: Number(leaveButton.dataset.leaveDelta), name: person.name }),
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not update annual leave");
        const previousReward = person.annualLeaveReward || 0;
        person.userId = result.userId;
        person.annualLeaveQuantity = result.quantity;
        const totalDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const workedDays = totalDays - result.quantity;
        person.annualLeaveReward = result.quantity > 0 && workedDays > 0
          ? Math.round((((person.reward / workedDays) * totalDays) - person.reward + Number.EPSILON) * 100) / 100
          : 0;
        person.totalReward = Math.round((person.totalReward - previousReward + person.annualLeaveReward + Number.EPSILON) * 100) / 100;
        render();
      }).catch((error) => {
        byId("rewardsStatus").textContent = error.message;
        byId("rewardsStatus").classList.add("error");
        leaveButton.disabled = false;
      });
      return;
    }
    const orderToggle = event.target.closest("[data-expand-order]");
    if (orderToggle) {
      const specialist = decodeURIComponent(orderToggle.dataset.specialist);
      const orderNumber = decodeURIComponent(orderToggle.dataset.expandOrder);
      const key = `${state.activeTab}\u0000${specialist}\u0000${orderNumber}`;
      if (state.expandedOrders.has(key)) state.expandedOrders.delete(key); else state.expandedOrders.add(key);
      return render();
    }
    const tab = event.target.closest("[data-reward-tab]");
    if (tab) { state.expandedName = decodeURIComponent(tab.dataset.name); state.activeTab = tab.dataset.rewardTab; return render(); }
    const row = event.target.closest("[data-expand-name]");
    if (!row) return;
    const name = decodeURIComponent(row.dataset.expandName);
    state.expandedName = state.expandedName === name ? "" : name;
    state.activeTab = "sales";
    render();
  });
  byId("leaderboardBody").addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-expand-name]") || !["Enter", " "].includes(event.key)) return;
    event.preventDefault(); event.target.click();
  });
  load();
})();
