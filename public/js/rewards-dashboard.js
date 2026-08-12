(() => {
  const state = { data: null, userName: "", query: "", expandedName: "", activeTab: "sales", expandedOrders: new Set() };
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const byId = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function namesMatch(name) {
    return state.userName && name.trim().toLowerCase() === state.userName.trim().toLowerCase();
  }

  function formatNetSuiteDate(value) {
    const text = String(value || "").trim();
    const ukDate = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s.*)?$/);
    const parsed = ukDate
      ? new Date(Date.UTC(Number(ukDate[3]), Number(ukDate[2]) - 1, Number(ukDate[1])))
      : new Date(text);
    return Number.isNaN(parsed.getTime()) ? "—" : date.format(parsed);
  }

  function renderSales(name) {
    const orders = new Map();
    state.data.rows.filter((row) => row.bedSpecialist === name).forEach((row) => {
      const key = row.transaction || "No order number";
      if (!orders.has(key)) orders.set(key, []);
      orders.get(key).push(row);
    });

    return [...orders.entries()].map(([orderNumber, lines]) => {
      const orderTotal = lines.reduce((total, line) => total + line.amountIncTax, 0);
      const first = lines[0];
      const orderKey = `${name}\u0000${orderNumber}`;
      const expanded = state.expandedOrders.has(orderKey);
      return `<section class="sales-order-group">
        <button type="button" class="sales-order-heading ${expanded ? "is-open" : ""}" data-expand-order="${encodeURIComponent(orderNumber)}" data-specialist="${encodeURIComponent(name)}" aria-expanded="${expanded}">
          <span class="sale-chevron" aria-hidden="true">›</span>
          <span class="sale-identity"><strong>${escapeHtml(orderNumber)}</strong><small>${formatNetSuiteDate(first.date)}${first.subsidiary ? ` · ${escapeHtml(first.subsidiary)}` : ""}</small></span>
          <span class="sale-total"><small>Total amount</small><strong>${money.format(orderTotal)}</strong></span>
          <span class="sale-total reward-total"><small>Total reward</small><strong>${money.format(orderTotal * state.data.commissionRate)}</strong></span>
        </button>
        ${expanded ? `<div class="nested-table-scroll"><table class="sales-lines-table">
          <thead><tr><th>Item sold</th><th>Amount inc. tax</th><th>Reward</th></tr></thead>
          <tbody>${lines.map((line) => `<tr><td>${escapeHtml(line.item) || "—"}</td><td>${money.format(line.amountIncTax)}</td><td class="reward-cell">${money.format(line.reward)}</td></tr>`).join("")}</tbody>
        </table></div>` : ""}
      </section>`;
    }).join("") || '<p class="empty">No sales found for this specialist.</p>';
  }

  function renderExpandedPanel(name) {
    const encodedName = encodeURIComponent(name);
    const content = state.activeTab === "sales"
      ? renderSales(name)
      : '<div class="adjustments-empty"><strong>No adjustments yet</strong><p>Adjustments will be added here in a future update.</p></div>';
    return `<tr class="expanded-detail-row"><td colspan="5"><div class="expanded-panel">
      <div class="detail-tabs" role="tablist" aria-label="${escapeHtml(name)} reward details">
        <button type="button" class="detail-tab ${state.activeTab === "sales" ? "active" : ""}" data-reward-tab="sales" data-name="${encodedName}">Sales</button>
        <button type="button" class="detail-tab ${state.activeTab === "adjustments" ? "active" : ""}" data-reward-tab="adjustments" data-name="${encodedName}">Adjustments</button>
      </div>
      <div class="detail-tab-content">${content}</div>
    </div></td></tr>`;
  }

  function render() {
    const { summary, lastUpdated, capped } = state.data;
    const people = [...summary.leaderboard]
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }))
      .filter((person) => person.name.toLowerCase().includes(state.query));

    byId("leaderboardBody").innerHTML = people.length ? people.map((person) => {
      const expanded = state.expandedName === person.name;
      const encodedName = encodeURIComponent(person.name);
      const row = `<tr class="reward-summary-row ${namesMatch(person.name) ? "is-current-user" : ""} ${expanded ? "is-expanded" : ""}" data-expand-name="${encodedName}" tabindex="0" aria-expanded="${expanded}">
        <td><span class="expand-chevron" aria-hidden="true">›</span></td>
        <td><strong>${escapeHtml(person.name)}</strong>${namesMatch(person.name) ? '<span class="you-badge">You</span>' : ""}</td>
        <td>${person.orderCount}</td><td>${money.format(person.sales)}</td><td class="reward-cell">${money.format(person.reward)}</td>
      </tr>`;
      return row + (expanded ? renderExpandedPanel(person.name) : "");
    }).join("") : '<tr><td colspan="5" class="empty">No specialists match your search.</td></tr>';

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
      }
      state.data = rewards;
      render();
    } catch (error) {
      byId("rewardsStatus").textContent = error.message;
      byId("rewardsStatus").classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  byId("refreshRewards").addEventListener("click", load);
  byId("specialistSearch").addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    if (state.data) render();
  });
  byId("leaderboardBody").addEventListener("click", (event) => {
    const orderToggle = event.target.closest("[data-expand-order]");
    if (orderToggle) {
      const specialist = decodeURIComponent(orderToggle.dataset.specialist);
      const orderNumber = decodeURIComponent(orderToggle.dataset.expandOrder);
      const key = `${specialist}\u0000${orderNumber}`;
      if (state.expandedOrders.has(key)) state.expandedOrders.delete(key);
      else state.expandedOrders.add(key);
      return render();
    }
    const tab = event.target.closest("[data-reward-tab]");
    if (tab) {
      state.expandedName = decodeURIComponent(tab.dataset.name);
      state.activeTab = tab.dataset.rewardTab;
      return render();
    }
    const row = event.target.closest("[data-expand-name]");
    if (!row) return;
    const name = decodeURIComponent(row.dataset.expandName);
    state.expandedName = state.expandedName === name ? "" : name;
    state.activeTab = "sales";
    render();
  });
  byId("leaderboardBody").addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-expand-name]") || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.target.click();
  });
  load();
})();
