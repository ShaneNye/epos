/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/runtime', 'N/log', 'N/format'], (search, runtime, log, format) => {

  function onRequest(context) {
    const { request, response } = context;

    try {
      if (request.method !== 'GET') {
        return sendJSON(response, { ok: false, error: 'Only GET requests allowed' });
      }

      // === Script Parameters ===
      const script = runtime.getCurrentScript();
      const savedSearchId = script.getParameter({ name: 'custscript_savedsearch_id' });
      const recordTypeParam = script.getParameter({ name: 'custscript_sb_recordtype' });
      const expectedToken = script.getParameter({ name: 'custscript_api_token' });

      // === Token Check ===
      const providedToken = request.parameters.token;
      if (expectedToken && providedToken !== expectedToken) {
        return sendJSON(response, { ok: false, error: 'Unauthorized: invalid token' });
      }

      // === Incoming Parameters ===
      const lastName  = request.parameters.lastName || '';
      const email     = request.parameters.email || '';
      const postcode  = request.parameters.postcode || '';

      const locationParam = (request.parameters.location || '').trim(); // internal id preferred
      const zoneParam     = (request.parameters.zone || '').trim();     // expects e.g. "Zone 5"
      const dateFromParam = (request.parameters.dateFrom || request.parameters.fromDate || request.parameters.startDate || '').trim();
      const dateToParam   = (request.parameters.dateTo || request.parameters.toDate || request.parameters.endDate || '').trim();
      const dateField     = normalizeDateField(request.parameters.dateField);

      log.debug('Parameters', {
        lastName,
        email,
        postcode,
        location: locationParam,
        zone: zoneParam,
        dateFrom: dateFromParam,
        dateTo: dateToParam,
        dateField
      });

      if (!savedSearchId) {
        return sendJSON(response, { ok: false, error: 'Missing required script parameter: saved search ID' });
      }

      // === Map recordType param to NetSuite enum if possible ===
      let recordType = recordTypeParam || null;
      if (recordType && search.Type[recordType.toUpperCase()]) {
        recordType = search.Type[recordType.toUpperCase()];
      }

      // === Try to load the saved search ===
      let loadedSearch;
      try {
        loadedSearch = recordType
          ? search.load({ id: savedSearchId, type: recordType })
          : search.load({ id: savedSearchId });
      } catch (err) {
        return sendJSON(response, {
          ok: false,
          error: `Unable to load saved search ${savedSearchId}. Details: ${err.message}`
        });
      }

      // runPaged() requires a stable sort. A stock saved search sorted only by
      // lot number can page inconsistently because the same lot can exist at
      // multiple locations, causing rows to be skipped or swapped in the API
      // response even though they are visible in NetSuite's search UI.
      addFallbackSorts(loadedSearch, search, log);

      // === Build Filters (Expression) ===
      const filters = [];

      if (email) filters.push(['email', 'is', email]);

      if (lastName) {
        if (filters.length) filters.push('AND');
        filters.push(['lastname', 'is', lastName]);
      }

      if (postcode) {
        if (filters.length) filters.push('AND');
        filters.push(['zipcode', 'is', postcode]);
      }

      // Location filter
      if (locationParam) {
        if (filters.length) filters.push('AND');

        const isNumericId = /^\d+$/.test(locationParam);
        if (isNumericId) {
          filters.push(['location', 'anyof', locationParam]);
        } else {
          filters.push(['location', 'contains', locationParam]);
        }
      }

      // ✅ Zone filter (native bin zone) — matches your formula {binnumber.zone}
      if (zoneParam) {
        if (filters.length) filters.push('AND');

        // Use 'is' if exact match like "Zone 5"
        filters.push(['binnumber.zone', 'is', zoneParam]);

        // If yours sometimes differs, swap to:
        // filters.push(['binnumber.zone', 'contains', zoneParam]);
      }

      const dateFrom = dateFromParam ? formatSearchDate(dateFromParam, format) : '';
      const dateTo = dateToParam ? formatSearchDate(dateToParam, format) : '';

      if (dateFromParam && !dateFrom) {
        return sendJSON(response, { ok: false, error: 'Invalid dateFrom. Use YYYY-MM-DD or DD/MM/YYYY.' });
      }

      if (dateToParam && !dateTo) {
        return sendJSON(response, { ok: false, error: 'Invalid dateTo. Use YYYY-MM-DD or DD/MM/YYYY.' });
      }

      if (!dateField) {
        return sendJSON(response, { ok: false, error: 'Invalid dateField.' });
      }

      if (dateFrom) {
        if (filters.length) filters.push('AND');
        filters.push([dateField, 'onorafter', dateFrom]);
      }

      if (dateTo) {
        if (filters.length) filters.push('AND');
        filters.push([dateField, 'onorbefore', dateTo]);
      }

      log.debug('Applied Filters', filters);
      if (filters.length) loadedSearch.filterExpression = filters;

      // === Run search with pagination ===
      const results = [];
      const paged = loadedSearch.runPaged({ pageSize: 1000 });
      paged.pageRanges.forEach(pageRange => {
        const page = paged.fetch({ index: pageRange.index });
        page.data.forEach(result => {
          const row = {};
          result.columns.forEach(col => {
            const key = col.label || col.name || col.id;
            row[key] = result.getText(col) || result.getValue(col) || null;
          });
          results.push(row);
        });
      });

      return sendJSON(response, {
        ok: true,
        recordType: recordTypeParam || loadedSearch.searchType,
        searchId: savedSearchId,
        filtersUsed: {
          email,
          lastName,
          postcode,
          location: locationParam,
          zone: zoneParam,
          dateFrom: dateFromParam,
          dateTo: dateToParam,
          dateField
        },
        count: results.length,
        results
      });

    } catch (err) {
      log.error('Suitelet Error', err);
      return sendJSON(response, { ok: false, error: err.message });
    }
  }

  function sendJSON(response, obj) {
    response.setHeader({ name: 'Content-Type', value: 'application/json' });
    response.setHeader({ name: 'Access-Control-Allow-Origin', value: '*' });
    response.write(JSON.stringify(obj, null, 2));
  }

  function normalizeDateField(value) {
    const fieldId = String(value || 'trandate').trim() || 'trandate';
    return /^[A-Za-z0-9_.]+$/.test(fieldId) ? fieldId : '';
  }

  function formatSearchDate(value, format) {
    const parsedDate = parseDateParam(value);
    if (!parsedDate) return '';

    return format.format({
      value: parsedDate,
      type: format.Type.DATE
    });
  }

  function parseDateParam(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return buildDate(match[1], match[2], match[3]);

    match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return buildDate(match[3], match[2], match[1]);

    return null;
  }

  function buildDate(year, month, day) {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const date = new Date(y, m - 1, d);

    if (
      date.getFullYear() !== y ||
      date.getMonth() !== m - 1 ||
      date.getDate() !== d
    ) {
      return null;
    }

    return date;
  }

  function addFallbackSorts(loadedSearch, search, log) {
    try {
      const columns = loadedSearch.columns || [];
      const fallbackSorts = [];

      ['item', 'location', 'internalid', 'inventorynumber', 'binnumber'].forEach(name => {
        const existing = columns.find(col => col.name === name && !col.summary && !col.formula);
        const alreadySorted =
          columns.some(col => col.name === name && !!col.sort) ||
          fallbackSorts.some(col => col.name === name);

        if (existing && !alreadySorted) {
          fallbackSorts.push(
            search.createColumn({
              name: existing.name,
              join: existing.join,
              sort: search.Sort.ASC
            })
          );
        }
      });

      if (fallbackSorts.length) loadedSearch.columns = columns.concat(fallbackSorts);
    } catch (sortErr) {
      log.debug('Unable to add fallback search sorts', sortErr.message || sortErr);
    }
  }

  return { onRequest };
});
