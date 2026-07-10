// Shared financial helpers for order/quote views and receipts.
(function () {
  function money(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function formatMoney(value) {
    return `£${money(value).toFixed(2)}`;
  }

  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function isNegativeValueLine(name = "") {
    const text = String(name || "").toLowerCase();
    return (
      text.includes("discount") ||
      text.includes("blue light") ||
      text.includes("promo") ||
      text.includes("promotion") ||
      text.includes("voucher") ||
      text.includes("trade in") ||
      text.includes("recommendation card (as a minus)") ||
      text.includes("trade-in")
    );
  }

  function depositType(deposit) {
    return String(deposit?.type || deposit?.Type || deposit?.recordType || "").trim();
  }

  function isCustomerRefund(deposit) {
    return depositType(deposit).toLowerCase() === "customer refund";
  }

  function depositAmount(deposit) {
    const amount = money(deposit?.amount);
    return isCustomerRefund(deposit) ? -Math.abs(amount) : amount;
  }

  function lineName(line) {
    return line?.item?.refName || line?.itemName || line?.name || "";
  }

function normaliseLine(line) {
  const name = lineName(line);
  const retailValue =
    hasValue(line?.retailGrossLine) ? line.retailGrossLine :
    hasValue(line?.retailGross) ? line.retailGross :
    hasValue(line?.amountGrossLine) ? line.amountGrossLine :
    hasValue(line?.grossAmount) ? line.grossAmount :
    hasValue(line?.amount) ? line.amount :
    0;

  const saleValue =
    hasValue(line?.saleGrossLine) ? line.saleGrossLine :
    hasValue(line?.saleGross) ? line.saleGross :
    hasValue(line?.grossSaleprice) ? line.grossSaleprice :
    hasValue(line?.saleprice) ? line.saleprice :
    hasValue(line?.total) ? line.total :
    hasValue(line?.lineTotal) ? line.lineTotal :
    retailValue;

  const negativeLine =
    isNegativeValueLine(name) ||
    money(retailValue) < 0 ||
    money(saleValue) < 0 ||
    String(line?.promotionKind || "").trim() !== "";

  let retailGross = money(retailValue);
  let saleGross = money(saleValue);
  let vat = hasValue(line?.vat) ? money(line.vat) : saleGross / 6;

  // ✅ Only use sale as retail fallback if retail was genuinely missing,
  // not just because retail value is zero.
  if (!hasValue(retailValue) && saleGross !== 0) {
    retailGross = saleGross;
  }

  if (negativeLine) {
    retailGross = -Math.abs(retailGross);
    saleGross = -Math.abs(saleGross);
    vat = -Math.abs(vat || saleGross / 6);
  } else {
    retailGross = Math.abs(retailGross);
    saleGross = Math.abs(saleGross);
    vat = Math.abs(vat || saleGross / 6);
  }

  return {
    name,
    quantity: Math.abs(money(line?.quantity)) || 0,
    retailGross: +retailGross.toFixed(2),
    saleGross: +saleGross.toFixed(2),
    vat: +vat.toFixed(2),
    negativeLine,
  };
}

  function summariseLines(lines = [], deposits = []) {
    const summary = {
      vatTotal: 0,
      grossTotal: 0,
      totalRetail: 0,
      discountTotal: 0,
      depositTotal: 0,
      remainingBalance: 0,
      discountPct: 0,
    };

    (lines || []).forEach((line) => {
      const normalised = normaliseLine(line);
      summary.vatTotal += normalised.vat;
      summary.grossTotal += normalised.saleGross;
      summary.totalRetail += normalised.retailGross;
    });

    summary.depositTotal = (deposits || []).reduce(
      (sum, dep) => sum + depositAmount(dep),
      0
    );

    summary.vatTotal = +summary.vatTotal.toFixed(2);
    summary.grossTotal = +summary.grossTotal.toFixed(2);
    summary.totalRetail = +summary.totalRetail.toFixed(2);
    summary.discountTotal = +(summary.totalRetail - summary.grossTotal).toFixed(2);
    summary.remainingBalance = +(summary.grossTotal - summary.depositTotal).toFixed(2);

    if (summary.totalRetail > 0) {
      summary.discountPct = +(
        ((summary.totalRetail - summary.grossTotal) / summary.totalRetail) *
        100
      ).toFixed(2);
    }

    return summary;
  }

  window.EposFinancials = {
    formatMoney,
    hasValue,
    isNegativeValueLine,
    isCustomerRefund,
    depositAmount,
    normaliseLine,
    summariseLines,
  };
})();
