/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * SuiteQL Dev Tool
 */

define(['N/ui/serverWidget', 'N/query', 'N/log'], (serverWidget, query, log) => {

  const onRequest = (context) => {
    if (context.request.method === 'GET') {
      renderForm(context);
      return;
    }

    const suiteql = context.request.parameters.custpage_suiteql_query || '';
    let output = '';

    try {
      const results = query.runSuiteQL({
        query: suiteql
      }).asMappedResults();

      output = JSON.stringify(results, null, 2);

    } catch (error) {
      log.error('SuiteQL Error', error);

      output = JSON.stringify({
        success: false,
        message: error.message,
        name: error.name
      }, null, 2);
    }

    renderForm(context, suiteql, output);
  };

  const renderForm = (context, suiteql = getDefaultQuery(), output = '') => {
    const form = serverWidget.createForm({
      title: 'SuiteQL Dev Tool'
    });

    const queryField = form.addField({
      id: 'custpage_suiteql_query',
      type: serverWidget.FieldType.LONGTEXT,
      label: 'SuiteQL Query'
    });

    queryField.defaultValue = suiteql;

    const outputField = form.addField({
      id: 'custpage_suiteql_output',
      type: serverWidget.FieldType.LONGTEXT,
      label: 'JSON Result'
    });

    outputField.defaultValue = output;

    outputField.updateDisplaySize({
      height: 30,
      width: 100
    });

    queryField.updateDisplaySize({
      height: 15,
      width: 100
    });

    form.addSubmitButton({
      label: 'Run SuiteQL'
    });

    context.response.writePage(form);
  };

  const getDefaultQuery = () => {
    return `SELECT
  id,
  entitytitle AS name
FROM
  customer
WHERE
  isinactive = 'F'
ORDER BY
  entitytitle`;
  };

  return {
    onRequest
  };

});