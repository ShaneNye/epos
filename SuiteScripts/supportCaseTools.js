/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/query", "N/error"], (record, query, error) => {
  const typeMap = {
    Email: 3,
    Phone: 8,
    "In-Person": 6,
  };

  function requiredNumber(value, name) {
    const num = Number(value);
    if (!num) {
      throw error.create({
        name: `INVALID_${String(name || "ID").toUpperCase()}`,
        message: `${name} must be numeric.`,
      });
    }
    return num;
  }

  function attachTransaction(context) {
    const caseId = requiredNumber(context.caseId || context.activityId, "caseId");
    const transactionId = requiredNumber(context.transactionId || context.salesOrderId || context.orderId, "transactionId");

    record.attach({
      record: { type: record.Type.SUPPORT_CASE, id: caseId },
      to: { type: "transaction", id: transactionId },
    });

    return { ok: true, caseId, transactionId };
  }

  function createNote(context) {
    const caseId = requiredNumber(context.caseId || context.activityId, "caseId");
    const title = String(context.title || "Case Note").trim();
    const memo = String(context.memo || context.note || "").trim();

    if (!memo) {
      throw error.create({ name: "MISSING_MEMO", message: "Note text is required." });
    }

    const note = record.create({ type: "note", isDynamic: false });
    note.setValue({ fieldId: "title", value: title });
    note.setValue({ fieldId: "note", value: memo });
    note.setValue({ fieldId: "notetype", value: typeMap[context.type] || 6 });
    note.setValue({ fieldId: "activity", value: caseId });

    if (context.authorId) {
      note.setValue({ fieldId: "author", value: Number(context.authorId) });
    }

    return { ok: true, id: note.save() };
  }

  function getNotes(context) {
    const caseId = requiredNumber(context.caseId || context.activityId, "caseId");
    const sql = `
      SELECT
        note.id AS id
      FROM
        note
      WHERE
        note.activity = ?
      ORDER BY
        note.id DESC
    `;

    const results = query
      .runSuiteQL({ query: sql, params: [caseId] })
      .asMappedResults();

    return {
      ok: true,
      results: results.map((row) => {
        const id = row.id || row.ID;
        try {
          const noteRec = record.load({
            type: "note",
            id,
            isDynamic: false,
          });

          return {
            id,
            title: noteRec.getValue({ fieldId: "title" }) || "",
            memo: noteRec.getValue({ fieldId: "note" }) || "",
            date: noteRec.getValue({ fieldId: "notedate" }) || "",
            author: noteRec.getText({ fieldId: "author" }) || "",
          };
        } catch (e) {
          log.error("Support Case Note Load Error", e);
          return { id };
        }
      }),
    };
  }

  function dispatch(context = {}) {
    try {
      const action = String(context.action || "").trim();
      if (action === "attachTransaction") return attachTransaction(context);
      if (action === "createNote") return createNote(context);
      if (action === "getNotes") return getNotes(context);
      throw error.create({ name: "UNKNOWN_ACTION", message: `Unknown support case action: ${action}` });
    } catch (e) {
      log.error("Support Case Tool Error", e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  return {
    get: dispatch,
    post: dispatch,
  };
});
