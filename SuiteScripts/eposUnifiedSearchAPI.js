/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Description:
 *   - Generic Suitelet to expose any saved search as JSON.
 *   - Parameters:
 *       custscript_epos_savedsearch_id  (Text)   → Saved Search Internal ID
 *       custscript_epos_recordtype      (Text)   → Record type (e.g., customer, salesorder)
 */

define(['N/search', 'N/runtime'], (search, runtime) => {

  function onRequest(context) {
    const { request, response } = context;

    try {
      // Allow only GET requests
      if (request.method !== 'GET') {
        response.writeHead(405);
        return response.write(JSON.stringify({ ok: false, error: 'Only GET requests allowed' }));
      }

      // Get parameters from script deployment
      const script = runtime.getCurrentScript();
      const savedSearchId = script.getParameter({ name: 'custscript_epos_savedsearch_id' });
      const recordType = script.getParameter({ name: 'custscript_epos_recordtype' });

      if (!savedSearchId || !recordType) {
        response.writeHead(400);
        return response.write(JSON.stringify({
          ok: false,
          error: 'Missing required script parameters: custscript_epos_savedsearch_id or custscript_epos_recordtype'
        }));
      }

      // Load the saved search
      let loadedSearch;
      try {
        loadedSearch = search.load({ id: savedSearchId });
      } catch (err) {
        log.error('Search load failed', err);
        response.writeHead(404);
        return response.write(JSON.stringify({ ok: false, error: 'Saved search not found' }));
      }

      // Run and extract results
      const results = [];
      loadedSearch.run().each(result => {
        const row = {};
        result.columns.forEach(col => {
          const name = col.label || col.name;
          row[name] = result.getValue(col);
        });
        results.push(row);
        return true;
      });

      // Write JSON response
      response.setHeader({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*' // Adjust or restrict to your EPOS domain if needed
      });

      response.write(JSON.stringify({
        ok: true,
        recordType,
        searchId: savedSearchId,
        count: results.length,
        results
      }, null, 2));

    } catch (err) {
      log.error('Suitelet Error', err);
      response.writeHead(500);
      response.write(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  return { onRequest };
});
