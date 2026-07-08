/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/log", "N/error"], (record, log, error) => {
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
      const targetLine = findLineIndexForOptionsUpdate(soRec, u, updates);
      const optionsValue = u.options !== undefined ? u.options : u.optionsSummary;

      if (targetLine < 0) {
        const updateItem = u.item && typeof u.item === "object" ? u.item.id : u.item;
        failures.push({
          lineId: String(u.lineId || u.suiteQlLineId || ""),
          itemId: String(u.itemId || updateItem || ""),
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
        const updateItem = u.item && typeof u.item === "object" ? u.item.id : u.item;
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
        : autoApplyCustomerDeposit(refundRec, context || {});
      if (!applyResult.applied.length) {
        return {
          ok: false,
          error: "No customer deposit was applied to the refund.",
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

  function applyMappedCurrentLineFields(soRec, update) {
    const entries = mappedLineFieldEntries(update);
    log.debug("Workflow mapped current line fields", entries);
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

  const post = (context) => {
    try {
      log.audit("🔁 RESTlet Triggered", context);

      if (context && context.action === "createCustomerRefund") {
        return createCustomerRefund(context);
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

              soRec.commitLine({ sublistId: "item" });
              const insertedLineIndex = getItemLineCount(soRec) - 1;
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
