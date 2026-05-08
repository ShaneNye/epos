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

  function toNumber(v, fallback = null) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function toBool(v) {
    if (typeof v === "boolean") return v;
    const s = String(v || "").trim().toLowerCase();
    return ["true", "t", "1", "y", "yes"].includes(s);
  }

  function getPricingSublistId(currencyId) {
    const hasMultipleCurrencies = runtime.isFeatureInEffect({
      feature: "MULTICURRENCY",
    });

    if (!hasMultipleCurrencies) return "price";

    if (!currencyId) {
      throw new Error("currencyId is required when Multiple Currencies is enabled.");
    }

    return `price${currencyId}`;
  }

  function getPriceLevelText(itemRec, sublistId, line) {
    try {
      return itemRec.getSublistText({
        sublistId,
        fieldId: "pricelevel",
        line,
      });
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
        id: itemRec.getSublistValue({
          sublistId,
          fieldId: "pricelevel",
          line,
        }),
        name: getPriceLevelText(itemRec, sublistId, line),
      });
    }

    return levels;
  }

  function findPriceLevelLine(itemRec, sublistId, priceLevelId, priceLevelName) {
    const lineCount = itemRec.getLineCount({ sublistId }) || 0;
    const wantedName = normalizeKey(priceLevelName);

    for (let line = 0; line < lineCount; line++) {
      const linePriceLevel = itemRec.getSublistValue({
        sublistId,
        fieldId: "pricelevel",
        line,
      });

      if (String(linePriceLevel) === String(priceLevelId)) {
        return line;
      }

      if (wantedName && normalizeKey(getPriceLevelText(itemRec, sublistId, line)) === wantedName) {
        return line;
      }
    }

    return -1;
  }

  function getCurrentMatrixPrice(itemRec, sublistId, line, column) {
    try {
      return itemRec.getMatrixSublistValue({
        sublistId,
        fieldId: "price",
        line,
        column,
      });
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

    const itemRec = record.load({
      type: recType,
      id: internalId,
      isDynamic: false,
    });

    const targetLine = findPriceLevelLine(itemRec, sublistId, priceLevelId, priceLevelName);
    if (targetLine < 0) {
      const availablePriceLevels = listPriceLevels(itemRec, sublistId);
      throw new Error(
        `Price level ${priceLevelName || priceLevelId} was not found on sublist ${sublistId} for item ${internalId}. Available price levels: ${JSON.stringify(availablePriceLevels)}`
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

  function updateSimpleRate({
    recType,
    internalId,
    newPrice,
    saveSourcing,
  }) {
    const itemRec = record.load({
      type: recType,
      id: internalId,
      isDynamic: false,
    });

    const beforePrice = itemRec.getValue({ fieldId: "rate" });

    itemRec.setValue({
      fieldId: "rate",
      value: Number(newPrice),
    });

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

  function post(requestBody) {
    try {
      const body = requestBody || {};

      const internalId = String(body.internalId || "").trim();
      const restName = String(body.recordType || "inventoryItem").trim();
      const recType = mapRecordType(restName);
      const newPrice = toNumber(body.price);
      const priceLevelId = toNumber(body.priceLevelId, 1);
      const priceLevelName = String(body.priceLevelName || "").trim();
      const currencyId =
        body.currencyId === undefined || body.currencyId === null || body.currencyId === ""
          ? null
          : toNumber(body.currencyId);
      const forceSimpleRate = toBool(body.forceSimpleRate);
      const saveSourcing = toBool(body.saveSourcing);

      let quantityColumns = [];

      if (Array.isArray(body.quantityColumns) && body.quantityColumns.length > 0) {
        quantityColumns = body.quantityColumns
          .map((c) => toNumber(c))
          .filter((c) => Number.isInteger(c) && c >= 0);
      } else {
        const quantityColumn = toNumber(body.quantityColumn, 0);
        if (!Number.isInteger(quantityColumn) || quantityColumn < 0) {
          throw new Error("quantityColumn must be a whole number >= 0");
        }
        quantityColumns = [quantityColumn];
      }

      if (!internalId) throw new Error("Missing required field: internalId");
      if (!recType) throw new Error(`Unsupported recordType: ${restName}`);
      if (!Number.isFinite(newPrice)) throw new Error("Missing or invalid required field: price");
      if (!quantityColumns.length) throw new Error("No valid quantity columns supplied");

      const hasMultipleCurrencies = runtime.isFeatureInEffect({ feature: "MULTICURRENCY" });
      const hasMultiplePrices = runtime.isFeatureInEffect({ feature: "MULTIPLEPRICES" });
      const hasQuantityPricing = runtime.isFeatureInEffect({ feature: "QUANTITYPRICING" });

      log.audit({
        title: "Price RESTlet request",
        details: {
          internalId,
          restName,
          recType,
          newPrice,
          priceLevelId,
          priceLevelName,
          currencyId,
          quantityColumns,
          hasMultipleCurrencies,
          hasMultiplePrices,
          hasQuantityPricing,
          forceSimpleRate,
        },
      });

      if (!hasMultipleCurrencies && !hasMultiplePrices && !hasQuantityPricing) {
        return updateSimpleRate({
          recType,
          internalId,
          newPrice,
          saveSourcing,
        });
      }

      if (forceSimpleRate) {
        return updateSimpleRate({
          recType,
          internalId,
          newPrice,
          saveSourcing,
        });
      }

      return updateMatrixPrices({
        recType,
        internalId,
        currencyId,
        priceLevelId,
        priceLevelName,
        quantityColumns,
        newPrice,
        saveSourcing,
      });
    } catch (e) {
      log.error({
        title: "Price RESTlet error",
        details: {
          name: e.name,
          message: e.message,
          stack: e.stack,
        },
      });

      return {
        success: false,
        error: e.message,
      };
    }
  }

  return { post };
});
