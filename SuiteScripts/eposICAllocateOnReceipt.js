/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Allocate specific received stock to the Intercompany Sales Order
 * once the Item Receipt is created for the Transfer Order.
 *
 * Link chain:
 *   Item Receipt -> createdfrom (Transfer Order)
 *   Transfer Order.custbody_sb_relatedsalesorder -> Subsidiary SO
 *   Subsidiary SO.custbody_sb_pairedsalesorder -> Intercompany SO
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {
  const UE = {};

  UE.afterSubmit = (context) => {
    if (context.type !== context.UserEventType.CREATE) return;

    const ir = context.newRecord;
    const irId = ir.id;

    try {
      log.audit('🚀 Start', `Item Receipt ${irId} triggered allocation check.`);

      // === 1️⃣ Identify the Transfer Order link ===
      const createdFrom = ir.getValue('createdfrom');
      if (!createdFrom) {
        log.audit('⚠️ Skip', `IR ${irId}: no createdfrom (not a TO receipt).`);
        return;
      }
      log.audit('🔗 Linked Transfer Order', createdFrom);

      // === 2️⃣ Load Transfer Order ===
      let toRec;
      try {
        toRec = record.load({ type: 'transferorder', id: createdFrom });
        log.audit('✅ Transfer Order loaded', createdFrom);
      } catch (e) {
        log.error('❌ Failed to load Transfer Order', { createdFrom, message: e.message });
        return;
      }

      // === 2️⃣ Resolve Subsidiary SO linked to the Transfer Order ===
      const relatedSO = safeId(toRec.getValue('custbody_sb_relatedsalesorder'));

      if (!relatedSO) {
        log.audit('⚠️ Skip', `TO ${createdFrom} has no custbody_sb_relatedsalesorder.`);
        return;
      }

      log.audit('🔗 Related Subsidiary SO found', relatedSO);

      // === 🔒 SAFEGUARD: Only proceed if SO was created via REST Web Services ===
      if (!wasCreatedByRestWebServices(relatedSO)) {
        log.audit('⛔ Skip – Subsidiary SO not created via REST Web Services', relatedSO);
        return;
      }

      log.audit('✅ REST Web Services source confirmed for SO', relatedSO);


      // === 3️⃣ Load Subsidiary SO ===
      let subSO;
      try {
        subSO = record.load({ type: 'salesorder', id: relatedSO });
        log.audit('✅ Subsidiary SO loaded', relatedSO);
      } catch (e) {
        log.error('❌ Failed to load Subsidiary SO', { relatedSO, message: e.message });
        return;
      }

      const icSOId = safeId(subSO.getValue('custbody_sb_pairedsalesorder'));
      if (!icSOId) {
        log.audit('⚠️ Skip', `Subsidiary SO ${relatedSO} has no paired intercompany SO.`);
        return;
      }

      log.audit('🔗 Intercompany SO (target)', icSOId);

      // === 4️⃣ Extract received items + lot/serial details ===
      const plan = extractReceiptAssignments(ir);
      log.audit('📦 Receipt extraction complete', {
        totalItems: Object.keys(plan.byItem).length,
        totalQty: plan.totalQty,
      });

      if (plan.totalQty === 0) {
        log.audit('⚠️ Skip', `IR ${irId}: no inventory assignments or qty found.`);
        return;
      }

      // === 5️⃣ Load Intercompany Sales Order ===
      let icSO;
      try {
        icSO = record.load({ type: 'salesorder', id: icSOId });
        log.audit('✅ Intercompany SO loaded', icSOId);
      } catch (e) {
        log.error('❌ Failed to load Intercompany SO', { icSOId, message: e.message });
        return;
      }

      const icLineCount = icSO.getLineCount({ sublistId: 'item' });
      log.audit('📋 IC SO line count', icLineCount);

      // === 6️⃣ Apply allocations ===
      let updatedLines = 0;
      for (const itemIdStr of Object.keys(plan.byItem)) {
        const itemAssignments = plan.byItem[itemIdStr];
        log.debug(`🔎 Processing item ${itemIdStr}`, itemAssignments);

        for (let d = 0; d < icLineCount && itemAssignments.length > 0; d++) {
          const soItem = String(icSO.getSublistValue({ sublistId: 'item', fieldId: 'item', line: d }) || '');
          if (soItem !== itemIdStr) continue;

          log.debug(`🧩 Match found on IC SO line ${d}`, { item: soItem, line: d });

          try {
            upsertInventoryAssignmentsOnSoLine(icSO, d, itemAssignments);

            icSO.setSublistValue({
              sublistId: 'item',
              fieldId: 'orderallocationstrategy',
              line: d,
              value: '-2', // allocate immediately
            });

            updatedLines++;
          } catch (innerErr) {
            log.error(`❌ Line ${d} update failed`, { message: innerErr.message, stack: innerErr.stack });
          }
        }
      }

      // === 7️⃣ Save or exit ===
      if (updatedLines > 0) {
        const savedAs = icSO.save();
        log.audit('✅ Allocation completed', {
          itemReceipt: irId,
          intercompanySO: icSOId,
          updatedLines,
          savedAs,
        });
      } else {
        log.audit('⚠️ No matching IC SO lines updated', {
          intercompanySO: icSOId,
          itemsOnReceipt: Object.keys(plan.byItem),
        });
      }
    } catch (err) {
      log.error('❌ Critical Failure', {
        itemReceipt: irId,
        message: err.message,
        stack: err.stack,
      });
    }
  };

  // ---------------- helpers ----------------

  function wasCreatedByRestWebServices(salesOrderId) {
    const results = search.create({
      type: search.Type.SALES_ORDER,
      filters: [
        ['internalid', 'is', salesOrderId],
        'AND',
        ['systemnotes.field', 'is', 'source'],
        'AND',
        ['systemnotes.newvalue', 'is', 'REST Web Services']
      ],
      columns: ['internalid']
    }).run().getRange({ start: 0, end: 1 });

    return results.length > 0;
  }


  function extractReceiptAssignments(ir) {
    const count = ir.getLineCount({ sublistId: 'item' });
    const byItem = {};
    let totalQty = 0;

    log.debug('🧮 Scanning IR lines', count);

    for (let i = 0; i < count; i++) {
      const itemId = String(ir.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }) || '');
      const qty = number(ir.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }));
      if (!itemId || qty <= 0) continue;

      const invDet = ir.getSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line: i });
      if (!invDet) {
        log.debug(`⚠️ Line ${i}: no inventory detail for item ${itemId}`);
        continue;
      }

      const aCount = invDet.getLineCount({ sublistId: 'inventoryassignment' });
      log.debug(`🔍 Item ${itemId} has ${aCount} assignments`);

      for (let a = 0; a < aCount; a++) {
        const invNumId = safeId(invDet.getSublistValue({
          sublistId: 'inventoryassignment',
          fieldId: 'receiptinventorynumber',
          line: a,
        }));
        const aQty = number(invDet.getSublistValue({
          sublistId: 'inventoryassignment',
          fieldId: 'quantity',
          line: a,
        }));

        if (!invNumId || aQty <= 0) continue;
        if (!byItem[itemId]) byItem[itemId] = [];
        byItem[itemId].push({ invId: invNumId, qty: aQty });
        totalQty += aQty;

        log.debug(`📦 Captured assignment`, { itemId, invNumId, aQty });
      }
    }

    log.audit('🧾 Extract summary', { itemCount: Object.keys(byItem).length, totalQty });
    return { byItem, totalQty };
  }

  function upsertInventoryAssignmentsOnSoLine(so, lineIndex, itemAssignments) {
    const sublistId = 'inventoryassignment';
    let subrec = so.getSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line: lineIndex });
    if (!subrec) {
      subrec = so.createSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line: lineIndex });
      log.debug(`🆕 Created new inventorydetail subrecord for line ${lineIndex}`);
    }

    const existing = subrec.getLineCount({ sublistId });
    const lineQty = number(so.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: lineIndex }));
    const alreadyAssigned = sumAssigned(subrec, sublistId);
    let remaining = Math.max(0, lineQty - alreadyAssigned);

    log.debug(`📊 Line ${lineIndex} assignment stats`, { existing, lineQty, alreadyAssigned, remaining });

    if (remaining === 0) {
      log.debug(`ℹ️ Line ${lineIndex} already fully assigned — skipping`);
      return;
    }

    let nextIndex = existing;
    for (let i = 0; i < itemAssignments.length && remaining > 0;) {
      const a = itemAssignments[i];
      if (!a || a.qty <= 0) { i++; continue; }

      const useQty = Math.min(a.qty, remaining);

      subrec.insertLine({ sublistId, line: nextIndex });
      subrec.setSublistValue({ sublistId, fieldId: 'issueinventorynumber', line: nextIndex, value: a.invId });
      subrec.setSublistValue({ sublistId, fieldId: 'quantity', line: nextIndex, value: useQty });

      log.debug(`➕ Added assignment`, { lineIndex, invId: a.invId, qty: useQty });

      remaining -= useQty;
      a.qty -= useQty;
      if (a.qty <= 0) itemAssignments.splice(i, 1);
      else i++;
      nextIndex++;
    }

    log.debug(`✅ Finished assignments for SO line ${lineIndex}`, { remainingAfter: remaining });
  }

  function sumAssigned(subrec, sublistId) {
    const c = subrec.getLineCount({ sublistId });
    let sum = 0;
    for (let i = 0; i < c; i++) {
      sum += number(subrec.getSublistValue({ sublistId, fieldId: 'quantity', line: i }));
    }
    return sum;
  }

  function number(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function safeId(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s || null;
  }

  return UE;
});
