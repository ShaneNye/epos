/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/log", "N/error"], (record, log, error) => {
  const GROSS_DIVISOR = 1.2;

  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  function taxCodeId(value) {
    if (value && typeof value === "object") {
      return String(value.id || value.value || value.refName || "").trim();
    }
    return String(value || "").trim();
  }

  function isVatFreeTaxCode(value) {
    const code = norm(taxCodeId(value));
    return code === "10" || code.indexOf("vat free") !== -1 || code.indexOf("zero") !== -1;
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

  function findLineIndexByPayloadFallback(soRec, u) {
    const requestedIndex = Number(u && u.lineIndex);
    if (!Number.isInteger(requestedIndex) || requestedIndex < 0) return -1;

    const lineCount = getItemLineCount(soRec);
    if (requestedIndex >= lineCount) return -1;

    const expectedItem = String(u.itemId || (u.item && u.item.id) || "").trim();
    if (!expectedItem) return requestedIndex;

    const currentItem = String(
      soRec.getSublistValue({
        sublistId: "item",
        fieldId: "item",
        line: requestedIndex,
      }) || ""
    ).trim();

    if (currentItem === expectedItem) return requestedIndex;

    log.debug("⚠️ Line index fallback item mismatch", {
      lineIndex: requestedIndex,
      expectedItem,
      currentItem,
    });
    return -1;
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

  function applyInventoryDetailToCurrentLine(
    soRec,
    inventoryDetail,
    warehouseId,
    warehouseTextNorm
  ) {
    if (inventoryDetail === null || inventoryDetail === "") {
      clearCurrentField(soRec, "custcol_sb_epos_inventory_meta");
      clearCurrentField(soRec, "custcol_sb_lotnumber");

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
  const saleGrossInput =
    u.saleGrossPerUnit != null ? u.saleGrossPerUnit : u.saleGrossLine ?? u.saleprice;
  const saleGrossValue = toNum(saleGrossInput);
  const priceDivisor = isVatFreeTaxCode(u.taxCode ?? u.taxcode) ? 1 : GROSS_DIVISOR;

  let newRateNet = null;

  if (saleGrossValue !== 0 && qty > 0) {
    const saleGrossPerUnit = saleGrossValue / qty;
    newRateNet = saleGrossPerUnit / priceDivisor;
  } else if (discountPct > 0 && currentRateNet > 0) {
    const d = Math.max(0, Math.min(100, discountPct));
    newRateNet = currentRateNet * (1 - d / 100);
  } else if (isNewLine && toNum(u.amountGrossLine ?? u.amount) !== 0 && qty > 0) {
    const amountGrossPerUnit = toNum(u.amountGrossLine ?? u.amount) / qty;
    newRateNet = amountGrossPerUnit / priceDivisor;
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
      priceDivisor,
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

    if (u.taxCode !== undefined || u.taxcode !== undefined) {
      const code = taxCodeId(u.taxCode ?? u.taxcode);
      if (code) setCurrentIfDefined(soRec, "taxcode", code);
    }

    const lotNumberValue =
      u.lotnumber !== undefined
        ? u.lotnumber
        : u.lotNumber !== undefined
          ? u.lotNumber
          : null;

    if (lotNumberValue !== null && String(lotNumberValue || "").trim() !== "") {
      setCurrentIfDefined(soRec, "custcol_sb_lotnumber", String(lotNumberValue));
      clearCurrentField(soRec, "custcol_sb_epos_inventory_meta");

      log.debug("🔧 Current line inventory applied from explicit lot number", {
        lotnumber: lotNumberValue,
      });
    } else if (u.inventoryDetail !== undefined) {
      try {
        applyInventoryDetailToCurrentLine(
          soRec,
          u.inventoryDetail,
          warehouseId,
          warehouseTextNorm
        );
      } catch (invErr) {
        log.error("⚠️ Inventory detail parse/apply failed on current line", invErr);

        if (u.inventoryDetail) {
          setCurrentIfDefined(
            soRec,
            "custcol_sb_epos_inventory_meta",
            String(u.inventoryDetail)
          );
        }
      }
    }

    applyPricingToCurrentLine(soRec, u, isNewLine);
  }

  const post = (context) => {
    try {
      log.audit("🔁 RESTlet Triggered", context);

      if (!context.id) {
        throw error.create({
          name: "MISSING_ID",
          message: "Sales Order ID (context.id) is required.",
        });
      }

      const id = Number(context.id);
      const doCommit = context.commit !== false;

      const lines = Array.isArray(context.lines) ? context.lines : [];
      const deletedLineIds = Array.isArray(context.deletedLineIds)
        ? context.deletedLineIds
        : [];

      const updates = Array.isArray(context.updates) ? context.updates : lines;

      log.audit("📦 Loading Sales Order (dynamic mode)", {
        id,
        doCommit,
        lineCount: updates.length,
        deletedLineIds,
      });

      const soRec = record.load({
        type: record.Type.SALES_ORDER,
        id,
        isDynamic: true,
      });

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

      const removedLineIds = removeDeletedLines(soRec, deletedLineIds);

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

              log.audit("✅ New line inserted", {
                itemId: u.itemId,
                quantity: u.quantity,
                fulfilmentMethod: u.fulfilmentMethod,
              });

              return;
            }

            let targetLine = findLineIndexByInternalLineId(soRec, u.lineId);
            if (targetLine < 0) {
              targetLine = findLineIndexByPayloadFallback(soRec, u);
            }

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

      log.audit("💾 Sales Order saved with updates", {
        id: savedId,
        doCommit,
        removedLineIds,
        updatesApplied: updates.length || 0,
      });

      return {
        ok: true,
        id,
        message: doCommit
          ? "✅ Sales Order updated & flagged for approval"
          : "✅ Sales Order updated (save-only, not committed)",
        updatesApplied: updates.length || 0,
        deletedLineIds,
        removedLineIds,
        committed: doCommit,
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
