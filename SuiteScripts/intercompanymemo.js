/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const FIELD_PAIRED_SO = 'custbody_sb_pairedsalesorder';

  const afterSubmit = (context) => {
    try {
      if (context.type !== context.UserEventType.CREATE) return;

      const newRec = context.newRecord;
      const currentSoId = newRec.id;
      const customerId = newRec.getValue({ fieldId: 'entity' });
      const pairedSoId = newRec.getValue({ fieldId: FIELD_PAIRED_SO });

      if (!customerId || !pairedSoId) return;

      const customerEntityId = search.lookupFields({
        type: search.Type.CUSTOMER,
        id: customerId,
        columns: ['entityid']
      }).entityid;

      if (!customerEntityId || !customerEntityId.startsWith('I/C -')) return;

      const pairedMemo = search.lookupFields({
        type: search.Type.SALES_ORDER,
        id: pairedSoId,
        columns: ['memo']
      }).memo || '';

      if (!pairedMemo) return;

      record.submitFields({
        type: record.Type.SALES_ORDER,
        id: currentSoId,
        values: {
          memo: pairedMemo
        },
        options: {
          enableSourcing: false,
          ignoreMandatoryFields: true
        }
      });

      log.audit('Memo copied from paired SO', {
        currentSoId,
        pairedSoId,
        customerEntityId,
        pairedMemo
      });

    } catch (e) {
      log.error('Error copying memo from paired SO', e);
    }
  };

  return {
    afterSubmit
  };

});