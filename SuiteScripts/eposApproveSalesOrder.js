/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/error'], (record, error) => {

  const post = (context) => {
    try {
      if (!context.id) {
        throw error.create({
          name: 'MISSING_ID',
          message: 'Sales Order ID (id) is required.'
        });
      }

      const so = record.load({ type: 'salesorder', id: context.id, isDynamic: false });

      // Handle header updates
      if (context.headerUpdates) {
        const updates = context.headerUpdates;
        if (updates.memo !== undefined) so.setValue({ fieldId: 'memo', value: updates.memo });
        if (updates.distributionOrderType !== undefined) {
          so.setValue({
            fieldId: 'custbody_sb_is_web_order',
            value: updates.distributionOrderType || ''
          });
        }
        // Add other header updates as needed
      }

      // --- Unlock and approve only if commit is true ---
      if (context.commit) {
        // approvalstatus: 2 = Approved
        so.setValue({ fieldId: 'approvalstatus', value: 2 });

        // orderstatus: 'B' = Pending Fulfillment
        so.setValue({ fieldId: 'orderstatus', value: 'B' });
      }

      const savedId = so.save({ enableSourcing: true, ignoreMandatoryFields: true });

      return { ok: true, id: savedId, message: context.commit ? 'Sales Order approved & committed successfully.' : 'Sales Order saved successfully.' };
    } catch (e) {
      log.error('RESTlet Approve SO Error', e);
      return { ok: false, error: e.message || e };
    }
  };

  return { post };
});
