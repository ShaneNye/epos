/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */

define(['N/search', 'N/runtime', 'N/log'], (search, runtime, log) => {

  function onRequest(context) {
    const { request, response } = context;

    try {
      if (request.method !== 'GET') {
        return sendJSON(response, { ok: false, error: 'Only GET requests allowed' });
      }

      // === Script Parameters ===
      const script = runtime.getCurrentScript();
      const savedSearchId = script.getParameter({ name: 'custscript_savedsearch_id' });
      const recordTypeParam = script.getParameter({ name: 'custscript_sb_recordtype' }); // optional
      const expectedToken = script.getParameter({ name: 'custscript_api_token' });

      // === Token Check ===
      const providedToken = request.parameters.token;
      if (expectedToken && providedToken !== expectedToken) {
        return sendJSON(response, { ok: false, error: 'Unauthorized: invalid token' });
      }

      // === Incoming Parameters ===
      const lastName = request.parameters.lastName || '';
      const email = request.parameters.email || '';
      const postcode = request.parameters.postcode || '';

      log.debug('Customer Match Parameters', { lastName, email, postcode });

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
          error: `Unable to load saved search ${savedSearchId}. ` +
                 `Check if it exists, is active, and accessible to this script role. Details: ${err.message}`
        });
      }

      // === Build Exact-Match Filters ===
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

      // === Return JSON ===
      return sendJSON(response, {
        ok: true,
        recordType: recordTypeParam || loadedSearch.searchType,
        searchId: savedSearchId,
        filtersUsed: { email, lastName, postcode },
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

  return { onRequest };
});
