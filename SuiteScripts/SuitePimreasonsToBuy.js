/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */
define(['N/search', 'N/record'], function(search, record) {

    function onRequest(context) {
        var request = context.request;
        var response = context.response;

        // Set CORS headers for all responses
        function setCORSHeaders() {
            response.setHeader({ name: 'Access-Control-Allow-Origin', value: '*' });
            response.setHeader({ name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' });
            response.setHeader({ name: 'Access-Control-Allow-Headers', value: 'Content-Type' });
            response.setHeader({ name: 'Content-Type', value: 'application/json' });
        }

        setCORSHeaders();

        // Handle preflight OPTIONS request
        if (request.method === 'OPTIONS') {
            response.write(JSON.stringify({ status: 'ok' }));
            return;
        }

        try {
            // If this request is attempting to attach a file to a record
            var params = request.parameters || {};
            var itemId = params.itemid || params.itemId || params.item;
            var fileId = params.fileid || params.fileId || params.file;
            var fieldId = params.fieldid || params.fieldId || params.field;
            var recType = params.rectype || params.rectype || params.rectype || params.rectype || 'customrecord_sb_reasons_to_buy';

            if (fileId && itemId && fieldId) {
                try {
                    // Load target record and set the file id on the given field
                    var targetType = String(recType || 'customrecord_sb_reasons_to_buy').trim();
                    var rec = record.load({ type: targetType, id: itemId, isDynamic: false });
                    rec.setValue({ fieldId: fieldId, value: parseInt(fileId, 10) });
                    var saved = rec.save({ enableSourcing: false, ignoreMandatoryFields: true });
                    response.write(JSON.stringify({ success: true, message: 'File attached', recordId: String(saved) }));
                    return;
                } catch (errAttach) {
                    response.write(JSON.stringify({ success: false, message: errAttach && errAttach.message ? errAttach.message : String(errAttach) }));
                    return;
                }
            }

            var mySearch = search.load({ id: 'customsearch_sb_sp_reasons_to_buy' }); // ✅ updated search ID
            var jsonData = [];
            var start = 0;
            var batchSize = 1000;
            var results;

            do {
                results = mySearch.run().getRange({ start: start, end: start + batchSize });

                results.forEach(function(result) {
                    var rowObj = {};
                    result.columns.forEach(function(col) {
                        var key = col.label || col.name || col.id; // fallback to id
                        var value = result.getText(col) || result.getValue(col) || null;
                        rowObj[key] = value;
                    });
                    jsonData.push(rowObj);
                });

                start += batchSize;
            } while (results.length === batchSize);

            response.write(JSON.stringify(jsonData));

        } catch (e) {
            response.write(JSON.stringify({ error: e.message }));
        }
    }

    return {
        onRequest: onRequest
    };
});
