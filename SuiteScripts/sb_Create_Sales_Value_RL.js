/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/log'], (record, log) => {

  const post = (data) => {
    log.debug('📨 Incoming payload', data);

    try {
      // 🔍 Validate required fields
      if (!data.custrecord_sb_coms_sales_order?.id) {
        throw new Error('Missing required field: custrecord_sb_coms_sales_order.id');
      }

      // 🧾 Create custom record
      const rec = record.create({
        type: 'customrecord_sb_coms_sales_value',
        isDynamic: true,
      });

      rec.setValue({
        fieldId: 'custrecord_sb_coms_date',
        value: data.custrecord_sb_coms_date || new Date(),
      });

      rec.setValue({
        fieldId: 'custrecord_sb_coms_sales_order',
        value: data.custrecord_sb_coms_sales_order.id, // ✅ Internal ID reference
      });

      rec.setValue({
        fieldId: 'custrecord_sb_coms_gross',
        value: parseFloat(data.custrecord_sb_coms_gross) || 0,
      });

      rec.setValue({
        fieldId: 'custrecord_sb_coms_profit',
        value: parseFloat(data.custrecord_sb_coms_profit) || 0,
      });

      if (data.custrecord_sb_coms_sales_rep?.id) {
        rec.setValue({
          fieldId: 'custrecord_sb_coms_sales_rep',
          value: data.custrecord_sb_coms_sales_rep.id,
        });
      }

      const recId = rec.save();
      log.audit('✅ Custom Record Created', { id: recId });

      return { ok: true, id: recId };

    } catch (err) {
      log.error('❌ Error creating customrecord_sb_coms_sales_value', err);
      return { ok: false, error: err.message };
    }
  };

  // Support GET for testing (optional)
  const get = (params) => {
    return { ok: true, message: 'SB Create Sales Value RESTlet is live', params };
  };

  return { post, get };
});
