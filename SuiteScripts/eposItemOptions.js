/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record", "N/search", "N/query", "N/log"], (record, search, query, log) => {
  const ITEM_OPTION_RECORD_TYPE = "itemoptioncustomfield";

  function safeString(v) {
    if (v == null) return "";
    try { return String(v); } catch (e) { return ""; }
  }

  function asBool(v) {
    return v === true || v === "T" || v === "true";
  }

  function safeGetValue(rec, fieldId) {
    try { return rec.getValue({ fieldId }); } catch (e) { return null; }
  }

  function safeGetText(rec, fieldId) {
    try { return rec.getText({ fieldId }); } catch (e) { return ""; }
  }

  function getMultiValue(rec, fieldId) {
    try {
      const val = rec.getValue({ fieldId });
      if (Array.isArray(val)) return val.map((x) => safeString(x)).filter(Boolean);
      if (val == null || val === "") return [];
      return [safeString(val)];
    } catch (e) {
      return [];
    }
  }

  function getItemOptionIds() {
    try {
      return getItemOptionIdsFromSearch();
    } catch (searchError) {
      log.audit("Item option field search failed, trying SuiteQL", safeString(searchError && searchError.message ? searchError.message : searchError));
      return getItemOptionIdsFromSuiteQL();
    }
  }

  function getItemOptionIdsFromSearch() {
    const ids = [];
    const seen = {};

    const optionSearch = search.create({
      type: ITEM_OPTION_RECORD_TYPE,
      filters: [],
      columns: [
        search.createColumn({
          name: "internalid",
          sort: search.Sort.ASC
        })
      ]
    });

    const paged = optionSearch.runPaged({ pageSize: 1000 });
    paged.pageRanges.forEach((pageRange) => {
      const page = paged.fetch({ index: pageRange.index });
      page.data.forEach((r) => {
        const id = safeString(r.getValue({ name: "internalid" }));
        if (!id || seen[id]) return;
        seen[id] = true;
        ids.push(id);
      });
    });

    return ids;
  }

  function getItemOptionIdsFromSuiteQL() {
    const sqlAttempts = [
      `
        SELECT internalid
        FROM customfield
        WHERE recordtype = 'itemOptionCustomField'
        ORDER BY internalid
      `,
      `
        SELECT internalid
        FROM customfield
        WHERE LOWER(BUILTIN.DF(recordtype)) IN ('item option custom field', 'item option')
        ORDER BY internalid
      `
    ];

    let lastError = null;
    for (let i = 0; i < sqlAttempts.length; i++) {
      try {
        const rows = query.runSuiteQL({ query: sqlAttempts[i] }).asMappedResults();
        const ids = [];
        const seen = {};

        rows.forEach((row) => {
          const id = safeString(row.internalid || row.INTERNALID);
          if (!id || seen[id]) return;
          seen[id] = true;
          ids.push(id);
        });

        if (ids.length) return ids;
      } catch (e) {
        lastError = e;
      }
    }

    throw lastError || new Error("No item option custom fields found");
  }

  function getItemsByIds(itemIds) {
    const ids = (itemIds || []).map(safeString).filter(Boolean);
    if (!ids.length) return [];

    const out = [];
    try {
      const itemSearch = search.create({
        type: search.Type.ITEM,
        filters: [["internalid", "anyof", ids]],
        columns: [
          search.createColumn({ name: "internalid" }),
          search.createColumn({ name: "itemid" }),
          search.createColumn({ name: "displayname" }),
          search.createColumn({ name: "type" }),
          search.createColumn({ name: "isinactive" })
        ]
      });

      itemSearch.run().each((r) => {
        out.push({
          id: safeString(r.getValue({ name: "internalid" })),
          itemId: safeString(r.getValue({ name: "itemid" })),
          displayName: safeString(r.getValue({ name: "displayname" })),
          type: safeString(r.getText({ name: "type" }) || r.getValue({ name: "type" })),
          inactive: asBool(r.getValue({ name: "isinactive" }))
        });
        return true;
      });
    } catch (e) {
      log.error("getItemsByIds failed", safeString(e && e.message ? e.message : e));
    }

    const byId = {};
    out.forEach((x) => { byId[x.id] = x; });

    return ids.map((id) => byId[id] || {
      id,
      itemId: "",
      displayName: "",
      type: "",
      inactive: false
    });
  }

  function getChildItemsByParentIds(parentIds) {
    const ids = (parentIds || []).map(safeString).filter(Boolean);
    if (!ids.length) return [];

    const out = [];
    try {
      const itemSearch = search.create({
        type: search.Type.ITEM,
        filters: [["parent", "anyof", ids]],
        columns: [
          search.createColumn({ name: "internalid" }),
          search.createColumn({ name: "itemid" }),
          search.createColumn({ name: "displayname" }),
          search.createColumn({ name: "type" }),
          search.createColumn({ name: "isinactive" })
        ]
      });

      itemSearch.run().each((r) => {
        out.push({
          id: safeString(r.getValue({ name: "internalid" })),
          itemId: safeString(r.getValue({ name: "itemid" })),
          displayName: safeString(r.getValue({ name: "displayname" })),
          type: safeString(r.getText({ name: "type" }) || r.getValue({ name: "type" })),
          inactive: asBool(r.getValue({ name: "isinactive" }))
        });
        return true;
      });
    } catch (e) {
      log.error("getChildItemsByParentIds failed", safeString(e && e.message ? e.message : e));
    }

    return out;
  }

  function getAppliedItems(appliedItemIds, includeChildItems) {
    const items = getItemsByIds(appliedItemIds);
    if (!includeChildItems) return items;

    const seen = {};
    const merged = [];
    items.concat(getChildItemsByParentIds(appliedItemIds)).forEach((item) => {
      if (!item.id || seen[item.id]) return;
      seen[item.id] = true;
      merged.push(item);
    });

    return merged;
  }

  function tryLoadCustomList(sourceId) {
    try {
      const rec = record.load({ type: "customlist", id: sourceId });
      const values = [];
      const lineCount = Number(rec.getLineCount({ sublistId: "customvalue" }) || 0);

      for (let i = 0; i < lineCount; i++) {
        values.push({
          id: safeString(rec.getSublistValue({
            sublistId: "customvalue",
            fieldId: "valueid",
            line: i
          })),
          name: safeString(rec.getSublistValue({
            sublistId: "customvalue",
            fieldId: "value",
            line: i
          })),
          inactive: asBool(rec.getSublistValue({
            sublistId: "customvalue",
            fieldId: "isinactive",
            line: i
          }))
        });
      }

      return {
        ok: true,
        kind: "customlist",
        source: {
          id: safeString(sourceId),
          scriptId: safeString(safeGetValue(rec, "scriptid")),
          name: safeString(safeGetValue(rec, "name"))
        },
        values
      };
    } catch (e) {
      return {
        ok: false,
        kind: "customlist",
        error: safeString(e && e.message ? e.message : e)
      };
    }
  }

  function tryResolveCustomRecordType(sourceId) {
    try {
      const typeRec = record.load({ type: "customrecordtype", id: sourceId });
      const scriptId = safeString(safeGetValue(typeRec, "scriptid"));
      const name = safeString(safeGetValue(typeRec, "name"));

      if (!scriptId) {
        return {
          ok: false,
          kind: "customrecord",
          error: "Custom record type scriptId not found"
        };
      }

      const values = [];
      const s = search.create({
        type: scriptId,
        filters: [],
        columns: [
          search.createColumn({ name: "internalid" }),
          search.createColumn({ name: "name" }),
          search.createColumn({ name: "isinactive" })
        ]
      });

      s.run().each((r) => {
        values.push({
          id: safeString(r.getValue({ name: "internalid" })),
          name: safeString(r.getValue({ name: "name" })),
          inactive: asBool(r.getValue({ name: "isinactive" }))
        });
        return true;
      });

      return {
        ok: true,
        kind: "customrecord",
        source: {
          id: safeString(sourceId),
          scriptId,
          name
        },
        values
      };
    } catch (e) {
      return {
        ok: false,
        kind: "customrecord",
        error: safeString(e && e.message ? e.message : e)
      };
    }
  }

  function serialiseItemOption(id) {
    const rec = record.load({
      type: "itemoptioncustomfield",
      id: id
    });

    const sourceId = safeString(safeGetValue(rec, "selectrecordtype"));
    const sourceText = safeString(safeGetText(rec, "selectrecordtype"));

    const appliedItemIds = getMultiValue(rec, "items");
    const includeChildItems = asBool(safeGetValue(rec, "includechilditems"));
    const appliedItems = getAppliedItems(appliedItemIds, includeChildItems);

    let sourceResult = null;
    if (sourceId) {
      const listTry = tryLoadCustomList(sourceId);
      if (listTry.ok) {
        sourceResult = listTry;
      } else {
        const recordTry = tryResolveCustomRecordType(sourceId);
        if (recordTry.ok) {
          sourceResult = recordTry;
        } else {
          sourceResult = {
            ok: false,
            sourceId,
            sourceText,
            listError: listTry.error,
            customRecordError: recordTry.error
          };
        }
      }
    }

    return {
      id: safeString(id),
      label: safeString(safeGetValue(rec, "label")),
      scriptId: safeString(safeGetValue(rec, "scriptid")),
      inactive: asBool(safeGetValue(rec, "inactive")),
      selectrecordtype: sourceId,
      selectrecordtype_text: sourceText,
      includeChildItems,
      appliesToSales: asBool(safeGetValue(rec, "colsale")),
      appliedItemIds,
      appliedItems,
      sourceResult
    };
  }

  function onRequest(context) {
    const response = context.response;
    const request = context.request;

    try {
      const discoveredIds = getItemOptionIds();
      let ids = discoveredIds.slice();

      const only = safeString(request.parameters.only);
      if (only) {
        const allowed = only.split(",").map((s) => s.trim()).filter(Boolean);
        ids = ids.filter((id) => allowed.indexOf(id) !== -1);
      }

      const includeInactive = safeString(request.parameters.includeInactive) === "T";

      let pageSize = parseInt(request.parameters.pageSize || "25", 10);
      if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 25;
      if (pageSize > 100) pageSize = 100;

      let page = parseInt(request.parameters.page || "1", 10);
      if (!Number.isFinite(page) || page < 1) page = 1;

      const totalRecords = ids.length;
      const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
      if (page > totalPages) page = totalPages;

      const startIndex = (page - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalRecords);

      const pageIds = ids.slice(startIndex, endIndex);

      const results = [];
      const errors = [];

      pageIds.forEach((id) => {
        try {
          const row = serialiseItemOption(id);
          if (!includeInactive && row.inactive) return;
          results.push(row);
        } catch (e) {
          errors.push({
            id: safeString(id),
            message: safeString(e && e.message ? e.message : e)
          });
        }
      });

      response.setHeader({
        name: "Content-Type",
        value: "application/json; charset=utf-8"
      });

      response.write(JSON.stringify({
        ok: true,
        meta: {
          configuredCount: discoveredIds.length,
          filteredCount: totalRecords,
          page,
          pageSize,
          totalPages,
          totalRecords,
          startIndex,
          endIndex: endIndex - 1,
          hasPrev: page > 1,
          hasNext: page < totalPages,
          prevPage: page > 1 ? page - 1 : null,
          nextPage: page < totalPages ? page + 1 : null
        },
        returnedCount: results.length,
        failed: errors.length,
        results,
        errors
      }));
    } catch (e) {
      response.setHeader({
        name: "Content-Type",
        value: "application/json; charset=utf-8"
      });

      response.write(JSON.stringify({
        ok: false,
        error: safeString(e && e.message ? e.message : e)
      }));
    }
  }

  return { onRequest };
});
