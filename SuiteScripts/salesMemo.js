/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/query', 'N/error'], (record, query, error) => {

  const typeMap = {
    "Email": 3,
    "Phone": 8,
    "In-Person": 6
  };

  const post = (context) => {
    try {
      const { orderId, transactionId, caseId, activityId, title, memo, type, authorId } = context;
      const linkedTransactionId = orderId || transactionId;
      const linkedActivityId = caseId || activityId;

      if (!linkedTransactionId && !linkedActivityId)
        throw error.create({ name: 'MISSING_LINKED_RECORD', message: 'orderId or caseId is required.' });

      if (!title)
        throw error.create({ name: 'MISSING_TITLE', message: 'Memo title is required.' });

      if (!memo)
        throw error.create({ name: 'MISSING_MEMO', message: 'Memo text is required.' });

      const nsNoteType = typeMap[type] || 3; // fallback = Email

      // Create Note record
      const note = record.create({
        type: "note",
        isDynamic: false
      });

      note.setValue({ fieldId: "title", value: title });
      note.setValue({ fieldId: "note", value: memo });
      note.setValue({ fieldId: "notetype", value: nsNoteType });

      if (linkedActivityId) {
        note.setValue({ fieldId: "activity", value: Number(linkedActivityId) });
      } else {
        // Link to the transaction. This supports Sales Orders and Estimates/Quotes.
        note.setValue({ fieldId: "transaction", value: Number(linkedTransactionId) });
      }

      // Set Author if provided
      if (authorId) {
        note.setValue({ fieldId: "author", value: Number(authorId) });
      }

      const id = note.save();
      return { ok: true, id };

    } catch (e) {
      log.error("❌ Memo Creation Error", e);
      return {
        ok: false,
        error: e.message || e
      };
    }
  };

  const get = (context) => {
    try {
      const activityId = context.caseId || context.activityId;
      if (activityId) {
        const numericActivityId = Number(activityId);
        if (!numericActivityId)
          throw error.create({ name: 'INVALID_ACTIVITY_ID', message: 'caseId/activityId must be numeric.' });

        const sql = `
          SELECT
            note.id AS id,
            note.title AS title,
            note.note AS memo
          FROM
            note
          WHERE
            note.activity = ?
          ORDER BY
            note.id DESC
        `;

        const results = query
          .runSuiteQL({
            query: sql,
            params: [numericActivityId]
          })
          .asMappedResults();

        return { ok: true, results };
      }

      const transactionId = context.orderId || context.transactionId || context.id;

      if (!transactionId)
        throw error.create({ name: 'MISSING_TRANSACTION_ID', message: 'orderId, transactionId, or id is required.' });

      const numericTransactionId = Number(transactionId);
      if (!numericTransactionId)
        throw error.create({ name: 'INVALID_TRANSACTION_ID', message: 'transaction ID must be numeric.' });

      const sql = `
        SELECT
          TransactionNote.ID AS id,
          TransactionNote.Transaction AS transactionId,
          TransactionNote.NoteDate AS date,
          BUILTIN.DF(TransactionNote.Author) AS author,
          BUILTIN.DF(TransactionNote.NoteType) AS type,
          TransactionNote.Title AS title,
          TransactionNote.Note AS memo
        FROM
          TransactionNote
        WHERE
          TransactionNote.Transaction = ?
        ORDER BY
          TransactionNote.NoteDate DESC
      `;

      const results = query
        .runSuiteQL({
          query: sql,
          params: [numericTransactionId]
        })
        .asMappedResults();

      return { ok: true, results };
    } catch (e) {
      log.error("Memo Fetch Error", e);
      return {
        ok: false,
        error: e.message || e
      };
    }
  };

  return { post, get };
});
