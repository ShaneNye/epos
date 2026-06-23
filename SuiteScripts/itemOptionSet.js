/**********************************************************************************************************
 * Copyright © RSM UK Consulting.
 * All Rights Reserved.
 * This is the confidential and proprietary information of RSM UK Consulting.
 * The misuse of is strictly prohibited, in accordance with the terms of your agreement with RSM UK Consulting.
 *
 * Name:            Set Item Options (setItemOptions.js)
 *
 * Script Type:     User Event
 *
 * API Version:     2.1
 *
 * Version:         1.3.1 - 23/06/2026 - Removed taken FS sync; handled by in-store fulfilment
 *                  1.3.0 - 24/03/2026 - Added fallback to copy line options into
 *                                       custcol_sb_itemoptionsdisplay when blank,
 *                                       including REST Web Services created records
 *                  1.2.0 - 10/11/2025 - Added REST Web Services source check (skip)
 *                  1.0.0 - 05/10/2023 - OAK - Initial Release
 *
 * Author:          RSM UK Consulting
 * Script:          customscript_setitemoptions
 * Deploy:          customdeploy_setitemoptions (Sales Order)
 *
 * Purpose:         Gets item options in a custom field so that the value can be exported via Saved Search.
 *
 * Notes:           To be used for with DispatchTrack integration
 *
 * Dependencies:    N/A
 *
 **********************************************************************************************************/

/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 */

define(['../Library.RSM.2.0.js', 'N/record', 'N/log'],
    function (Library, nRecord, log)
    {
        function parseOptionsToDisplay(optionsValue)
        {
            var concatenatedItemOptions = '';
            var splitItemOptions = [];
            var splitIndividualItemOptions = [];

            if (!optionsValue) return '';

            if (optionsValue.indexOf('') > -1)
            {
                splitItemOptions = optionsValue.split('');

                for (var i = 0; i < splitItemOptions.length; i++)
                {
                    splitIndividualItemOptions = splitItemOptions[i].split('');

                    if (splitIndividualItemOptions.length == 5)
                    {
                        concatenatedItemOptions += splitIndividualItemOptions[2] + ': ' + splitIndividualItemOptions[4] + '\n';
                    }
                }
            }
            else if (optionsValue.indexOf('') > -1)
            {
                splitIndividualItemOptions = optionsValue.split('');

                if (splitIndividualItemOptions.length == 5)
                {
                    concatenatedItemOptions += splitIndividualItemOptions[2] + ': ' + splitIndividualItemOptions[4] + '\n';
                }
            }

            return concatenatedItemOptions;
        }

        function beforeSubmit(context)
        {
            var currentItemOptions = '';
            var currentRecord = {};
            var currentDisplayValue = '';
            var intercompanyTransactionID = '';
            var isRestWebServices = false;
            var lineCount = 0;
            var pairedLineID = '';
            var pairedLineIndex = -1;
            var pairedSalesOrderID = '';
            var pairedSalesOrder = {};
            var parsedDisplayValue = '';
            var sourceId = '';
            var sourceText = '';

            try
            {
                currentRecord = context.newRecord;

                sourceId = currentRecord.getValue({ fieldId: 'source' });
                sourceText = currentRecord.getText({ fieldId: 'source' }) || '';

                log.debug('Source Check', 'ID=' + sourceId + ' | Text=' + sourceText);

                isRestWebServices =
                    (sourceText && sourceText.toLowerCase().indexOf('rest web services') > -1) ||
                    (sourceId && String(sourceId).toLowerCase().indexOf('rest') > -1);

                lineCount = currentRecord.getLineCount({ sublistId: 'item' });
                intercompanyTransactionID = currentRecord.getValue({ fieldId: 'intercotransaction' });
                pairedSalesOrderID = currentRecord.getValue({ fieldId: 'custbody_sb_pairedsalesorder' });

                // Only load paired SO when not REST-created
                if (!isRestWebServices && intercompanyTransactionID && pairedSalesOrderID)
                {
                    pairedSalesOrder = nRecord.load({
                        type: nRecord.Type.SALES_ORDER,
                        id: pairedSalesOrderID
                    });
                }

                for (var i = 0; i < lineCount; i++)
                {
                    currentItemOptions = '';
                    parsedDisplayValue = '';

                    currentDisplayValue = currentRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_sb_itemoptionsdisplay',
                        line: i
                    }) || '';

                    // =========================================================
                    // 1) Determine source options value
                    // =========================================================
                    if (!isRestWebServices && intercompanyTransactionID && pairedSalesOrderID)
                    {
                        pairedLineID = currentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_sb_pairedlineid',
                            line: i
                        });

                        log.debug('pairedLineID', pairedLineID);

                        if (pairedLineID)
                        {
                            pairedLineIndex = pairedSalesOrder.findSublistLineWithValue({
                                sublistId: 'item',
                                fieldId: 'id',
                                value: pairedLineID
                            });

                            log.debug('pairedLineIndex', pairedLineIndex);

                            if (pairedLineIndex > -1)
                            {
                                currentItemOptions = pairedSalesOrder.getSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'options',
                                    line: pairedLineIndex
                                }) || '';
                            }
                        }
                    }
                    else
                    {
                        currentItemOptions = currentRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'options',
                            line: i
                        }) || '';
                    }

                    log.debug('Line ' + i + ' currentItemOptions', currentItemOptions);
                    log.debug('Line ' + i + ' currentDisplayValue', currentDisplayValue);

                    // =========================================================
                    // 2) If display field already populated, leave it alone
                    // =========================================================
                    if (currentDisplayValue)
                    {
                        continue;
                    }

                    // =========================================================
                    // 3) Try to parse structured options into readable display
                    // =========================================================
                    parsedDisplayValue = parseOptionsToDisplay(currentItemOptions);

                    if (parsedDisplayValue)
                    {
                        currentRecord.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_sb_itemoptionsdisplay',
                            line: i,
                            value: parsedDisplayValue
                        });

                        log.debug('Line ' + i, 'Set parsed item options display');
                        continue;
                    }

                    // =========================================================
                    // 4) Fallback:
                    //    If display is blank but options has a raw/manual value,
                    //    copy options directly into display
                    // =========================================================
                    if (currentItemOptions)
                    {
                        currentRecord.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_sb_itemoptionsdisplay',
                            line: i,
                            value: currentItemOptions
                        });

                        log.debug('Line ' + i, 'Fallback copy from options to itemoptionsdisplay');
                    }
                }
            }
            catch (e)
            {
                Library.errorHandler('beforeSubmit', e);
            }
        }

        return {
            beforeSubmit: beforeSubmit
        };
    });
