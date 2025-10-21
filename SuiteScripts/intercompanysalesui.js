/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/currentRecord', 'N/log'], (currentRecord, log) => {
  const pageInit = () => {
    try {
      const rec = currentRecord.get();
      const currentSub = rec.getValue({ fieldId: 'subsidiary' });

      // Only set if subsidiary is empty or not already 6
      if (!currentSub || Number(currentSub) !== 6) {
        rec.setValue({ fieldId: 'subsidiary', value: 6 });
        log.debug('✅ Default Subsidiary Set', 'Subsidiary field set to internal ID 6');
      } else {
        log.debug('ℹ️ Subsidiary already set', currentSub);
      }
    } catch (err) {
      log.error('❌ Failed to set default subsidiary', err);
    }
  };

  return { pageInit };
});
