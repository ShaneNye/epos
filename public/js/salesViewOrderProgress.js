(function initialiseSalesViewOrderProgress(global) {
  "use strict";

  const LABELS = {
    deposit: ["Customer deposit received", "Awaiting a customer deposit"],
    committed: ["Order committed", "Order awaiting commitment"],
    intercompany: ["Paired sales order created", "Intercompany not processed"],
    ready: ["All goods booked in", "Waiting for all goods to be booked in"],
    dispatch: ["Exported to DispatchTrack", "Awaiting export to DispatchTrack"],
    billed: ["Order Delivered", "Sales Order Pending Delivery"],
  };

  function text(value) {
    if (value && typeof value === "object") {
      return String(value.refName || value.name || value.text || value.id || "").trim();
    }
    return String(value || "").trim();
  }

  function statusParts(order) {
    const status = order?.orderStatus || order?.orderstatus || order?.status || {};
    const rawId = typeof status === "object" ? status.id : status;
    return {
      id: text(rawId).split(":").pop().toUpperCase(),
      name: (text(typeof status === "object" ? status : "") || text(order?.statusRefName)).toLowerCase(),
    };
  }

  function hasCustomerDeposit(deposits) {
    return (Array.isArray(deposits) ? deposits : []).some((deposit) => {
      const type = text(deposit?.type || deposit?.Type).toLowerCase();
      return (Number(deposit?.amount ?? deposit?.Amount) || 0) > 0 && !type.includes("refund");
    });
  }

  function hasReference(value) {
    return Array.isArray(value) ? value.some(hasReference) : Boolean(text(value));
  }

  function isChecked(value) {
    if (value === true) return true;
    if (value === false || value == null) return false;
    if (typeof value === "object") {
      return isChecked(value.id ?? value.value ?? value.refName ?? value.text);
    }
    return ["t", "true", "yes", "1"].includes(text(value).toLowerCase());
  }

  function orderLines(order) {
    return Array.isArray(order?.item?.items)
      ? order.item.items
      : (Array.isArray(order?.items) ? order.items : []);
  }

  function requiresDispatchTrack(order) {
    return orderLines(order).some((line) => {
      const method = text(
        line?.custcol_sb_fulfilmentlocation || line?.fulfilmentMethod || line?.fulfillmentMethod
      ).toLowerCase();
      return method.includes("special order") || method.includes("warehouse");
    });
  }

  function isBilled(order) {
    const status = statusParts(order);
    return status.id === "G" || status.name.includes("billed");
  }

  function isCommitted(order) {
    const status = statusParts(order);
    return ["B", "D", "E", "F", "G", "H"].includes(status.id) ||
      ["pending fulfillment", "partially fulfilled", "pending billing", "billed", "closed"]
        .some((name) => status.name.includes(name));
  }

  function isReadyForDelivery(order) {
    if (isBilled(order)) return true;
    const lines = orderLines(order).filter((line) => {
      const itemClass = text(line?.itemClass || line?.item?.class).toLowerCase();
      const closedValue = text(line?.isClosed ?? line?.isclosed).toLowerCase();
      const closed = line?.isClosed === true || line?.isclosed === true ||
        ["t", "true", "1", "yes"].includes(closedValue);
      return !closed && !itemClass.includes("service") && Number(line?.quantity) > 0;
    });
    return lines.length > 0 && lines.every((line) => {
      const quantity = Math.abs(Number(line.quantity) || 0);
      const committed = Math.abs(Number(
        line.quantityCommitted ?? line.quantitycommitted ?? line.committedQuantity
      ) || 0);
      return Math.abs(committed - quantity) < 0.000001;
    });
  }

  function deriveMilestones(order = {}, deposits = []) {
    const related = order.relatedRecords || {};
    return {
      deposit: hasCustomerDeposit(deposits),
      committed: isCommitted(order),
      intercompany: hasReference(
        related.custbody_sb_pairedsalesorder || order.custbody_sb_pairedsalesorder
      ),
      ready: isReadyForDelivery(order),
      dispatch: requiresDispatchTrack(order)
        ? isChecked(related.custbody_exported_to_dispatchtrack ?? order.custbody_exported_to_dispatchtrack)
        : null,
      billed: isBilled(order),
    };
  }

  function render(order = global._currentSalesOrder || {}) {
    const states = deriveMilestones(order, global._currentDeposits);
    if (typeof document === "undefined") return states;
    const entries = Object.entries(states).filter(([, state]) => state !== null);
    const achieved = entries.filter(([, complete]) => complete).length;

    entries.forEach(([key, complete]) => {
      const row = document.querySelector(`[data-milestone="${key}"]`);
      if (!row) return;
      row.classList.toggle("is-complete", complete);
      row.querySelector(".sales-view-progress__icon").textContent = complete ? "✓" : "";
      row.querySelector(".sales-view-progress__label").textContent = LABELS[key][complete ? 0 : 1];
    });
    Object.entries(states).filter(([, state]) => state === null).forEach(([key]) => {
      const row = document.querySelector(`[data-milestone="${key}"]`);
      if (row) row.hidden = true;
    });
    entries.forEach(([key]) => {
      const row = document.querySelector(`[data-milestone="${key}"]`);
      if (row) row.hidden = false;
    });

    const remaining = entries.length - achieved;
    const count = document.getElementById("salesViewProgressCount");
    const summary = document.getElementById("salesViewProgressSummary");
    const bar = document.getElementById("salesViewProgressBar");
    if (count) count.textContent = `${achieved}/${entries.length}`;
    if (summary) summary.textContent = remaining === 0
      ? "All order milestones achieved"
      : `${remaining} milestone${remaining === 1 ? "" : "s"} remaining`;
    if (bar) bar.style.width = `${(achieved / entries.length) * 100}%`;
    return states;
  }

  global.updateSalesViewOrderProgress = render;
  global.SalesViewOrderProgress = {
    deriveMilestones, hasCustomerDeposit, isCommitted, isReadyForDelivery, isBilled,
    requiresDispatchTrack, isChecked,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.SalesViewOrderProgress;
  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => render());
})(typeof window !== "undefined" ? window : globalThis);
