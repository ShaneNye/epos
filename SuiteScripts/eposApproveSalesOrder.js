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

      // --- Unlock and approve ---
      // approvalstatus: 2 = Approved
      so.setValue({ fieldId: 'approvalstatus', value: 2 });

      // orderstatus: 'B' = Pending Fulfillment
      so.setValue({ fieldId: 'orderstatus', value: 'B' });

      const savedId = so.save({ enableSourcing: true, ignoreMandatoryFields: true });

      return { ok: true, id: savedId, message: 'Sales Order approved & committed successfully.' };
    } catch (e) {
      log.error('RESTlet Approve SO Error', e);
      return { ok: false, error: e.message || e };
    }
  };

  return { post };
});
