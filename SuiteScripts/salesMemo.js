/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/error'], 
(record, search, error) => {

  /* ======================================================
     CREATE MEMO (POST)
     Creates a Note record linked to a Sales Order
  ====================================================== */
  const post = (context) => {
    try {
      const { orderId, title, memo, type, authorEmail } = context;

      if (!orderId)
        throw error.create({ name: 'MISSING_ORDER_ID', message: 'orderId is required.' });

      if (!title)
        throw error.create({ name: 'MISSING_TITLE', message: 'Memo title is required.' });

      if (!memo)
        throw error.create({ name: 'MISSING_MEMO', message: 'Memo text is required.' });

      // --- Create Note record ---
      const noteRec = record.create({ type: 'note' });

      noteRec.setValue({ fieldId: 'title', value: title });
      noteRec.setValue({ fieldId: 'note', value: memo });
      noteRec.setValue({ fieldId: 'notetype', value: type || 'Email' });
      noteRec.setValue({ fieldId: 'entity', value: orderId });

      // Optional: If you want to store author:
      if (authorEmail) {
        const userId = findUserByEmail(authorEmail);
        if (userId) {
          noteRec.setValue({ fieldId: 'author', value: userId });
        }
      }

      const id = noteRec.save();
      return { ok: true, id };

    } catch (e) {
      log.error('❌ Error creating memo', e);
      return { ok: false, error: e.message || e };
    }
  };


  /* ======================================================
     GET MEMOS FOR A SALES ORDER (GET)
  ====================================================== */
  const get = (context) => {
    try {
      const orderId = context.id;
      if (!orderId)
        throw error.create({ name: 'MISSING_ORDER_ID', message: 'id parameter is required.' });

      const results = [];

      const memoSearch = search.create({
        type: 'note',
        filters: [
          ['entity', 'anyof', orderId]
        ],
        columns: [
          'id',
          'title',
          'note',
          'notetype',
          'notedate',
          'author'
        ]
      });

      memoSearch.run().each(result => {
        results.push({
          id: result.getValue('id'),
          title: result.getValue('title'),
          memo: result.getValue('note'),
          type: result.getText('notetype'),
          author: result.getText('author'),
          date: result.getValue('notedate')
        });
        return true;
      });

      return { ok: true, results };

    } catch (e) {
      log.error('❌ Error fetching memos', e);
      return { ok: false, error: e.message || e };
    }
  };


  /* ======================================================
     Helper: find NetSuite user ID by email
  ====================================================== */
  function findUserByEmail(email) {
    if (!email) return null;

    const userSearch = search.create({
      type: "employee",
      filters: [['email', 'is', email]],
      columns: ['internalid']
    });

    const result = userSearch.run().getRange({ start: 0, end: 1 });

    if (result && result.length > 0) {
      return result[0].getValue('internalid');
    }

    return null;
  }

  return { post, get };
});
