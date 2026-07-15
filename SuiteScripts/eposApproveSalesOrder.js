/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/log", "N/error", "N/email", "N/render", "N/runtime", "N/search"], (record, log, error, email, render, runtime, search) => {
  const GROSS_DIVISOR = 1.2;
  const CUSTOMER_EMAIL_SENT_FIELD = "custbody_sb_cust_email_sent";

  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  function isPendingApprovalStatus(value) {
    const status = String(value || "").trim().toUpperCase();
    return status === "A" || status.indexOf("PENDINGAPPROVAL") !== -1;
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
  }

  function isVatFreeTaxCode(value) {
    const raw =
      value && typeof value === "object"
        ? value.id || value.value || value.refName || ""
        : value;
    const code = String(raw || "").trim().toLowerCase();
    return code === "10" || code.indexOf("vat free") !== -1 || code.indexOf("zero") !== -1;
  }

  function normaliseTrialOptionId(value) {
    const raw =
      value && typeof value === "object"
        ? value.id || value.value || value.refName || value.text || ""
        : value;
    const trial = String(raw || "").trim().toLowerCase();
    if (trial === "accepted" || trial === "yes" || trial === "1") return "1";
    if (trial === "declined" || trial === "no" || trial === "2") return "2";
    if (trial === "n/a" || trial === "na" || trial === "3") return "3";
    return "";
  }

  function syncPairedSalesOrderMemo(soRec, memo) {
    const pairedSalesOrderId = soRec.getValue({
      fieldId: "custbody_sb_pairedsalesorder",
    });

    if (!pairedSalesOrderId) {
      return { ok: true, skipped: true, reason: "no-paired-sales-order" };
    }

    record.submitFields({
      type: record.Type.SALES_ORDER,
      id: pairedSalesOrderId,
      values: { memo: memo || "" },
      options: {
        enableSourcing: false,
        ignoreMandatoryFields: true,
      },
    });

    log.audit("💾 Paired Sales Order memo updated", {
      pairedSalesOrderId,
    });

    return {
      ok: true,
      skipped: false,
      pairedSalesOrderId: String(pairedSalesOrderId),
    };
  }

  function splitEmailRecipients(value) {
    return String(value || "")
      .split(/[;,]/)
      .map(function (item) { return String(item || "").trim(); })
      .filter(function (item) { return item && item.indexOf("@") > 0; });
  }

  function lookupEntityEmail(entityType, entityId) {
    if (!entityId) return "";
    try {
      var lookup = search.lookupFields({
        type: entityType,
        id: entityId,
        columns: ["email"],
      });
      return String(lookup && lookup.email || "").trim();
    } catch (e) {
      log.debug("Could not lookup workflow email entity recipient", {
        entityType: entityType,
        entityId: entityId,
        error: e.message || e,
      });
      return "";
    }
  }

  function workflowTransactionEmailRecipients(transactionRec, isPurchaseOrder) {
    var transactionEmail = "";
    try {
      transactionEmail = transactionRec.getValue({ fieldId: "email" }) || "";
    } catch (e) {
      transactionEmail = "";
    }

    var recipients = splitEmailRecipients(transactionEmail);
    if (recipients.length) return recipients;

    var entityId = transactionRec.getValue({ fieldId: "entity" });
    var entityType = isPurchaseOrder ? search.Type.VENDOR : search.Type.CUSTOMER;
    return splitEmailRecipients(lookupEntityEmail(entityType, entityId));
  }

  function sendWorkflowTransactionEmail(transactionRec, id, isPurchaseOrder, message) {
    var recipients = workflowTransactionEmailRecipients(transactionRec, isPurchaseOrder);
    if (!recipients.length) {
      throw error.create({
        name: "MISSING_EMAIL_RECIPIENT",
        message: "No email recipient was found on the transaction or entity.",
      });
    }

    var tranId = "";
    try {
      tranId = transactionRec.getValue({ fieldId: "tranid" }) || "";
    } catch (e) {
      tranId = String(id || "");
    }

    var author = runtime.getCurrentUser().id;
    var attachment = render.transaction({
      entityId: Number(id),
      printMode: render.PrintMode.PDF,
    });
    var subject = isPurchaseOrder
      ? "Purchase Order " + (tranId || id)
      : "Sales Order " + (tranId || id);

    email.send({
      author: author,
      recipients: recipients,
      subject: subject,
      body: String(message || ""),
      attachments: attachment ? [attachment] : [],
      relatedRecords: {
        transactionId: Number(id),
      },
    });

    return {
      ok: true,
      id: String(id),
      tranId: String(tranId || ""),
      recipients: recipients,
      subject: subject,
      attachedPdf: !!attachment,
    };
  }

  function parseInventoryMeta(detailString) {
    const parts = String(detailString || "")
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean);

    return parts.map((p) => {
      const t = p.split("|").map((x) => (x == null ? "" : String(x)));
      return {
        qty: toNum(t[0]),
        locName: String(t[1] || "").trim(),
        locId: String(t[2] || "").trim(),
        statusName: String(t[3] || "").trim(),
        statusId: String(t[4] || "").trim(),
        invName: String(t[5] || "").trim(),
        invId: String(t[6] || "").trim(),
      };
    });
  }

  function getItemLineCount(soRec) {
    return soRec.getLineCount({ sublistId: "item" }) || 0;
  }

  function findLineIndexByInternalLineId(soRec, lineId) {
    if (!lineId) return -1;

    const lineCount = getItemLineCount(soRec);
    for (let i = 0; i < lineCount; i++) {
      const internalLineId = soRec.getSublistValue({
        sublistId: "item",
        fieldId: "line",
        line: i,
      });

      if (String(internalLineId) === String(lineId)) {
        return i;
      }
    }

    return -1;
  }

  function safeGetSublistValue(rec, fieldId, line) {
    try {
      return rec.getSublistValue({
        sublistId: "item",
        fieldId,
        line,
      });
    } catch (e) {
      return "";
    }
  }

  function snapshotUpdatedLineIdentities(transactionRec, processedLines) {
    if (!Array.isArray(processedLines) || !processedLines.length) return [];

    return processedLines.map((processed) => {
      const lineIndex = Number(processed.lineIndex);
      const hasLineIndex =
        Number.isFinite(lineIndex) && lineIndex >= 0 && lineIndex < getItemLineCount(transactionRec);

      return {
        clientLineKey: String(processed.clientLineKey || ""),
        lineIndex: hasLineIndex ? lineIndex : null,
        lineId: hasLineIndex
          ? String(safeGetSublistValue(transactionRec, "line", lineIndex) || processed.lineId || "")
          : String(processed.lineId || ""),
        lineUniqueKey: hasLineIndex
          ? String(
              safeGetSublistValue(transactionRec, "lineuniquekey", lineIndex) ||
                processed.lineUniqueKey ||
                ""
            )
          : String(processed.lineUniqueKey || ""),
        itemId: hasLineIndex
          ? String(safeGetSublistValue(transactionRec, "item", lineIndex) || processed.itemId || "")
          : String(processed.itemId || ""),
        price: hasLineIndex ? safeGetSublistValue(transactionRec, "price", lineIndex) : "",
        rate: hasLineIndex ? safeGetSublistValue(transactionRec, "rate", lineIndex) : "",
        amount: hasLineIndex ? safeGetSublistValue(transactionRec, "amount", lineIndex) : "",
        grossamt: hasLineIndex ? safeGetSublistValue(transactionRec, "grossamt", lineIndex) : "",
        isNew: processed.isNew === true,
      };
    });
  }

  function findLineIndexForOptionsUpdate(soRec, update, updates) {
    const wantedLineIds = [
      update.lineId,
      update.line,
      update.lineUniqueKey,
      update.lineuniquekey,
      update.suiteQlLineId,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const updateItem = update.item && typeof update.item === "object" ? update.item.id : update.item;
    const wantedItemId = String(update.itemId || updateItem || "").trim();
    const wantedIndex =
      update.lineIndex !== undefined && update.lineIndex !== null
        ? Number(update.lineIndex)
        : null;

    const lineCount = getItemLineCount(soRec);
    for (let i = 0; i < lineCount; i++) {
      const currentIds = [
        safeGetSublistValue(soRec, "line", i),
        safeGetSublistValue(soRec, "lineuniquekey", i),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      if (currentIds.some((id) => wantedLineIds.indexOf(id) >= 0)) {
        return i;
      }
    }

    if (wantedIndex !== null && Number.isFinite(wantedIndex) && wantedIndex >= 0 && wantedIndex < lineCount) {
      const currentItemId = String(safeGetSublistValue(soRec, "item", wantedIndex) || "").trim();
      if (!wantedItemId || currentItemId === wantedItemId) return wantedIndex;
    }

    if (wantedItemId) {
      const sameItemUpdates = (Array.isArray(updates) ? updates : []).filter((candidate) => {
        const candidateItemId = String(candidate.itemId || candidate.item?.id || candidate.item || "").trim();
        return candidateItemId === wantedItemId;
      });
      const wantedOccurrence = Math.max(0, sameItemUpdates.indexOf(update));
      let seen = 0;

      for (let i = 0; i < lineCount; i++) {
        const currentItemId = String(safeGetSublistValue(soRec, "item", i) || "").trim();
        if (currentItemId !== wantedItemId) continue;
        if (seen === wantedOccurrence) return i;
        seen += 1;
      }
    }

    return -1;
  }

  function updateOptionsOnly(soRec, updates) {
    const results = [];
    const failures = [];

    (Array.isArray(updates) ? updates : []).forEach((u) => {
      const isNewLine = u && (u.isNew === true || u.isNew === "true");
      const updateItem = u.item && typeof u.item === "object" ? u.item.id : u.item;
      const itemId = String(u.itemId || updateItem || "").trim();

      if (isNewLine) {
        if (!itemId) {
          failures.push({
            lineId: "",
            itemId: "",
            error: "New line is missing itemId",
          });
          return;
        }

        try {
          soRec.selectNewLine({ sublistId: "item" });
          setCurrentIfDefined(soRec, "item", itemId);
          if (hasOptionsValue(u)) {
            const optionsValue = u.options !== undefined ? u.options : u.optionsSummary;
            setCurrentIfDefined(soRec, "custcol_sb_itemoptionsdisplay", String(optionsValue || ""));
          }
          if (hasClosedValue(u)) {
            setCurrentIfDefined(soRec, "isclosed", normaliseClosedValue(u));
          }
          applyMappedCurrentLineFields(soRec, u);
          soRec.commitLine({ sublistId: "item" });

          const insertedLineIndex = getItemLineCount(soRec) - 1;
          soRec.selectLine({ sublistId: "item", line: insertedLineIndex });
          applyMappedCurrentLineFields(soRec, u);
          soRec.commitLine({ sublistId: "item" });

          results.push({
            line: insertedLineIndex,
            lineId: String(safeGetSublistValue(soRec, "line", insertedLineIndex) || ""),
            lineUniqueKey: String(safeGetSublistValue(soRec, "lineuniquekey", insertedLineIndex) || ""),
            itemId: String(safeGetSublistValue(soRec, "item", insertedLineIndex) || itemId),
            price: safeGetSublistValue(soRec, "price", insertedLineIndex),
            rate: safeGetSublistValue(soRec, "rate", insertedLineIndex),
            amount: safeGetSublistValue(soRec, "amount", insertedLineIndex),
            grossamt: safeGetSublistValue(soRec, "grossamt", insertedLineIndex),
            isNew: true,
          });
        } catch (lineErr) {
          failures.push({
            lineId: "",
            itemId,
            error: lineErr.message || String(lineErr),
          });
        }
        return;
      }

      const targetLine = findLineIndexForOptionsUpdate(soRec, u, updates);
      const optionsValue = u.options !== undefined ? u.options : u.optionsSummary;

      if (targetLine < 0) {
        failures.push({
          lineId: String(u.lineId || u.suiteQlLineId || ""),
          itemId,
          error: "Line not found",
        });
        return;
      }

      try {
        soRec.selectLine({
          sublistId: "item",
          line: targetLine,
        });
        const pricingSnapshot = currentLinePricingSnapshot(soRec);
        if (hasOptionsValue(u)) {
          setCurrentIfDefined(
            soRec,
            "custcol_sb_itemoptionsdisplay",
            String(optionsValue || "")
          );
        }
        if (hasClosedValue(u)) {
          setCurrentIfDefined(soRec, "isclosed", normaliseClosedValue(u));
        }
        applyMappedCurrentLineFields(soRec, u);
        restoreCurrentLinePricingIfUnmapped(soRec, u, pricingSnapshot);
        soRec.commitLine({ sublistId: "item" });

        results.push({
          line: targetLine,
          lineId: String(safeGetSublistValue(soRec, "line", targetLine) || ""),
          lineUniqueKey: String(safeGetSublistValue(soRec, "lineuniquekey", targetLine) || ""),
          itemId: String(safeGetSublistValue(soRec, "item", targetLine) || ""),
          closed: hasClosedValue(u) ? normaliseClosedValue(u) : undefined,
        });
      } catch (lineErr) {
        failures.push({
          line: targetLine,
          lineId: String(u.lineId || u.suiteQlLineId || ""),
          itemId,
          error: lineErr.message || String(lineErr),
        });
      }
    });

    return { results, failures };
  }

  function updateOptionsOnlyStatic(transactionRec, updates) {
    const results = [];
    const failures = [];

    (Array.isArray(updates) ? updates : []).forEach((u) => {
      const targetLine = findLineIndexForOptionsUpdate(transactionRec, u, updates);
      const optionsValue = u.options !== undefined ? u.options : u.optionsSummary;
      const updateItem = u.item && typeof u.item === "object" ? u.item.id : u.item;

      if (targetLine < 0) {
        failures.push({
          lineId: String(u.lineId || u.suiteQlLineId || ""),
          itemId: String(u.itemId || updateItem || ""),
          error: "Line not found",
        });
        return;
      }

      try {
        if (hasOptionsValue(u)) {
          transactionRec.setSublistValue({
            sublistId: "item",
            fieldId: "custcol_sb_itemoptionsdisplay",
            line: targetLine,
            value: String(optionsValue || ""),
          });
        }
        if (hasClosedValue(u)) {
          transactionRec.setSublistValue({
            sublistId: "item",
            fieldId: "isclosed",
            line: targetLine,
            value: normaliseClosedValue(u),
          });
        }
        applyMappedStaticLineFields(transactionRec, u, targetLine);

        results.push({
          line: targetLine,
          lineId: String(safeGetSublistValue(transactionRec, "line", targetLine) || ""),
          lineUniqueKey: String(safeGetSublistValue(transactionRec, "lineuniquekey", targetLine) || ""),
          itemId: String(safeGetSublistValue(transactionRec, "item", targetLine) || ""),
          closed: hasClosedValue(u) ? normaliseClosedValue(u) : undefined,
        });
      } catch (lineErr) {
        failures.push({
          line: targetLine,
          lineId: String(u.lineId || u.suiteQlLineId || ""),
          itemId: String(u.itemId || updateItem || ""),
          error: lineErr.message || String(lineErr),
        });
      }
    });

    return { results, failures };
  }

  function setBodyValueIfPossible(transactionRec, fieldId, value) {
    try {
      transactionRec.setValue({
        fieldId,
        value,
        ignoreFieldChange: true,
      });
    } catch (e) {
      log.debug("Body field could not be set", {
        fieldId,
        error: e.message || e,
      });
    }
  }

  function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === "";
  }

  function normaliseRecordValue(value) {
    if (value && typeof value === "object") {
      return value.id || value.internalId || value.value || "";
    }
    return value;
  }

  function normaliseScalar(value) {
    const raw = normaliseRecordValue(value);
    if (isBlank(raw)) return "";
    const text = String(raw).trim();
    if (/^-?\d+$/.test(text)) {
      const numeric = Number(text);
      if (Number.isSafeInteger(numeric)) return numeric;
    }
    if (/^-?\d+\.\d+$/.test(text)) {
      const numeric = Number(text);
      if (Number.isFinite(numeric)) return numeric;
    }
    if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
    return text;
  }

  function setFirstBodyValue(transactionRec, fieldIds, value, options) {
    const cleanValue = normaliseScalar(value);
    if (isBlank(cleanValue)) return { ok: false, skipped: true, reason: "blank" };

    const errors = [];
    for (let i = 0; i < fieldIds.length; i++) {
      const fieldId = fieldIds[i];
      try {
        transactionRec.setValue({
          fieldId,
          value: cleanValue,
          ignoreFieldChange: options && options.ignoreFieldChange === true,
        });
        return { ok: true, fieldId, value: cleanValue };
      } catch (e) {
        errors.push({ fieldId, error: e.message || String(e) });
      }
    }
    return { ok: false, errors };
  }

  function setMappedBodyFields(transactionRec, payload, fieldAliasMap, preferredOrder) {
    const applied = [];
    const failed = [];
    const allKeys = Object.keys(payload || {});
    const orderedKeys = []
      .concat(Array.isArray(preferredOrder) ? preferredOrder : [])
      .concat(allKeys)
      .filter((fieldId, index, list) => fieldId && list.indexOf(fieldId) === index && allKeys.indexOf(fieldId) >= 0);

    orderedKeys.forEach((fieldId) => {
      const value = payload[fieldId];
      if (value && typeof value === "object" && Array.isArray(value.items)) return;
      if (isBlank(normaliseRecordValue(value))) return;

      const aliases = fieldAliasMap[fieldId] || [fieldId];
      const result = setFirstBodyValue(transactionRec, aliases, value);
      if (result.ok) applied.push({ sourceField: fieldId, fieldId: result.fieldId, value: result.value });
      else failed.push({ sourceField: fieldId, aliases, errors: result.errors || [] });
    });
    return { applied, failed };
  }

  function findApplyLine(customerRefundRec, row) {
    const lineCount = customerRefundRec.getLineCount({ sublistId: "apply" }) || 0;
    const wantedDoc = String(normaliseRecordValue(row.doc) || "").trim();
    const wantedLine = String(normaliseRecordValue(row.line) || "").trim();
    const wantedRef = String(row.refNum || row.refnum || "").trim().toLowerCase();

    for (let i = 0; i < lineCount; i++) {
      const doc = String(customerRefundRec.getSublistValue({ sublistId: "apply", fieldId: "doc", line: i }) || "").trim();
      const line = String(customerRefundRec.getSublistValue({ sublistId: "apply", fieldId: "line", line: i }) || "").trim();
      const refNum = String(customerRefundRec.getSublistValue({ sublistId: "apply", fieldId: "refnum", line: i }) || "").trim().toLowerCase();
      if (wantedDoc && doc === wantedDoc && (!wantedLine || line === wantedLine)) return i;
      if (wantedRef && refNum === wantedRef) return i;
    }
    return -1;
  }

  function applyCustomerRefundSublistRows(customerRefundRec, applyPayload) {
    const rows = Array.isArray(applyPayload && applyPayload.items) ? applyPayload.items : [];
    const applied = [];
    const failed = [];

    rows.forEach((row) => {
      const targetLine = findApplyLine(customerRefundRec, row);
      if (targetLine < 0) {
        failed.push({ row, error: "Matching apply line was not found." });
        return;
      }

      try {
        customerRefundRec.selectLine({ sublistId: "apply", line: targetLine });
        if (row.apply !== undefined) {
          customerRefundRec.setCurrentSublistValue({
            sublistId: "apply",
            fieldId: "apply",
            value: row.apply === true || String(row.apply).toUpperCase() === "T" || String(row.apply).toLowerCase() === "true",
          });
        }
        if (!isBlank(row.amount)) {
          customerRefundRec.setCurrentSublistValue({
            sublistId: "apply",
            fieldId: "amount",
            value: Number(row.amount),
          });
        }
        customerRefundRec.commitLine({ sublistId: "apply" });
        applied.push({ line: targetLine, row });
      } catch (e) {
        failed.push({ line: targetLine, row, error: e.message || String(e) });
      }
    });

    return { applied, failed };
  }

  function safeGetSublistValueById(customerRefundRec, sublistId, fieldId, line) {
    try {
      return customerRefundRec.getSublistValue({
        sublistId,
        fieldId,
        line,
      });
    } catch (e) {
      return "";
    }
  }

  function safeGetApplyValue(customerRefundRec, fieldId, line) {
    return safeGetSublistValueById(customerRefundRec, "apply", fieldId, line);
  }

  function sublistLineCount(customerRefundRec, sublistId) {
    try {
      return customerRefundRec.getLineCount({ sublistId }) || 0;
    } catch (e) {
      return 0;
    }
  }

  function customerRefundSublistDebug(customerRefundRec) {
    const candidates = ["apply", "deposit", "deposits", "credit", "credits"];
    let available = [];
    try {
      if (typeof customerRefundRec.getSublists === "function") {
        available = customerRefundRec.getSublists() || [];
      }
    } catch (e) {
      available = [];
    }
    const ids = candidates.concat(available).filter((id, index, list) => id && list.indexOf(id) === index);
    return ids.map((sublistId) => ({
      sublistId,
      lineCount: sublistLineCount(customerRefundRec, sublistId),
    }));
  }

  function applyLineSnapshot(customerRefundRec, sublistId, line) {
    return {
      sublistId,
      line,
      doc: String(safeGetSublistValueById(customerRefundRec, sublistId, "doc", line) || ""),
      internalId: String(safeGetSublistValueById(customerRefundRec, sublistId, "internalid", line) || ""),
      refNum: String(safeGetSublistValueById(customerRefundRec, sublistId, "refnum", line) || ""),
      refnum: String(safeGetSublistValueById(customerRefundRec, sublistId, "refnum", line) || ""),
      type: String(safeGetSublistValueById(customerRefundRec, sublistId, "type", line) || ""),
      createdFrom: String(safeGetSublistValueById(customerRefundRec, sublistId, "createdfrom", line) || ""),
      total: String(safeGetSublistValueById(customerRefundRec, sublistId, "total", line) || ""),
      due: String(safeGetSublistValueById(customerRefundRec, sublistId, "due", line) || ""),
      amount: String(safeGetSublistValueById(customerRefundRec, sublistId, "amount", line) || ""),
    };
  }

  function normaliseAmount(value) {
    const raw = normaliseRecordValue(value);
    if (isBlank(raw)) return null;
    const numeric = Number(String(raw).replace(/,/g, ""));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  function isDepositApplyLine(line) {
    const text = [
      line.refNum,
      line.refnum,
      line.type,
      line.doc,
      line.internalId,
    ].join(" ").toLowerCase();
    return text.indexOf("deposit") >= 0 || /\bcd\d+/i.test(text);
  }

  function isCreditApplyLine(line) {
    const text = [
      line.refNum,
      line.refnum,
      line.type,
      line.doc,
      line.internalId,
    ].join(" ").toLowerCase();
    return text.indexOf("credit") >= 0 || /\bcm\d+/i.test(text);
  }

  function candidateDepositIds(context) {
    const candidates = Array.isArray(context && context.candidateDeposits)
      ? context.candidateDeposits
      : [];
    return candidates
      .map((deposit) => String(normaliseRecordValue(deposit && (deposit.id || deposit.doc || deposit.depositId)) || "").trim())
      .filter(Boolean);
  }

  function depositAllocations(context) {
    return (Array.isArray(context && context.depositAllocations) ? context.depositAllocations : [])
      .map((allocation) => ({
        id: String(normaliseRecordValue(allocation && (allocation.id || allocation.depositId || allocation.doc)) || "").trim(),
        amount: normaliseAmount(allocation && allocation.amount),
      }))
      .filter((allocation) => allocation.id && allocation.amount);
  }

  function candidateCreditIds(context) {
    const candidates = Array.isArray(context && context.candidateCredits)
      ? context.candidateCredits
      : [];
    return candidates
      .map((credit) => String(normaliseRecordValue(credit && (credit.id || credit.doc || credit.creditId)) || "").trim())
      .filter(Boolean);
  }

  function creditAllocations(context) {
    return (Array.isArray(context && context.creditAllocations) ? context.creditAllocations : [])
      .map((allocation) => ({
        id: String(normaliseRecordValue(allocation && (allocation.id || allocation.creditId || allocation.doc)) || "").trim(),
        amount: normaliseAmount(allocation && allocation.amount),
      }))
      .filter((allocation) => allocation.id && allocation.amount);
  }

  function autoApplyCustomerCredit(customerRefundRec, context) {
    const requestedAmount = normaliseAmount(context && context.refundAmount);
    const wantedCreditIds = candidateCreditIds(context);
    const requestedAllocations = creditAllocations(context);
    const sublistDebug = customerRefundSublistDebug(customerRefundRec);
    const sublistIds = ["apply", "credit", "credits"];
    const lines = [];

    sublistIds.forEach((sublistId) => {
      const lineCount = sublistLineCount(customerRefundRec, sublistId);
      for (let i = 0; i < lineCount; i++) {
        lines.push(applyLineSnapshot(customerRefundRec, sublistId, i));
      }
    });

    const creditLines = lines.filter((line) =>
      isCreditApplyLine(line) ||
      wantedCreditIds.indexOf(String(line.doc || "").trim()) >= 0 ||
      wantedCreditIds.indexOf(String(line.internalId || "").trim()) >= 0
    );

    if (requestedAllocations.length) {
      const applied = [];
      const failed = [];
      requestedAllocations.forEach((allocation) => {
        const targetLine = creditLines.find((line) =>
          String(line.doc || "").trim() === allocation.id ||
          String(line.internalId || "").trim() === allocation.id
        );
        if (!targetLine) {
          failed.push({ allocation, error: "Selected credit memo was not available on the refund apply sublist." });
          return;
        }
        try {
          customerRefundRec.selectLine({ sublistId: targetLine.sublistId, line: targetLine.line });
          customerRefundRec.setCurrentSublistValue({ sublistId: targetLine.sublistId, fieldId: "apply", value: true });
          customerRefundRec.setCurrentSublistValue({ sublistId: targetLine.sublistId, fieldId: "amount", value: allocation.amount });
          customerRefundRec.commitLine({ sublistId: targetLine.sublistId });
          applied.push({ line: targetLine.line, amount: allocation.amount, selectedLine: targetLine, allocation });
        } catch (e) {
          failed.push({ allocation, selectedLine: targetLine, error: e.message || String(e) });
        }
      });
      return { applied, failed, availableLines: lines };
    }

    const target = creditLines[0] || lines[0];
    if (!target) {
      return {
        applied: [],
        failed: [{
          error: "No credit memo lines were available to apply.",
          wantedCreditIds,
          sublists: sublistDebug,
          availableLines: lines,
        }],
      };
    }

    const dueAmount = normaliseAmount(target.due) || normaliseAmount(target.total) || normaliseAmount(target.amount);
    const amount = requestedAmount || dueAmount;
    if (!amount) {
      return {
        applied: [],
        failed: [{ error: "A refund amount could not be resolved for the selected credit memo line.", selectedLine: target, availableLines: lines }],
      };
    }

    try {
      customerRefundRec.selectLine({ sublistId: target.sublistId, line: target.line });
      customerRefundRec.setCurrentSublistValue({ sublistId: target.sublistId, fieldId: "apply", value: true });
      customerRefundRec.setCurrentSublistValue({ sublistId: target.sublistId, fieldId: "amount", value: amount });
      customerRefundRec.commitLine({ sublistId: target.sublistId });
      return {
        applied: [{ line: target.line, amount, selectedLine: target }],
        failed: [],
        availableLines: lines,
      };
    } catch (e) {
      return {
        applied: [],
        failed: [{ error: e.message || String(e), selectedLine: target, availableLines: lines }],
      };
    }
  }

  function firstDepositAllocation(context) {
    const allocations = depositAllocations(context);
    if (allocations.length) return allocations[0];
    const candidates = Array.isArray(context && context.candidateDeposits)
      ? context.candidateDeposits
      : [];
    const requestedAmount = normaliseAmount(context && context.refundAmount);
    for (let i = 0; i < candidates.length; i++) {
      const id = String(normaliseRecordValue(candidates[i] && (candidates[i].id || candidates[i].depositId || candidates[i].doc)) || "").trim();
      if (id && requestedAmount) return { id, amount: requestedAmount };
    }
    return null;
  }

  function firstCreditAllocation(context) {
    const allocations = creditAllocations(context);
    if (allocations.length) return allocations[0];
    const candidates = Array.isArray(context && context.candidateCredits)
      ? context.candidateCredits
      : [];
    const requestedAmount = normaliseAmount(context && context.refundAmount);
    for (let i = 0; i < candidates.length; i++) {
      const id = String(normaliseRecordValue(candidates[i] && (candidates[i].id || candidates[i].creditId || candidates[i].doc)) || "").trim();
      const amount = requestedAmount || normaliseAmount(candidates[i] && (candidates[i].total || candidates[i].amount));
      if (id && amount) return { id, amount };
    }
    return null;
  }

  function autoApplyCustomerDeposit(customerRefundRec, context) {
    const salesOrderId = String((context && context.salesOrderId) || "").trim();
    const requestedAmount = normaliseAmount(context && context.refundAmount);
    const wantedDepositIds = candidateDepositIds(context);
    const requestedAllocations = depositAllocations(context);
    const sublistDebug = customerRefundSublistDebug(customerRefundRec);
    const sublistIds = ["apply", "deposit", "deposits", "credit", "credits"];
    const lines = [];

    sublistIds.forEach((sublistId) => {
      const lineCount = sublistLineCount(customerRefundRec, sublistId);
      for (let i = 0; i < lineCount; i++) {
        lines.push(applyLineSnapshot(customerRefundRec, sublistId, i));
      }
    });

    const depositLines = lines.filter(isDepositApplyLine);
    if (requestedAllocations.length) {
      const applied = [];
      const failed = [];
      requestedAllocations.forEach((allocation) => {
        const targetLine = depositLines.find((line) =>
          String(line.doc || "").trim() === allocation.id ||
          String(line.internalId || "").trim() === allocation.id
        );
        if (!targetLine) {
          failed.push({ allocation, error: "Selected customer deposit was not available on the refund apply sublist." });
          return;
        }
        try {
          customerRefundRec.selectLine({ sublistId: targetLine.sublistId, line: targetLine.line });
          customerRefundRec.setCurrentSublistValue({ sublistId: targetLine.sublistId, fieldId: "apply", value: true });
          customerRefundRec.setCurrentSublistValue({ sublistId: targetLine.sublistId, fieldId: "amount", value: allocation.amount });
          customerRefundRec.commitLine({ sublistId: targetLine.sublistId });
          applied.push({ line: targetLine.line, amount: allocation.amount, selectedLine: targetLine, allocation });
        } catch (e) {
          failed.push({ allocation, selectedLine: targetLine, error: e.message || String(e) });
        }
      });
      return { applied, failed, availableLines: lines };
    }

    const matchingDepositLines = wantedDepositIds.length
      ? depositLines.filter((line) =>
        wantedDepositIds.indexOf(String(line.doc || "").trim()) >= 0 ||
        wantedDepositIds.indexOf(String(line.internalId || "").trim()) >= 0
      )
      : [];
    const matchingSalesOrderLines = salesOrderId
      ? depositLines.filter((line) => String(line.createdFrom || "").trim() === salesOrderId)
      : [];
    const target = (
      matchingDepositLines.length
        ? matchingDepositLines
        : matchingSalesOrderLines.length
          ? matchingSalesOrderLines
          : depositLines
    )[0] || lines[0];

    if (!target) {
      return {
        applied: [],
        failed: [{
          error: "No customer deposit or credit lines were available to apply.",
          wantedDepositIds,
          sublists: sublistDebug,
          availableLines: lines,
        }],
      };
    }

    const dueAmount = normaliseAmount(target.due) || normaliseAmount(target.total) || normaliseAmount(target.amount);
    const amount = requestedAmount || dueAmount;
    if (!amount) {
      return {
        applied: [],
        failed: [{ error: "A refund amount could not be resolved for the selected deposit line.", selectedLine: target, availableLines: lines }],
      };
    }

    try {
      customerRefundRec.selectLine({ sublistId: target.sublistId, line: target.line });
      customerRefundRec.setCurrentSublistValue({
        sublistId: target.sublistId,
        fieldId: "apply",
        value: true,
      });
      customerRefundRec.setCurrentSublistValue({
        sublistId: target.sublistId,
        fieldId: "amount",
        value: amount,
      });
      customerRefundRec.commitLine({ sublistId: target.sublistId });
      return {
        applied: [{ line: target.line, amount, selectedLine: target }],
        failed: [],
        availableLines: lines,
      };
    } catch (e) {
      return {
        applied: [],
        failed: [{ error: e.message || String(e), selectedLine: target, availableLines: lines }],
      };
    }
  }

  function createCustomerRefund(context) {
    const payload = context && context.payload && typeof context.payload === "object"
      ? context.payload
      : context || {};
    const selectedCredit = context && context.refundSource === "creditMemo" ? firstCreditAllocation(context) : null;
    const selectedDeposit = firstDepositAllocation(context);

    function buildAndSaveCustomerRefundFromCredit(allocation, options) {
      const effectivePayload = Object.assign({}, payload);
      const ignoredBodyFields = [];
      ["customer", "entity", "account", "createdfrom", "createdFrom"].forEach((fieldId) => {
        if (effectivePayload[fieldId] !== undefined) {
          ignoredBodyFields.push({
            fieldId,
            value: effectivePayload[fieldId],
            reason: "Customer Refund was transformed from the selected Credit Memo.",
          });
          delete effectivePayload[fieldId];
        }
      });
      if (options && options.skipPaymentMethod === true) {
        ["paymentMethod", "paymentmethod", "paymentOption", "paymentoption"].forEach((fieldId) => {
          if (effectivePayload[fieldId] !== undefined) {
            ignoredBodyFields.push({
              fieldId,
              value: effectivePayload[fieldId],
              reason: "Skipped while retrying transformed Customer Refund save after linked-account validation.",
            });
            delete effectivePayload[fieldId];
          }
        });
      }

      const fieldAliasMap = {
        paymentMethod: ["paymentmethod", "paymentMethod"],
        paymentmethod: ["paymentmethod", "paymentMethod"],
        paymentOption: ["paymentoption", "PaymentOption", "paymentmethod", "paymentMethod"],
        paymentoption: ["paymentoption", "PaymentOption", "paymentmethod", "paymentMethod"],
      };

      let refundRec;
      try {
        refundRec = record.transform({
          fromType: record.Type.CREDIT_MEMO,
          fromId: Number(allocation.id),
          toType: record.Type.CUSTOMER_REFUND,
          isDynamic: true,
        });
      } catch (transformErr) {
        return {
          ok: false,
          error: transformErr.message || String(transformErr),
          name: transformErr.name || "",
          allocation,
          retryMode: options && options.skipPaymentMethod ? "credit-transform-without-payment-method" : "credit-transform",
        };
      }

      const bodyResult = setMappedBodyFields(refundRec, effectivePayload, fieldAliasMap, [
        "customform",
        "paymentMethod",
        "paymentmethod",
        "paymentOption",
        "paymentoption",
      ]);
      bodyResult.ignored = ignoredBodyFields;
      const amountResult = allocation.amount
        ? setFirstBodyValue(refundRec, ["payment", "amount", "usertotal", "total"], allocation.amount)
        : { ok: false, skipped: true, reason: "blank" };
      if (amountResult.ok) {
        bodyResult.applied.push({
          sourceField: "creditAllocation.amount",
          fieldId: amountResult.fieldId,
          value: amountResult.value,
        });
      } else if (!amountResult.skipped) {
        bodyResult.failed.push({
          sourceField: "creditAllocation.amount",
          aliases: ["payment", "amount", "usertotal", "total"],
          errors: amountResult.errors || [],
        });
      }

      const applyResult = {
        applied: [{
          transformedFromCreditMemo: true,
          creditMemoId: allocation.id,
          amount: allocation.amount,
          reason: "Customer Refund was transformed from the selected Credit Memo.",
        }],
        failed: [],
        availableLines: [],
      };

      let id;
      try {
        id = refundRec.save({
          enableSourcing: true,
          ignoreMandatoryFields: false,
        });
      } catch (saveErr) {
        return {
          ok: false,
          error: saveErr.message || String(saveErr),
          name: saveErr.name || "",
          bodyResult,
          applyResult,
          allocation,
          sublists: customerRefundSublistDebug(refundRec),
          retryMode: options && options.skipPaymentMethod ? "credit-transform-without-payment-method" : "credit-transform",
        };
      }

      const saved = record.load({
        type: record.Type.CUSTOMER_REFUND,
        id,
        isDynamic: false,
      });

      return {
        ok: true,
        id: String(id),
        tranId: String(saved.getValue({ fieldId: "tranid" }) || ""),
        bodyResult,
        applyResult,
        allocation,
        retryMode: options && options.skipPaymentMethod ? "credit-transform-without-payment-method" : "credit-transform",
      };
    }

    if (selectedCredit) {
      const transformed = buildAndSaveCustomerRefundFromCredit(selectedCredit, { skipPaymentMethod: false });
      if (transformed.ok || !/account of a transaction line/i.test(transformed.error || "")) {
        return transformed;
      }
      const retry = buildAndSaveCustomerRefundFromCredit(selectedCredit, { skipPaymentMethod: true });
      retry.firstAttempt = transformed;
      return retry;
    }

    function buildAndSaveCustomerRefundFromDeposit(allocation, options) {
      const effectivePayload = Object.assign({}, payload);
      const ignoredBodyFields = [];
      ["customer", "entity", "account", "createdfrom", "createdFrom"].forEach((fieldId) => {
        if (effectivePayload[fieldId] !== undefined) {
          ignoredBodyFields.push({
            fieldId,
            value: effectivePayload[fieldId],
            reason: "Customer Refund was transformed from the selected Customer Deposit.",
          });
          delete effectivePayload[fieldId];
        }
      });
      if (options && options.skipPaymentMethod === true) {
        ["paymentMethod", "paymentmethod", "paymentOption", "paymentoption"].forEach((fieldId) => {
          if (effectivePayload[fieldId] !== undefined) {
            ignoredBodyFields.push({
              fieldId,
              value: effectivePayload[fieldId],
              reason: "Skipped while retrying transformed Customer Refund save after linked-account validation.",
            });
            delete effectivePayload[fieldId];
          }
        });
      }

      const fieldAliasMap = {
        paymentMethod: ["paymentmethod", "paymentMethod"],
        paymentmethod: ["paymentmethod", "paymentMethod"],
        paymentOption: ["paymentoption", "paymentOption", "paymentmethod", "paymentMethod"],
        paymentoption: ["paymentoption", "paymentOption", "paymentmethod", "paymentMethod"],
      };

      let refundRec;
      try {
        refundRec = record.transform({
          fromType: record.Type.CUSTOMER_DEPOSIT,
          fromId: Number(allocation.id),
          toType: record.Type.CUSTOMER_REFUND,
          isDynamic: true,
        });
      } catch (transformErr) {
        return {
          ok: false,
          error: transformErr.message || String(transformErr),
          name: transformErr.name || "",
          allocation,
          retryMode: options && options.skipPaymentMethod ? "transform-without-payment-method" : "transform",
        };
      }

      const bodyResult = setMappedBodyFields(refundRec, effectivePayload, fieldAliasMap, [
        "customform",
        "paymentMethod",
        "paymentmethod",
        "paymentOption",
        "paymentoption",
      ]);
      bodyResult.ignored = ignoredBodyFields;
      const amountResult = allocation.amount
        ? setFirstBodyValue(refundRec, ["payment", "amount", "usertotal", "total"], allocation.amount)
        : { ok: false, skipped: true, reason: "blank" };
      if (amountResult.ok) {
        bodyResult.applied.push({
          sourceField: "depositAllocation.amount",
          fieldId: amountResult.fieldId,
          value: amountResult.value,
        });
      } else if (!amountResult.skipped) {
        bodyResult.failed.push({
          sourceField: "depositAllocation.amount",
          aliases: ["payment", "amount", "usertotal", "total"],
          errors: amountResult.errors || [],
        });
      }

      const applyContext = Object.assign({}, context || {}, {
        refundAmount: allocation.amount || (context && context.refundAmount),
        depositAllocations: [allocation],
        candidateDeposits: [{ id: allocation.id }],
      });
      const explicitApplyResult = effectivePayload.apply ? applyCustomerRefundSublistRows(refundRec, effectivePayload.apply) : { applied: [], failed: [] };
      const applyResult = explicitApplyResult.applied.length
        ? explicitApplyResult
        : autoApplyCustomerDeposit(refundRec, applyContext);
      if (!applyResult.applied.length) {
        applyResult.applied.push({
          transformedFromDeposit: true,
          depositId: allocation.id,
          amount: allocation.amount,
          reason: "Customer Refund was transformed from the selected Customer Deposit; no apply sublist lines were exposed.",
        });
      }

      let id;
      try {
        id = refundRec.save({
          enableSourcing: true,
          ignoreMandatoryFields: false,
        });
      } catch (saveErr) {
        return {
          ok: false,
          error: saveErr.message || String(saveErr),
          name: saveErr.name || "",
          bodyResult,
          applyResult,
          allocation,
          sublists: customerRefundSublistDebug(refundRec),
          retryMode: options && options.skipPaymentMethod ? "transform-without-payment-method" : "transform",
        };
      }

      const saved = record.load({
        type: record.Type.CUSTOMER_REFUND,
        id,
        isDynamic: false,
      });

      return {
        ok: true,
        id: String(id),
        tranId: String(saved.getValue({ fieldId: "tranid" }) || ""),
        bodyResult,
        applyResult,
        allocation,
        retryMode: options && options.skipPaymentMethod ? "transform-without-payment-method" : "transform",
      };
    }

    if (selectedDeposit) {
      const transformed = buildAndSaveCustomerRefundFromDeposit(selectedDeposit, { skipPaymentMethod: false });
      if (transformed.ok || !/account of a transaction line/i.test(transformed.error || "")) {
        return transformed;
      }
      const retry = buildAndSaveCustomerRefundFromDeposit(selectedDeposit, { skipPaymentMethod: true });
      retry.firstAttempt = transformed;
      return retry;
    }

    function buildAndSaveCustomerRefund(options) {
      const effectivePayload = Object.assign({}, payload);
      const ignoredBodyFields = [];
      if (options && options.skipPaymentMethod === true) {
        ["paymentMethod", "paymentmethod", "paymentOption", "paymentoption"].forEach((fieldId) => {
          if (effectivePayload[fieldId] !== undefined) {
            ignoredBodyFields.push({
              fieldId,
              value: effectivePayload[fieldId],
              reason: "Skipped while retrying Customer Refund save after linked-account validation.",
            });
            delete effectivePayload[fieldId];
          }
        });
      }
      if (effectivePayload.account !== undefined && context && context.allowAccountOverride !== true) {
        ignoredBodyFields.push({
          fieldId: "account",
          value: effectivePayload.account,
          reason: "Customer Refund account is sourced by NetSuite unless explicitly overridden.",
        });
        delete effectivePayload.account;
      }
      const fieldAliasMap = {
        customer: ["customer", "entity"],
        entity: ["customer", "entity"],
        paymentMethod: ["paymentmethod", "paymentMethod"],
        paymentmethod: ["paymentmethod", "paymentMethod"],
        paymentOption: ["paymentoption", "paymentOption", "paymentmethod", "paymentMethod"],
        paymentoption: ["paymentoption", "paymentOption", "paymentmethod", "paymentMethod"],
        createdfrom: ["createdfrom", "createdFrom"],
        createdFrom: ["createdfrom", "createdFrom"],
      };

      const refundRec = record.create({
        type: record.Type.CUSTOMER_REFUND,
        isDynamic: true,
      });

      const bodyResult = setMappedBodyFields(refundRec, effectivePayload, fieldAliasMap, [
        "customform",
        "paymentMethod",
        "paymentmethod",
        "paymentOption",
        "paymentoption",
        "customer",
        "entity",
        "account",
        "createdfrom",
        "createdFrom",
      ]);
      bodyResult.ignored = ignoredBodyFields;
      const explicitApplyResult = effectivePayload.apply ? applyCustomerRefundSublistRows(refundRec, effectivePayload.apply) : { applied: [], failed: [] };
      const applyResult = explicitApplyResult.applied.length
        ? explicitApplyResult
        : context && context.refundSource === "creditMemo"
          ? autoApplyCustomerCredit(refundRec, context || {})
          : autoApplyCustomerDeposit(refundRec, context || {});
      if (!applyResult.applied.length) {
        return {
          ok: false,
          error: context && context.refundSource === "creditMemo"
            ? "No credit memo was applied to the refund."
            : "No customer deposit was applied to the refund.",
          bodyResult,
          applyResult,
          retryMode: options && options.skipPaymentMethod ? "without-payment-method" : "normal",
        };
      }

      let id;
      try {
        id = refundRec.save({
          enableSourcing: true,
          ignoreMandatoryFields: false,
        });
      } catch (saveErr) {
        return {
          ok: false,
          error: saveErr.message || String(saveErr),
          name: saveErr.name || "",
          bodyResult,
          applyResult,
          sublists: customerRefundSublistDebug(refundRec),
          retryMode: options && options.skipPaymentMethod ? "without-payment-method" : "normal",
        };
      }

      const saved = record.load({
        type: record.Type.CUSTOMER_REFUND,
        id,
        isDynamic: false,
      });

      return {
        ok: true,
        id: String(id),
        tranId: String(saved.getValue({ fieldId: "tranid" }) || ""),
        bodyResult,
        applyResult,
        retryMode: options && options.skipPaymentMethod ? "without-payment-method" : "normal",
      };
    }

    const firstAttempt = buildAndSaveCustomerRefund({ skipPaymentMethod: false });
    if (firstAttempt.ok || !/account of a transaction line/i.test(firstAttempt.error || "")) {
      return firstAttempt;
    }

    const secondAttempt = buildAndSaveCustomerRefund({ skipPaymentMethod: true });
    if (secondAttempt.ok) {
      secondAttempt.firstAttempt = firstAttempt;
      return secondAttempt;
    }

    secondAttempt.firstAttempt = firstAttempt;
    return secondAttempt;
  }

  function removeDeletedLines(soRec, deletedLineIds) {
    if (!Array.isArray(deletedLineIds) || !deletedLineIds.length) return [];

    const toRemove = [];

    deletedLineIds.forEach((lineId) => {
      const idx = findLineIndexByInternalLineId(soRec, lineId);
      if (idx >= 0) {
        toRemove.push({ lineId: String(lineId), idx });
      } else {
        log.debug("⚠️ Delete skipped - lineId not found", { lineId });
      }
    });

    toRemove
      .sort((a, b) => b.idx - a.idx)
      .forEach(({ lineId, idx }) => {
        try {
          soRec.removeLine({
            sublistId: "item",
            line: idx,
            ignoreRecalc: false,
          });

          log.audit("🗑 Removed line", { lineId, idx });
        } catch (err) {
          log.error("❌ Failed removing line", { lineId, idx, err });
        }
      });

    return toRemove.map((r) => r.lineId);
  }

  function setCurrentIfDefined(soRec, fieldId, value) {
    if (value === undefined) return;

    soRec.setCurrentSublistValue({
      sublistId: "item",
      fieldId,
      value,
      ignoreFieldChange: false,
    });
  }

  function hasClosedValue(update) {
    return hasOwn(update, "closed") || hasOwn(update, "isClosed") || hasOwn(update, "isclosed");
  }

  function normaliseClosedValue(update) {
    const raw = hasOwn(update, "closed")
      ? update.closed
      : hasOwn(update, "isClosed")
        ? update.isClosed
        : update.isclosed;
    return raw === true || raw === "T" || raw === "true" || raw === "1" || raw === 1;
  }

  function hasOptionsValue(update) {
    return hasOwn(update, "options") || hasOwn(update, "optionsSummary");
  }

  function updateHasPricingValue(update) {
    return hasOwn(update, "rate") ||
      hasOwn(update, "amount") ||
      hasOwn(update, "grossamt") ||
      hasOwn(update, "grossamount") ||
      hasOwn(update, "netamount") ||
      hasOwn(update, "saleGrossPerUnit") ||
      hasOwn(update, "saleGrossLine") ||
      hasOwn(update, "amountGrossLine") ||
      hasOwn(update, "discountPct");
  }

  function currentLinePricingSnapshot(soRec) {
    var snapshot = {};
    ["rate", "amount"].forEach(function (fieldId) {
      try {
        var value = soRec.getCurrentSublistValue({
          sublistId: "item",
          fieldId: fieldId,
        });
        if (value !== null && value !== undefined && String(value).trim() !== "") {
          snapshot[fieldId] = value;
        }
      } catch (e) {
        log.debug("Could not snapshot current line pricing field", { fieldId: fieldId, error: e.message || e });
      }
    });
    return snapshot;
  }

  function restoreCurrentLinePricingIfUnmapped(soRec, update, snapshot) {
    if (updateHasPricingValue(update)) return;
    Object.keys(snapshot || {}).forEach(function (fieldId) {
      try {
        setCurrentIfDefined(soRec, fieldId, snapshot[fieldId]);
      } catch (e) {
        log.debug("Could not restore current line pricing field", { fieldId: fieldId, value: snapshot[fieldId], error: e.message || e });
      }
    });
  }

  function reservedLineUpdateKeys() {
    return {
      lineId: true,
      line: true,
      lineUniqueKey: true,
      lineuniquekey: true,
      suiteQlLineId: true,
      itemId: true,
      item: true,
      lineIndex: true,
      isNew: true,
      clientLineKey: true,
      options: true,
      optionsSummary: true,
      closed: true,
      isClosed: true,
    };
  }

  function normaliseMappedLineFieldValue(fieldId, value) {
    if (fieldId === "isclosed" || fieldId === "closed") {
      return value === true ||
        value === "T" ||
        value === "true" ||
        value === "1" ||
        value === 1 ||
        String(value || "").toLowerCase() === "checked";
    }
    if (value && typeof value === "object") {
      return value.id || value.value || value.refName || "";
    }
    if (isAmountLikeMappedLineField(fieldId)) {
      var numeric = Number(String(value || "").replace(/,/g, ""));
      if (!isNaN(numeric) && isFinite(numeric)) return Math.abs(numeric);
    }
    return value;
  }

  function isAmountLikeMappedLineField(fieldId) {
    var clean = String(fieldId || "").toLowerCase();
    return clean === "amount" ||
      clean === "grossamt" ||
      clean === "grossamount" ||
      clean === "netamount" ||
      clean === "rate" ||
      clean === "price" ||
      clean === "taxamount" ||
      clean === "tax1amt";
  }

  function mappedLineFieldEntries(update) {
    const reserved = reservedLineUpdateKeys();
    const order = {
      price: 5,
      rate: 10,
      amount: 20,
      grossamt: 30,
      isclosed: 100,
      closed: 100,
    };
    return Object.keys(update || {})
      .filter((fieldId) => !reserved[fieldId])
      .filter((fieldId) => update[fieldId] !== undefined)
      .map((fieldId) => ({
        fieldId: fieldId === "closed" ? "isclosed" : fieldId,
        value: normaliseMappedLineFieldValue(fieldId, update[fieldId]),
      }))
      .sort((a, b) => (order[a.fieldId] || 50) - (order[b.fieldId] || 50));
  }

  function entryNeedsCustomPriceLevel(entry) {
    var clean = String(entry && entry.fieldId || "").toLowerCase();
    return clean === "rate" ||
      clean === "amount" ||
      clean === "grossamt" ||
      clean === "grossamount" ||
      clean === "netamount";
  }

  function setCurrentCustomPriceLevel(soRec) {
    try {
      setCurrentIfDefined(soRec, "price", -1);
    } catch (e) {
      log.debug("Could not set workflow line price level to custom", e.message || e);
    }
  }

  function applyMappedCurrentLineFields(soRec, update) {
    const entries = mappedLineFieldEntries(update);
    log.debug("Workflow mapped current line fields", entries);
    if (entries.some(entryNeedsCustomPriceLevel)) {
      setCurrentCustomPriceLevel(soRec);
    }
    entries.forEach((entry) => {
      setCurrentIfDefined(soRec, entry.fieldId, entry.value);
    });
  }

  function applyMappedStaticLineFields(transactionRec, update, line) {
    const entries = mappedLineFieldEntries(update);
    log.debug("Workflow mapped static line fields", { line, entries });
    entries.forEach((entry) => {
      transactionRec.setSublistValue({
        sublistId: "item",
        fieldId: entry.fieldId,
        line,
        value: entry.value,
      });
    });
  }

  function clearCurrentField(soRec, fieldId) {
    try {
      soRec.setCurrentSublistValue({
        sublistId: "item",
        fieldId,
        value: "",
        ignoreFieldChange: false,
      });
    } catch (e) {
      log.debug("⚠️ Could not clear current field", {
        fieldId,
        error: e.message || e,
      });
    }
  }

  function lotDetailsFromInventoryDetail(inventoryDetail) {
    return String(inventoryDetail || "")
      .split(";")
      .map((part) => {
        const tokens = String(part || "").split("|");
        return [
          tokens[2] || "",
          tokens[4] || "",
          tokens.length > 6 ? tokens[tokens.length - 1] || "" : tokens[6] || "",
        ]
          .map((token) => String(token || "").trim())
          .join("|");
      })
      .filter((part) => part.replace(/\|/g, "").trim())
      .join(";");
  }

  function fillMissingLotDetailLocations(lotDetails, inventoryDetail) {
    const normalized = String(lotDetails || "").trim();
    if (!normalized) return lotDetailsFromInventoryDetail(inventoryDetail);

    const inventoryParts = String(inventoryDetail || "")
      .split(";")
      .map((part) => String(part || "").split("|"));

    return normalized
      .split(";")
      .map((part, index) => {
        const tokens = String(part || "").split("|");
        const source = inventoryParts[index] || [];
        return [
          tokens[0] || source[2] || "",
          tokens[1] || source[4] || "",
          tokens[2] || (source.length > 6 ? source[source.length - 1] : source[6]) || "",
        ]
          .map((token) => String(token || "").trim())
          .join("|");
      })
      .filter((part) => part.replace(/\|/g, "").trim())
      .join(";");
  }

  function applyLotDetailsToCurrentLine(soRec, lotDetails, inventoryDetail) {
    const value = fillMissingLotDetailLocations(lotDetails, inventoryDetail);

    if (value) {
      setCurrentIfDefined(soRec, "custcol_sb_lot_details", value);
    } else if (inventoryDetail === null || inventoryDetail === "") {
      clearCurrentField(soRec, "custcol_sb_lot_details");
    }
  }

  function applyInventoryDetailToCurrentLine(
    soRec,
    inventoryDetail,
    warehouseId,
    warehouseTextNorm
  ) {
    if (inventoryDetail === null || inventoryDetail === "") {
      clearCurrentField(soRec, "custcol_sb_epos_inventory_meta");
      clearCurrentField(soRec, "custcol_sb_lotnumber");
      clearCurrentField(soRec, "custcol_sb_lot_details");

      log.debug("🔧 Current line inventory cleared", { inventoryDetail });
      return;
    }

    const allocs = parseInventoryMeta(inventoryDetail);

    const allWarehouse =
      allocs.length > 0 &&
      allocs.every((a) => {
        const locIdMatch =
          a.locId && warehouseId && String(a.locId) === String(warehouseId);

        const locNameNorm = norm(a.locName);
        const locNameMatch =
          !locIdMatch &&
          locNameNorm &&
          warehouseTextNorm &&
          (locNameNorm === warehouseTextNorm ||
            locNameNorm.includes(warehouseTextNorm) ||
            warehouseTextNorm.includes(locNameNorm));

        return locIdMatch || locNameMatch;
      });

    const invIds = [
      ...new Set(
        allocs.map((a) => String(a.invId || "").trim()).filter(Boolean)
      ),
    ];

    const canSetLot = allWarehouse && invIds.length === 1;

    if (canSetLot) {
      const invId = invIds[0];

      setCurrentIfDefined(soRec, "custcol_sb_lotnumber", invId);
      clearCurrentField(soRec, "custcol_sb_epos_inventory_meta");

      log.debug("🔧 Current line inventory applied as lot only", {
        warehouseId,
        lotnumber: invId,
      });
    } else {
      setCurrentIfDefined(
        soRec,
        "custcol_sb_epos_inventory_meta",
        inventoryDetail
      );
      clearCurrentField(soRec, "custcol_sb_lotnumber");

      log.debug("🔧 Current line inventory applied as meta", {
        warehouseId,
        allWarehouse,
        invIds,
      });
    }
  }

  function applyPricingToCurrentLine(soRec, u, isNewLine) {
    const qty =
      toNum(
        soRec.getCurrentSublistValue({
          sublistId: "item",
          fieldId: "quantity",
        })
      ) || 0;

    const currentRateNet =
      toNum(
        soRec.getCurrentSublistValue({
          sublistId: "item",
          fieldId: "rate",
        })
      ) || 0;

    const discountPct = toNum(u.discountPct);
    const payloadTaxCode = u.taxCode != null ? u.taxCode : u.taxcode;
    let currentTaxCode = "";
    try {
      currentTaxCode = soRec.getCurrentSublistValue({
        sublistId: "item",
        fieldId: "taxcode",
      });
    } catch (taxErr) {
      log.debug("Could not read current line taxcode", taxErr);
    }
    const grossDivisor = isVatFreeTaxCode(payloadTaxCode || currentTaxCode)
      ? 1
      : GROSS_DIVISOR;
    const saleGrossInput =
      u.saleGrossPerUnit != null ? u.saleGrossPerUnit : u.saleGrossLine;
    const saleGrossValue = toNum(saleGrossInput);
    const hasSaleGrossInput =
      saleGrossInput !== undefined &&
      saleGrossInput !== null &&
      String(saleGrossInput).trim() !== "";

    let newRateNet = null;

    if (hasSaleGrossInput && Number.isFinite(saleGrossValue) && qty > 0) {
      const saleGrossPerUnit = saleGrossValue / qty;
      newRateNet = saleGrossPerUnit / grossDivisor;
    } else if (discountPct > 0 && currentRateNet > 0) {
      const d = Math.max(0, Math.min(100, discountPct));
      newRateNet = currentRateNet * (1 - d / 100);
    } else if (isNewLine && toNum(u.amountGrossLine) > 0 && qty > 0) {
      const amountGrossPerUnit = toNum(u.amountGrossLine) / qty;
      newRateNet = amountGrossPerUnit / grossDivisor;
    }

    if (newRateNet !== null && Number.isFinite(newRateNet)) {
      setCurrentIfDefined(soRec, "rate", +newRateNet.toFixed(6));

      if (qty > 0) {
        setCurrentIfDefined(soRec, "amount", +(newRateNet * qty).toFixed(6));
      }

      log.debug("💷 Pricing applied on current line", {
        currentRateNet,
        newRateNet,
        qty,
        discountPct,
        saleGrossInput,
        taxCode: payloadTaxCode || currentTaxCode,
        grossDivisor,
        isNewLine,
      });
    }
  }

  function applyLineValues(soRec, u, warehouseId, warehouseTextNorm, isNewLine) {
    const optionsValue = u.options !== undefined ? u.options : u.optionsSummary;

    if (isNewLine) {
      if (!u.itemId) {
        throw error.create({
          name: "MISSING_ITEM",
          message: "New line is missing itemId.",
        });
      }

      setCurrentIfDefined(soRec, "item", String(u.itemId));
    }

    if (u.quantity != null && String(u.quantity).trim() !== "") {
      setCurrentIfDefined(soRec, "quantity", toNum(u.quantity));
    }

    if (u.fulfilmentMethod !== undefined) {
      if (u.fulfilmentMethod) {
        setCurrentIfDefined(
          soRec,
          "custcol_sb_fulfilmentlocation",
          String(u.fulfilmentMethod)
        );
      } else {
        clearCurrentField(soRec, "custcol_sb_fulfilmentlocation");
      }
    }

    if (optionsValue !== undefined) {
      setCurrentIfDefined(
        soRec,
        "custcol_sb_itemoptionsdisplay",
        String(optionsValue || "")
      );
    }

    if (hasOwn(u, "custcol_sb_30nighttrialoption") || hasOwn(u, "trialOption")) {
      const trialOptionId = normaliseTrialOptionId(
        hasOwn(u, "custcol_sb_30nighttrialoption")
          ? u.custcol_sb_30nighttrialoption
          : u.trialOption
      );
      if (trialOptionId) {
        setCurrentIfDefined(soRec, "custcol_sb_30nighttrialoption", trialOptionId);
      } else {
        clearCurrentField(soRec, "custcol_sb_30nighttrialoption");
      }
    }

    if (u.inventoryDetail !== undefined) {
      try {
        applyInventoryDetailToCurrentLine(
          soRec,
          u.inventoryDetail,
          warehouseId,
          warehouseTextNorm
        );
        applyLotDetailsToCurrentLine(soRec, u.lotDetails, u.inventoryDetail);
      } catch (invErr) {
        log.error("⚠️ Inventory detail parse/apply failed on current line", invErr);

        if (u.inventoryDetail) {
          setCurrentIfDefined(
            soRec,
            "custcol_sb_epos_inventory_meta",
            String(u.inventoryDetail)
          );
          applyLotDetailsToCurrentLine(soRec, u.lotDetails, u.inventoryDetail);
        }
      }
    }

    applyPricingToCurrentLine(soRec, u, isNewLine);
  }

  function creditReturnAuthorization(context) {
    var returnAuthorizationId = Number(context.returnAuthorizationId || context.id || 0);
    if (!returnAuthorizationId) {
      throw error.create({
        name: "MISSING_RETURN_AUTHORIZATION",
        message: "Return Authorisation ID is required.",
      });
    }

    var creditMemoRec = record.transform({
      fromType: record.Type.RETURN_AUTHORIZATION,
      fromId: returnAuthorizationId,
      toType: record.Type.CREDIT_MEMO,
      isDynamic: false,
    });

    if (context.memo !== undefined) {
      try {
        creditMemoRec.setValue({
          fieldId: "memo",
          value: String(context.memo || ""),
        });
      } catch (memoErr) {
        log.debug("Could not set Credit Memo memo during RMA credit", memoErr.message || memoErr);
      }
    }

    var creditMemoId = creditMemoRec.save({
      enableSourcing: true,
      ignoreMandatoryFields: false,
    });

    var tranId = "";
    try {
      var lookup = search.lookupFields({
        type: search.Type.CREDIT_MEMO,
        id: creditMemoId,
        columns: ["tranid"],
      });
      tranId = String((lookup && lookup.tranid) || "");
    } catch (lookupErr) {
      tranId = String(creditMemoId);
    }

    return {
      ok: true,
      id: String(creditMemoId),
      tranId: tranId || String(creditMemoId),
      returnAuthorizationId: String(returnAuthorizationId),
      transformed: true,
      recordType: "creditMemo",
    };
  }

  function cleanReceiptLotAssignments(assignments) {
    return (Array.isArray(assignments) ? assignments : [])
      .map(function (assignment) {
        return {
          itemId: String(assignment.itemId || assignment.item || "").trim(),
          quantity: Number(assignment.quantity || assignment.qty || 0) || 0,
          inventoryNumberId: String(assignment.inventoryNumberId || assignment.lotNumberId || assignment.lot || "").trim(),
          inventoryNumberName: String(assignment.inventoryNumberName || assignment.lotNumberName || assignment.lotName || "").trim(),
          inventoryStatusId: String(assignment.inventoryStatusId || assignment.statusId || "").trim(),
          locationId: String(assignment.locationId || "").trim(),
        };
      })
      .filter(function (assignment) {
        return assignment.itemId && assignment.inventoryNumberId;
      });
  }

  function receiptAssignmentMap(assignments) {
    return cleanReceiptLotAssignments(assignments).reduce(function (map, assignment) {
      if (!map[assignment.itemId]) map[assignment.itemId] = [];
      map[assignment.itemId].push(assignment);
      return map;
    }, {});
  }

  function getSublistValueSafe(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistValue({
        sublistId: sublistId,
        fieldId: fieldId,
        line: line,
      });
    } catch (err) {
      return "";
    }
  }

  function getAssignmentValueSafe(inventoryDetail, line, fieldId) {
    try {
      return inventoryDetail.getSublistValue({
        sublistId: "inventoryassignment",
        fieldId: fieldId,
        line: line,
      });
    } catch (err) {
      return "";
    }
  }

  function inventoryNumberNameFromId(inventoryNumberId) {
    var id = String(inventoryNumberId || "").trim();
    if (!id) return "";
    try {
      var lookup = search.lookupFields({
        type: search.Type.INVENTORY_NUMBER,
        id: id,
        columns: ["inventorynumber"],
      });
      return String((lookup && lookup.inventorynumber) || "").trim();
    } catch (err) {
      log.debug("Could not resolve inventory number name", {
        inventoryNumberId: id,
        error: err.message || err,
      });
      return "";
    }
  }

  function salesOrderLotAssignmentsFromInventoryDetail(salesOrderId) {
    var id = Number(salesOrderId || 0);
    if (!id) return [];

    var soRec = record.load({
      type: record.Type.SALES_ORDER,
      id: id,
      isDynamic: false,
    });
    var lineCount = soRec.getLineCount({ sublistId: "item" });
    var assignments = [];

    for (var line = 0; line < lineCount; line += 1) {
      var itemId = String(getSublistValueSafe(soRec, "item", "item", line) || "").trim();
      if (!itemId) continue;

      var inventoryDetail;
      try {
        inventoryDetail = soRec.getSublistSubrecord({
          sublistId: "item",
          fieldId: "inventorydetail",
          line: line,
        });
      } catch (detailErr) {
        continue;
      }
      if (!inventoryDetail) continue;

      var assignmentCount = inventoryDetail.getLineCount({
        sublistId: "inventoryassignment",
      });
      for (var assignmentLine = 0; assignmentLine < assignmentCount; assignmentLine += 1) {
        var inventoryNumberId =
          getAssignmentValueSafe(inventoryDetail, assignmentLine, "issueinventorynumber") ||
          getAssignmentValueSafe(inventoryDetail, assignmentLine, "receiptinventorynumber");
        if (!inventoryNumberId) continue;
        assignments.push({
          itemId: itemId,
          sourceLine: line,
          quantity: Number(getAssignmentValueSafe(inventoryDetail, assignmentLine, "quantity") || 0) || 0,
          inventoryNumberId: String(inventoryNumberId),
          inventoryNumberName: inventoryNumberNameFromId(inventoryNumberId),
          inventoryStatusId: String(getAssignmentValueSafe(inventoryDetail, assignmentLine, "inventorystatus") || ""),
          binNumberId: String(getAssignmentValueSafe(inventoryDetail, assignmentLine, "binnumber") || ""),
        });
      }
    }

    return assignments;
  }

  function clearInventoryAssignments(inventoryDetail) {
    var count = inventoryDetail.getLineCount({ sublistId: "inventoryassignment" });
    for (var line = count - 1; line >= 0; line -= 1) {
      inventoryDetail.removeLine({
        sublistId: "inventoryassignment",
        line: line,
      });
    }
  }

  function setReceiptInventoryAssignments(receiptRec, line, assignments, lineQuantity) {
    var inventoryDetail = receiptRec.getSublistSubrecord({
      sublistId: "item",
      fieldId: "inventorydetail",
      line: line,
    });
    clearInventoryAssignments(inventoryDetail);

    var remainingQuantity = Number(lineQuantity || 0) || 0;
    var assignmentLine = 0;
    assignments.forEach(function (assignment) {
      if (remainingQuantity <= 0 && lineQuantity > 0) return;
      var quantity = Number(assignment.quantity || 0) || remainingQuantity || 1;
      if (remainingQuantity > 0 && quantity > remainingQuantity) quantity = remainingQuantity;
      inventoryDetail.insertLine({
        sublistId: "inventoryassignment",
        line: assignmentLine,
      });
      var inventoryNumberName = String(assignment.inventoryNumberName || "").trim();
      if (inventoryNumberName) {
        try {
          inventoryDetail.setSublistText({
            sublistId: "inventoryassignment",
            fieldId: "receiptinventorynumber",
            line: assignmentLine,
            text: inventoryNumberName,
          });
        } catch (textErr) {
          log.debug("Could not set receipt inventory number by text; falling back to value", {
            inventoryNumberId: assignment.inventoryNumberId,
            inventoryNumberName: inventoryNumberName,
            error: textErr.message || textErr,
          });
          inventoryDetail.setSublistValue({
            sublistId: "inventoryassignment",
            fieldId: "receiptinventorynumber",
            line: assignmentLine,
            value: Number(assignment.inventoryNumberId),
          });
        }
      } else {
        inventoryDetail.setSublistValue({
          sublistId: "inventoryassignment",
          fieldId: "receiptinventorynumber",
          line: assignmentLine,
          value: Number(assignment.inventoryNumberId),
        });
      }
      if (assignment.inventoryStatusId) {
        inventoryDetail.setSublistValue({
          sublistId: "inventoryassignment",
          fieldId: "inventorystatus",
          line: assignmentLine,
          value: Number(assignment.inventoryStatusId),
        });
      }
      inventoryDetail.setSublistValue({
        sublistId: "inventoryassignment",
        fieldId: "quantity",
        line: assignmentLine,
        value: quantity,
      });
      if (remainingQuantity > 0) remainingQuantity -= quantity;
      assignmentLine += 1;
    });
  }

  function receiveReturnAuthorization(context) {
    var returnAuthorizationId = Number(context.returnAuthorizationId || context.id || 0);
    if (!returnAuthorizationId) {
      throw error.create({
        name: "MISSING_RETURN_AUTHORIZATION",
        message: "Return Authorisation ID is required.",
      });
    }

    var lotAssignments = cleanReceiptLotAssignments(context.lotAssignments || []);
    var lotAssignmentSource = "payload";
    if (!lotAssignments.length && context.pairedSalesOrderId) {
      lotAssignments = salesOrderLotAssignmentsFromInventoryDetail(context.pairedSalesOrderId);
      lotAssignmentSource = "pairedSalesOrderInventoryDetail";
    }
    lotAssignments = lotAssignments.map(function (assignment) {
      if (assignment.inventoryNumberName) return assignment;
      assignment.inventoryNumberName = inventoryNumberNameFromId(assignment.inventoryNumberId);
      return assignment;
    });
    var assignmentsByItem = receiptAssignmentMap(lotAssignments);
    var receiptRec = record.transform({
      fromType: record.Type.RETURN_AUTHORIZATION,
      fromId: returnAuthorizationId,
      toType: record.Type.ITEM_RECEIPT,
      isDynamic: false,
    });

    if (context.memo !== undefined) {
      try {
        receiptRec.setValue({
          fieldId: "memo",
          value: String(context.memo || ""),
        });
      } catch (memoErr) {
        log.debug("Could not set Item Receipt memo during RMA receipt", memoErr.message || memoErr);
      }
    }

    var lineCount = receiptRec.getLineCount({ sublistId: "item" });
    var applied = [];
    var missing = [];
    for (var line = 0; line < lineCount; line += 1) {
      var itemId = String(receiptRec.getSublistValue({
        sublistId: "item",
        fieldId: "item",
        line: line,
      }) || "").trim();
      var lineQuantity = Number(receiptRec.getSublistValue({
        sublistId: "item",
        fieldId: "quantity",
        line: line,
      }) || 0) || 0;
      var inventoryDetailAvailable = false;
      try {
        var inventoryDetailAvailValue = receiptRec.getSublistValue({
          sublistId: "item",
          fieldId: "inventorydetailavail",
          line: line,
        });
        inventoryDetailAvailable = inventoryDetailAvailValue === true || inventoryDetailAvailValue === "T";
      } catch (detailAvailErr) {
        inventoryDetailAvailable = false;
      }

      try {
        receiptRec.setSublistValue({
          sublistId: "item",
          fieldId: "itemreceive",
          line: line,
          value: true,
        });
      } catch (receiveErr) {
        log.debug("Could not force itemreceive on RMA receipt line", {
          line: line,
          itemId: itemId,
          error: receiveErr.message || receiveErr,
        });
      }

      var lineAssignments = assignmentsByItem[itemId] || [];
      if (!lineAssignments.length) {
        if (inventoryDetailAvailable) {
          missing.push({ line: line, itemId: itemId, reason: "No matching lot assignment from paired Sales Order." });
        }
        continue;
      }

      try {
        setReceiptInventoryAssignments(receiptRec, line, lineAssignments, lineQuantity);
        applied.push({
          line: line,
          itemId: itemId,
          quantity: lineQuantity,
          lots: lineAssignments.map(function (assignment) {
            return {
              id: assignment.inventoryNumberId,
              name: assignment.inventoryNumberName || "",
            };
          }),
        });
      } catch (assignErr) {
        missing.push({ line: line, itemId: itemId, reason: assignErr.message || String(assignErr) });
      }
    }

    if (missing.length) {
      throw error.create({
        name: "RMA_RECEIPT_LOT_ASSIGNMENT_FAILED",
        message: "One or more Item Receipt lines could not be assigned a lot number from " + lotAssignmentSource + ": " + JSON.stringify(missing),
      });
    }

    var itemReceiptId = receiptRec.save({
      enableSourcing: true,
      ignoreMandatoryFields: false,
    });

    var tranId = "";
    try {
      var lookup = search.lookupFields({
        type: search.Type.ITEM_RECEIPT,
        id: itemReceiptId,
        columns: ["tranid"],
      });
      tranId = String((lookup && lookup.tranid) || "");
    } catch (lookupErr) {
      tranId = String(itemReceiptId);
    }

    return {
      ok: true,
      id: String(itemReceiptId),
      tranId: tranId || String(itemReceiptId),
      returnAuthorizationId: String(returnAuthorizationId),
      pairedSalesOrderId: String(context.pairedSalesOrderId || ""),
      transformed: true,
      recordType: "itemReceipt",
      lotAssignmentSource: lotAssignmentSource,
      applied: applied,
    };
  }

  function approveReturnAuthorization(context) {
    var returnAuthorizationId = Number(context.returnAuthorizationId || context.id || 0);
    if (!returnAuthorizationId) {
      throw error.create({
        name: "MISSING_RETURN_AUTHORIZATION",
        message: "Return Authorisation ID is required.",
      });
    }

    record.submitFields({
      type: record.Type.RETURN_AUTHORIZATION,
      id: returnAuthorizationId,
      values: {
        orderstatus: String(context.orderstatus || context.orderStatus || "B"),
      },
      options: {
        enableSourcing: true,
        ignoreMandatoryFields: false,
      },
    });

    return {
      ok: true,
      id: String(returnAuthorizationId),
      recordType: "returnAuthorization",
      approved: true,
      orderstatus: String(context.orderstatus || context.orderStatus || "B"),
    };
  }

  const post = (context) => {
    try {
      log.audit("🔁 RESTlet Triggered", context);

      if (context && context.action === "createCustomerRefund") {
        return createCustomerRefund(context);
      }

      if (context && context.action === "creditReturnAuthorization") {
        return creditReturnAuthorization(context);
      }

      if (context && context.action === "receiveReturnAuthorization") {
        return receiveReturnAuthorization(context);
      }

      if (context && context.action === "approveReturnAuthorization") {
        return approveReturnAuthorization(context);
      }

      if (!context.id) {
        throw error.create({
          name: "MISSING_ID",
          message: "Transaction ID (context.id) is required.",
        });
      }

      const id = Number(context.id);
      const doCommit = context.commit !== false;
      const requestedRecordType = norm(context.recordType).replace(/[^a-z]/g, "");
      const isPurchaseOrder = requestedRecordType === "purchaseorder";
      const transactionRecordType = isPurchaseOrder
        ? record.Type.PURCHASE_ORDER
        : record.Type.SALES_ORDER;

      if (context.workflowEmailAction === true) {
        const emailMessage = String(context.message == null ? "" : context.message);
        const emailRec = record.load({
          type: transactionRecordType,
          id,
          isDynamic: false,
        });
        const emailResult = sendWorkflowTransactionEmail(emailRec, id, isPurchaseOrder, emailMessage);

        return {
          ok: true,
          id,
          recordType: isPurchaseOrder ? "purchaseOrder" : "salesOrder",
          triggered: true,
          triggerType: "EMAIL",
          message: "Workflow email sent",
          email: emailResult,
        };
      }

      const lines = Array.isArray(context.lines) ? context.lines : [];
      const deletedLineIds = Array.isArray(context.deletedLineIds)
        ? context.deletedLineIds
        : [];

      const updates = Array.isArray(context.updates) ? context.updates : lines;

      if (context.triggerPoItemSet === true && isPurchaseOrder) {
        record.submitFields({
          type: record.Type.PURCHASE_ORDER,
          id,
          values: {
            memo: String(context.memo == null ? "" : context.memo),
          },
          options: {
            enableSourcing: false,
            ignoreMandatoryFields: true,
          },
        });

        return {
          ok: true,
          id,
          recordType: "purchaseOrder",
          triggered: true,
          triggerType: "XEDIT",
          message: "Purchase Order item-copy User Event triggered",
        };
      }

      log.audit("📦 Loading Sales Order (dynamic mode)", {
        id,
        doCommit,
        lineCount: updates.length,
        deletedLineIds,
      });

      const soRec = record.load({
        type: transactionRecordType,
        id,
        isDynamic: !isPurchaseOrder,
      });

      if (context.optionsOnly === true && isPurchaseOrder) {
        setBodyValueIfPossible(soRec, "suppressusereventsandemails", true);
        setBodyValueIfPossible(soRec, "intercosuppressusereventsandemails", true);
        const optionsUpdate = updateOptionsOnlyStatic(soRec, updates);
        if (optionsUpdate.failures.length) {
          log.error("Purchase Order item options-only update failed", optionsUpdate.failures);
          return {
            ok: false,
            id,
            recordType: "purchaseOrder",
            committed: false,
            optionsOnly: true,
            updatedLines: optionsUpdate.results,
            failures: optionsUpdate.failures,
            error: "The Purchase Order item options line could not be updated.",
          };
        }

        const savedId = soRec.save({
          enableSourcing: false,
          ignoreMandatoryFields: true,
        });

        return {
          ok: true,
          id: savedId,
          recordType: "purchaseOrder",
          committed: false,
          optionsOnly: true,
          updatedLines: optionsUpdate.results,
          message: "Purchase Order item options updated",
        };
      }

      const orderStatusValue = soRec.getValue({ fieldId: "orderstatus" });
      const orderStatusText = soRec.getText({ fieldId: "orderstatus" });
      const headerUpdates =
        context.headerUpdates && typeof context.headerUpdates === "object"
          ? context.headerUpdates
          : {};

      if (
        !doCommit &&
        !isPendingApprovalStatus(orderStatusValue) &&
        !isPendingApprovalStatus(orderStatusText) &&
        hasOwn(headerUpdates, "memo")
      ) {
        const memo = headerUpdates.memo || "";
        let pairedMemoSync = {
          ok: true,
          skipped: true,
          reason: "not-attempted",
        };

        record.submitFields({
          type: record.Type.SALES_ORDER,
          id,
          values: { memo },
          options: {
            enableSourcing: false,
            ignoreMandatoryFields: true,
          },
        });

        try {
          pairedMemoSync = syncPairedSalesOrderMemo(soRec, memo);
        } catch (pairedErr) {
          log.error("⚠️ Failed to update paired Sales Order memo", pairedErr);
          pairedMemoSync = {
            ok: false,
            skipped: false,
            error: pairedErr.message || String(pairedErr),
          };
        }

        log.audit("💾 Processed Sales Order memo updated without line save", {
          id,
          orderStatusValue,
          orderStatusText,
          pairedMemoSync,
        });

        return {
          ok: true,
          id,
          message: "✅ Sales Order memo updated (save-only)",
          updatesApplied: 0,
          deletedLineIds,
          removedLineIds: [],
          committed: false,
          memoOnly: true,
          pairedMemoSync,
        };
      }

      if (context.headerUpdates && typeof context.headerUpdates === "object") {
        const { leadSource, paymentInfo, warehouse, salesExec, memo } =
          context.headerUpdates;

        try {
          if (leadSource !== undefined && leadSource !== null && leadSource !== "") {
            soRec.setValue({
              fieldId: "leadsource",
              value: leadSource,
            });

            log.debug("🧾 Header", `Set leadsource = ${leadSource}`);
          }

          if (
            paymentInfo !== undefined &&
            paymentInfo !== null &&
            paymentInfo !== ""
          ) {
            soRec.setValue({
              fieldId: "custbody_sb_paymentinfo",
              value: paymentInfo,
            });

            log.debug(
              "🧾 Header",
              `Set custbody_sb_paymentinfo = ${paymentInfo}`
            );
          }

          if (warehouse !== undefined && warehouse !== null && warehouse !== "") {
            soRec.setValue({
              fieldId: "custbody_sb_warehouse",
              value: warehouse,
            });

            log.debug("🧾 Header", `Set custbody_sb_warehouse = ${warehouse}`);
          }

          if (salesExec !== undefined && salesExec !== null && salesExec !== "") {
            soRec.setValue({
              fieldId: "custbody_sb_bedspecialist",
              value: salesExec,
            });

            log.debug(
              "🧾 Header",
              `Set custbody_sb_bedspecialist = ${salesExec}`
            );
          }

          if (memo !== undefined) {
            soRec.setValue({
              fieldId: "memo",
              value: memo || "",
            });

            log.debug("🧾 Header", `Set memo = ${memo || ""}`);
          }
        } catch (hdrErr) {
          log.error("⚠️ Failed to apply headerUpdates", hdrErr);
        }
      }

      let warehouseId = "";
      let warehouseText = "";

      try {
        warehouseId = String(
          soRec.getValue({ fieldId: "custbody_sb_warehouse" }) || ""
        ).trim();

        warehouseText = String(
          soRec.getText({ fieldId: "custbody_sb_warehouse" }) || ""
        ).trim();
      } catch (e) {
        log.error("⚠️ Could not read custbody_sb_warehouse", e);
      }

      const warehouseTextNorm = norm(warehouseText);

      if (context.optionsOnly === true) {
        const optionsUpdate = updateOptionsOnly(soRec, updates);
        if (optionsUpdate.failures.length) {
          log.error("Item options-only update failed", optionsUpdate.failures);
          return {
            ok: false,
            id,
            committed: false,
            optionsOnly: true,
            updatedLines: optionsUpdate.results,
            failures: optionsUpdate.failures,
            error: "One or more item option lines could not be updated.",
          };
        }

        const savedId = soRec.save({
          enableSourcing: false,
          ignoreMandatoryFields: true,
        });

        log.audit("Item options-only update saved", {
          id: savedId,
          updatedLines: optionsUpdate.results,
        });

        return {
          ok: true,
          id: savedId,
          committed: false,
          optionsOnly: true,
          updatedLines: optionsUpdate.results,
          message: "Item options updated",
        };
      }

      const removedLineIds = removeDeletedLines(soRec, deletedLineIds);
      const processedLines = [];

      if (Array.isArray(updates) && updates.length) {
        log.audit(
          `🧾 Processing ${updates.length} line payload entries after deletions`,
          { id, removedLineIds }
        );

        updates.forEach((u) => {
          try {
            const isNewLine = !u.lineId || u.isNew === true;

            if (isNewLine) {
              if (!u.itemId) {
                log.debug("⚠️ New line skipped - missing itemId", u);
                return;
              }

              soRec.selectNewLine({ sublistId: "item" });

              applyLineValues(soRec, u, warehouseId, warehouseTextNorm, true);
              applyMappedCurrentLineFields(soRec, u);

              soRec.commitLine({ sublistId: "item" });
              const insertedLineIndex = getItemLineCount(soRec) - 1;
              soRec.selectLine({ sublistId: "item", line: insertedLineIndex });
              applyMappedCurrentLineFields(soRec, u);
              soRec.commitLine({ sublistId: "item" });

              processedLines.push({
                clientLineKey: u.clientLineKey,
                lineIndex: insertedLineIndex,
                lineId: String(safeGetSublistValue(soRec, "line", insertedLineIndex) || ""),
                lineUniqueKey: String(
                  safeGetSublistValue(soRec, "lineuniquekey", insertedLineIndex) || ""
                ),
                itemId: String(u.itemId || ""),
                isNew: true,
              });

              log.audit("✅ New line inserted", {
                itemId: u.itemId,
                quantity: u.quantity,
                fulfilmentMethod: u.fulfilmentMethod,
              });

              return;
            }

            const targetLine = findLineIndexByInternalLineId(soRec, u.lineId);

            if (targetLine < 0) {
              log.debug("⚠️ Existing line not found for update", u);
              return;
            }

            soRec.selectLine({
              sublistId: "item",
              line: targetLine,
            });

            log.debug(`🔎 Before update [Line ${targetLine}]`, {
              internalLineId: u.lineId,
              currentItem: soRec.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "item",
              }),
              fulfilment: soRec.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "custcol_sb_fulfilmentlocation",
              }),
              invMeta: soRec.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "custcol_sb_epos_inventory_meta",
              }),
              lot: soRec.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "custcol_sb_lotnumber",
              }),
              options: soRec.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "custcol_sb_itemoptionsdisplay",
              }),
            });

            applyLineValues(soRec, u, warehouseId, warehouseTextNorm, false);

            soRec.commitLine({ sublistId: "item" });
            processedLines.push({
              clientLineKey: u.clientLineKey,
              lineIndex: targetLine,
              lineId: String(safeGetSublistValue(soRec, "line", targetLine) || u.lineId || ""),
              lineUniqueKey: String(safeGetSublistValue(soRec, "lineuniquekey", targetLine) || ""),
              itemId: String(u.itemId || ""),
              isNew: false,
            });

            log.debug(`✅ After update [Line ${targetLine}]`, {
              internalLineId: u.lineId,
              fulfilment: u.fulfilmentMethod,
              inventoryDetail: u.inventoryDetail,
              optionsSummary: u.optionsSummary,
              quantity: u.quantity,
            });
          } catch (lineErr) {
            log.error(
              `⚠️ Failed to process line ${u.lineId || u.itemId || "unknown"}`,
              lineErr
            );
          }
        });
      }

      /**
       * IMPORTANT FIX:
       * Set the approval flag on the loaded record BEFORE save.
       * This avoids saving the SO, then immediately doing submitFields,
       * which can trigger RCRD_HAS_BEEN_CHANGED if workflow/user-event logic
       * modifies the record after the first save.
       */
      if (doCommit) {
        soRec.setValue({
          fieldId: "custbody_sb_epos_approved",
          value: true,
        });
        soRec.setValue({
          fieldId: CUSTOMER_EMAIL_SENT_FIELD,
          value: true,
        });
        soRec.setValue({
          fieldId: "tobeemailed",
          value: true,
        });
        if (context.email) {
          soRec.setValue({
            fieldId: "email",
            value: String(context.email),
          });
        }

        log.audit("✅ Approval flag set before Sales Order save", {
          id,
          fieldId: "custbody_sb_epos_approved",
        });
      } else {
        log.audit("💾 Save-only mode — approval flag NOT set", { id });
      }

      const savedId = soRec.save({
        enableSourcing: true,
        ignoreMandatoryFields: true,
      });
      let updatedLines = snapshotUpdatedLineIdentities(soRec, processedLines);

      try {
        const savedRec = record.load({
          type: transactionRecordType,
          id: savedId,
          isDynamic: false,
        });
        updatedLines = snapshotUpdatedLineIdentities(savedRec, processedLines);
      } catch (identityErr) {
        log.error("⚠️ Could not reload transaction for saved line identities", identityErr);
      }

      let pairedMemoSync = {
        ok: true,
        skipped: true,
        reason: "memo-not-supplied",
      };

      if (hasOwn(headerUpdates, "memo")) {
        try {
          pairedMemoSync = syncPairedSalesOrderMemo(soRec, headerUpdates.memo || "");
        } catch (pairedErr) {
          log.error("⚠️ Failed to update paired Sales Order memo", pairedErr);
          pairedMemoSync = {
            ok: false,
            skipped: false,
            error: pairedErr.message || String(pairedErr),
          };
        }
      }

      log.audit("💾 Sales Order saved with updates", {
        id: savedId,
        doCommit,
        removedLineIds,
        updatesApplied: updates.length || 0,
        updatedLines,
        pairedMemoSync,
      });

      return {
        ok: true,
        id,
        message: doCommit
          ? "✅ Sales Order updated & flagged for approval"
          : "✅ Sales Order updated (save-only, not committed)",
        updatesApplied: updates.length || 0,
        updatedLines,
        deletedLineIds,
        removedLineIds,
        committed: doCommit,
        pairedMemoSync,
      };
    } catch (e) {
      log.error("❌ RESTlet Error", e);

      return {
        ok: false,
        error: e.message || e,
        name: e.name || "",
      };
    }
  };

  const get = () => ({
    ok: true,
    message: "EPOS Approve RESTlet active",
  });

  return { post, get };
});
