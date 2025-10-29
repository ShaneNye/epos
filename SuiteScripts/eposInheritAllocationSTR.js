/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Inherit `orderallocationstrategy` on intercompany Sales Orders
 * Trigger: AfterSubmit (Create)
 * Criteria: Entity name starts with "I/C -" and paired source in custbody_sb_pairedsalesorder
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {
  const UE = {};

  UE.afterSubmit = (context) => {
    if (context.type !== context.UserEventType.CREATE) return;

    const newRec = context.newRecord;
    const destId = newRec.id;

    try {
      // === 1️⃣ Identify intercompany orders by entity name prefix "I/C -" ===
      const entityId = newRec.getValue('entity');
      if (!entityId) {
        log.audit('Skip', `SO ${destId}: no entity — cannot evaluate I/C prefix.`);
        return;
      }

      const ent = lookupCustomerName(entityId);
      const entName = ent.entityid || ent.companyname || ent.altname || '';
      const isIC = /^I\/C\s*-/i.test(String(entName || ''));

      if (!isIC) {
        log.audit('Skip', `SO ${destId}: entity "${entName}" does not start with "I/C -".`);
        return;
      }

      // === 2️⃣ Identify paired source order ===
      const pairedId = safeId(newRec.getValue('custbody_sb_pairedsalesorder'));
      if (!pairedId) {
        log.audit('Skip', `SO ${destId}: no custbody_sb_pairedsalesorder set — cannot inherit.`);
        return;
      }

      log.audit('Intercompany detected', {
        destSO: destId,
        entityId,
        entityName: entName,
        pairedSourceSO: pairedId,
      });

      // === 3️⃣ Load both source and destination SOs ===
      const sourceSO = record.load({ type: 'salesorder', id: pairedId });
      let destSO = record.load({ type: 'salesorder', id: destId }); // non-dynamic
      if (typeof destSO.setSublistValue !== 'function') {
        log.audit('⚠️ Reloading destination SO in static mode', destId);
        destSO = record.load({ type: 'salesorder', id: destId });
      }

      const srcCount = sourceSO.getLineCount({ sublistId: 'item' });
      const destCount = destSO.getLineCount({ sublistId: 'item' });
      log.audit('Line counts', { sourceLines: srcCount, destinationLines: destCount });

      const usedSourceIdx = new Set();
      let updated = 0;

      for (let d = 0; d < destCount; d++) {
        try {
          const dItem = destSO.getSublistValue({ sublistId: 'item', fieldId: 'item', line: d });
          if (!dItem) continue;

          const dQty = numberOrNull(destSO.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: d }));
          const sIdx = findBestSourceLineIndex(sourceSO, dItem, dQty, usedSourceIdx);
          if (sIdx < 0) {
            log.debug(`No match for dest line ${d}`, { itemId: dItem, quantity: dQty });
            continue;
          }

          const sAlloc = sourceSO.getSublistValue({
            sublistId: 'item',
            fieldId: 'orderallocationstrategy',
            line: sIdx,
          });

          // === 4️⃣ Copy or clear allocation strategy ===
          if (sAlloc !== null && sAlloc !== '' && sAlloc !== undefined) {
            // ✅ Copy source value
            destSO.setSublistValue({
              sublistId: 'item',
              fieldId: 'orderallocationstrategy',
              line: d,
              value: sAlloc,
            });
            log.debug(`Line ${d} updated`, {
              srcLine: sIdx,
              itemId: dItem,
              quantity: dQty,
              allocation: sAlloc,
            });
          } else {
            // ✅ Clear destination field (handles "Do Not Allocate")
            destSO.setSublistValue({
              sublistId: 'item',
              fieldId: 'orderallocationstrategy',
              line: d,
              value: '', // explicit clear
            });
            log.debug(`Line ${d} cleared (no allocation in source)`, {
              srcLine: sIdx,
              itemId: dItem,
              quantity: dQty,
            });
          }

          usedSourceIdx.add(sIdx);
          updated++;
        } catch (lineErr) {
          log.error(`Line ${d} processing error`, {
            message: lineErr.message,
            stack: lineErr.stack,
          });
        }
      }

      // === 5️⃣ Save and log summary ===
      const savedAs = destSO.save();
      log.audit('✅ Allocation inheritance complete', {
        destSO: destId,
        pairedSourceSO: pairedId,
        updatedLines: updated,
        savedAs,
      });
    } catch (err) {
      log.error('❌ UE failure', {
        destSO: context?.newRecord?.id,
        message: err.message,
        stack: err.stack,
      });
    }
  };

  // ---------- helpers ----------

  function lookupCustomerName(customerId) {
    try {
      return search.lookupFields({
        type: search.Type.CUSTOMER,
        id: customerId,
        columns: ['entityid', 'companyname', 'altname'],
      }) || {};
    } catch (e) {
      log.error('lookupCustomerName failed', { customerId, message: e.message });
      return {};
    }
  }

  function numberOrNull(v) {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function safeId(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s || null;
  }

  /**
   * Find the best matching source line for a given (item, qty).
   * Strategy:
   *  1️⃣ Exact match on item (unused)
   *  2️⃣ If duplicates, prefer same quantity
   *  3️⃣ Fallback to first unused match
   */
  function findBestSourceLineIndex(sourceSO, itemId, qty, usedSet) {
    const sublistId = 'item';
    const count = sourceSO.getLineCount({ sublistId });

    let firstUnused = -1;
    let qtyMatch = -1;

    for (let s = 0; s < count; s++) {
      const sItem = sourceSO.getSublistValue({ sublistId, fieldId: 'item', line: s });
      if (String(sItem) !== String(itemId)) continue;
      if (usedSet.has(s)) continue;

      if (firstUnused === -1) firstUnused = s;
      if (qty !== null) {
        const sQty = numberOrNull(sourceSO.getSublistValue({ sublistId, fieldId: 'quantity', line: s }));
        if (sQty !== null && sQty === qty) {
          qtyMatch = s;
          break;
        }
      }
    }
    return qtyMatch >= 0 ? qtyMatch : firstUnused;
  }

  return UE;
});
