/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/runtime", "N/log"], (record, runtime, log) => {
  function mapRecordType(recordType) {
    const key = String(recordType || "").trim().toLowerCase();

    const map = {
      inventoryitem: record.Type.INVENTORY_ITEM,
      lotnumberedinventoryitem: record.Type.LOT_NUMBERED_INVENTORY_ITEM,
      lotnumberedinventory: record.Type.LOT_NUMBERED_INVENTORY_ITEM,
      lotnumberedinvtpart: record.Type.LOT_NUMBERED_INVENTORY_ITEM,
      invtpart: record.Type.LOT_NUMBERED_INVENTORY_ITEM,
      servicesaleitem: record.Type.SERVICE_ITEM,
      serviceitem: record.Type.SERVICE_ITEM,
      assemblyitem: record.Type.ASSEMBLY_ITEM,
      noninventorysaleitem: record.Type.NON_INVENTORY_ITEM,
      noninventoryitem: record.Type.NON_INVENTORY_ITEM,
      kititem: record.Type.KIT_ITEM,
    };

    return map[key] || null;
  }

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function toNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function toBool(value) {
    if (typeof value === "boolean") return value;
    const text = String(value || "").trim().toLowerCase();
    return ["true", "t", "1", "y", "yes"].includes(text);
  }

  function getPricingSublistId(currencyId) {
    const hasMultipleCurrencies = runtime.isFeatureInEffect({ feature: "MULTICURRENCY" });
    if (!hasMultipleCurrencies) return "price";
    if (!currencyId) throw new Error("currencyId is required when Multiple Currencies is enabled.");
    return `price${currencyId}`;
  }

  function getPriceLevelText(itemRec, sublistId, line) {
    try {
      return itemRec.getSublistText({ sublistId, fieldId: "pricelevel", line });
    } catch (e) {
      return "";
    }
  }

  function listPriceLevels(itemRec, sublistId) {
    const lineCount = itemRec.getLineCount({ sublistId }) || 0;
    const levels = [];
    for (let line = 0; line < lineCount; line++) {
      levels.push({
        line,
        id: itemRec.getSublistValue({ sublistId, fieldId: "pricelevel", line }),
        name: getPriceLevelText(itemRec, sublistId, line),
      });
    }
    return levels;
  }

  function findPriceLevelLine(itemRec, sublistId, priceLevelId, priceLevelName) {
    const lineCount = itemRec.getLineCount({ sublistId }) || 0;
    const wantedName = normalizeKey(priceLevelName);

    for (let line = 0; line < lineCount; line++) {
      const linePriceLevel = itemRec.getSublistValue({ sublistId, fieldId: "pricelevel", line });
      if (String(linePriceLevel) === String(priceLevelId)) return line;
      if (wantedName && normalizeKey(getPriceLevelText(itemRec, sublistId, line)) === wantedName) return line;
    }

    return -1;
  }

  function getCurrentMatrixPrice(itemRec, sublistId, line, column) {
    try {
      return itemRec.getMatrixSublistValue({ sublistId, fieldId: "price", line, column });
    } catch (e) {
      return null;
    }
  }

  function updateMatrixPrices({
    recType,
    internalId,
    currencyId,
    priceLevelId,
    priceLevelName,
    quantityColumns,
    newPrice,
    saveSourcing,
  }) {
    const sublistId = getPricingSublistId(currencyId);
    const itemRec = record.load({ type: recType, id: internalId, isDynamic: false });
    const targetLine = findPriceLevelLine(itemRec, sublistId, priceLevelId, priceLevelName);

    if (targetLine < 0) {
      throw new Error(
        `Price level ${priceLevelName || priceLevelId} was not found on sublist ${sublistId} for item ${internalId}. Available price levels: ${JSON.stringify(listPriceLevels(itemRec, sublistId))}`
      );
    }

    const results = [];
    quantityColumns.forEach((column) => {
      const beforePrice = getCurrentMatrixPrice(itemRec, sublistId, targetLine, column);
      itemRec.setMatrixSublistValue({
        sublistId,
        fieldId: "price",
        line: targetLine,
        column,
        value: Number(newPrice),
      });
      const afterPrice = getCurrentMatrixPrice(itemRec, sublistId, targetLine, column);
      results.push({
        column,
        oldPrice: beforePrice,
        newPrice: afterPrice != null ? afterPrice : Number(newPrice),
      });
    });

    const savedId = itemRec.save({
      enableSourcing: !!saveSourcing,
      ignoreMandatoryFields: false,
    });

    return {
      success: true,
      mode: "matrix",
      recordType: recType,
      internalId: String(savedId),
      sublistId,
      priceLevelId: String(priceLevelId),
      priceLevelName: priceLevelName || null,
      currencyId: currencyId != null ? String(currencyId) : null,
      updates: results,
    };
  }

  function updateSimpleRate({ recType, internalId, newPrice, saveSourcing }) {
    const itemRec = record.load({ type: recType, id: internalId, isDynamic: false });
    const beforePrice = itemRec.getValue({ fieldId: "rate" });
    itemRec.setValue({ fieldId: "rate", value: Number(newPrice) });

    const savedId = itemRec.save({
      enableSourcing: !!saveSourcing,
      ignoreMandatoryFields: false,
    });

    return {
      success: true,
      mode: "rate",
      recordType: recType,
      internalId: String(savedId),
      oldPrice: beforePrice,
      newPrice: Number(newPrice),
    };
  }

  function normalizeUpdate(input) {
    const internalId = String(input.internalId || "").trim();
    const restName = String(input.recordType || "inventoryItem").trim();
    const recType = mapRecordType(restName);
    const newPrice = toNumber(input.price);
    const priceLevelId = toNumber(input.priceLevelId, 4);
    const priceLevelName = String(input.priceLevelName || "Sale Price").trim();
    const currencyId =
      input.currencyId === undefined || input.currencyId === null || input.currencyId === ""
        ? null
        : toNumber(input.currencyId);
    const forceSimpleRate = toBool(input.forceSimpleRate);
    const saveSourcing = toBool(input.saveSourcing);
    const quantityColumns = Array.isArray(input.quantityColumns) && input.quantityColumns.length
      ? input.quantityColumns.map((column) => toNumber(column)).filter((column) => Number.isInteger(column) && column >= 0)
      : [0, 1];

    if (!internalId) throw new Error("Missing required field: internalId");
    if (!recType) throw new Error(`Unsupported recordType: ${restName}`);
    if (!Number.isFinite(newPrice)) throw new Error("Missing or invalid required field: price");
    if (!quantityColumns.length) throw new Error("No valid quantity columns supplied");

    return {
      internalId,
      restName,
      recType,
      newPrice,
      priceLevelId,
      priceLevelName,
      currencyId,
      quantityColumns,
      forceSimpleRate,
      saveSourcing,
    };
  }

  function processUpdate(input) {
    const update = normalizeUpdate(input || {});
    const hasMultipleCurrencies = runtime.isFeatureInEffect({ feature: "MULTICURRENCY" });
    const hasMultiplePrices = runtime.isFeatureInEffect({ feature: "MULTIPLEPRICES" });
    const hasQuantityPricing = runtime.isFeatureInEffect({ feature: "QUANTITYPRICING" });

    log.audit({
      title: "Campaign batch price update",
      details: {
        internalId: update.internalId,
        restName: update.restName,
        newPrice: update.newPrice,
        priceLevelId: update.priceLevelId,
        priceLevelName: update.priceLevelName,
        currencyId: update.currencyId,
        quantityColumns: update.quantityColumns,
      },
    });

    if ((!hasMultipleCurrencies && !hasMultiplePrices && !hasQuantityPricing) || update.forceSimpleRate) {
      return updateSimpleRate({
        recType: update.recType,
        internalId: update.internalId,
        newPrice: update.newPrice,
        saveSourcing: update.saveSourcing,
      });
    }

    return updateMatrixPrices({
      recType: update.recType,
      internalId: update.internalId,
      currencyId: update.currencyId,
      priceLevelId: update.priceLevelId,
      priceLevelName: update.priceLevelName,
      quantityColumns: update.quantityColumns,
      newPrice: update.newPrice,
      saveSourcing: update.saveSourcing,
    });
  }

  function post(requestBody) {
    const body = requestBody || {};
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const batchId = body.batchId || null;

    if (!updates.length) {
      return {
        success: false,
        mode: "campaign-batch",
        batchId,
        total: 0,
        succeeded: 0,
        failed: 0,
        error: "No updates supplied",
        results: [],
      };
    }

    const results = updates.map((input, index) => {
      try {
        return {
          success: true,
          index,
          clientKey: input.clientKey || null,
          internalId: String(input.internalId || ""),
          itemId: input.itemId || null,
          result: processUpdate(input),
        };
      } catch (e) {
        log.error({
          title: "Campaign batch price update failed",
          details: {
            index,
            internalId: input && input.internalId,
            message: e.message,
            stack: e.stack,
          },
        });

        return {
          success: false,
          index,
          clientKey: input && input.clientKey || null,
          internalId: String(input && input.internalId || ""),
          itemId: input && input.itemId || null,
          error: e.message,
        };
      }
    });

    const failed = results.filter((result) => result.success === false).length;
    return {
      success: failed === 0,
      mode: "campaign-batch",
      batchId,
      total: results.length,
      succeeded: results.length - failed,
      failed,
      results,
    };
  }

  return { post };
});
