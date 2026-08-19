/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * 
 * Author: Shane Nye
 * Company: Sussex Beds
 * Description: automatically populates the corresponding child records for the custom record 'Ticket POS'
 * 
 * Last Modified: 31/07/2026
 * Modification: Added support for multiple child matrix-option filters with legacy fallback
 */
define(['N/record', 'N/search', 'N/log'], function (record, search, log) {

    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
            return;
        }

        log.debug('Execution Started', 'Script execution has begun');

        try {
            var rec = context.newRecord;
            var primaryItemId = rec.getValue('custrecord_sb_primary_item');
            var secondaryItemId = rec.getValue('custrecord_sb_ticket_pos_secondary_paren');
            var secondaryItemClass = rec.getValue('custrecord_sb_secondary_class');

            var disableSlimSlRaw = rec.getValue('custrecord_sb_disable_slim_sl');
            var disableSlimSl = disableSlimSlRaw === true || disableSlimSlRaw === 'T';

            log.debug('Primary Item ID Retrieved', primaryItemId ? 'Primary Item ID: ' + primaryItemId : 'No Primary Item Found');
            log.debug('Secondary Item ID Retrieved', secondaryItemId ? 'Secondary Item ID: ' + secondaryItemId : 'No Secondary Item Found');
            log.debug('item class:' + secondaryItemClass);
            log.debug('Disable Slim Z&L', disableSlimSl);

            if (!primaryItemId && !secondaryItemId) {
                log.debug('No Parent Matrix Item or Secondary Item', 'Skipping record processing.');
                return;
            }

            var sizeMapping = {
                '2': 'Single',
                '3': 'Small Double',
                '4': 'Double',
                '5': 'King',
                '6': 'Super King',
                '104': 'King Zipped',
                '105': 'Super King Zipped',
            };

            var adjustableSizeMapping = {
                '2': 'Euro Single',
                '3': 'Euro Small Double',
                '4': 'Euro Double',
                '5': 'Euro King',
                '6': 'Euro Super King'
            };

            var allChildItems = {};

            /**
             * Primary Item Logic
             */
            if (primaryItemId) {
                log.debug('Executing Child Item Search', 'Searching for items with parent ID: ' + primaryItemId);

                var priceMapId = rec.getValue('custrecord_ticket_pos_cust_price_map');
                var additionalMapMatrixList = rec.getValue('custrecord_ticket_pos_matrix_list_id');
                var additionalmapMatrixOption = rec.getValue('custrecord_ticket_pos_option_id');
                var childMatrixFilters = [];

                if (priceMapId) {
                    try {
                        var priceMapChildSearch = search.create({
                            type: 'customrecord_sb_ticket_pos_pri_map_chld',
                            filters: [
                                ['custrecord_sb_pm_parent', 'anyof', priceMapId],
                                'AND',
                                ['isinactive', 'is', 'F']
                            ],
                            columns: [
                                'custrecord_sb_pm_child_mat_opt_id',
                                'custrecord_sb_pm_var_id'
                            ]
                        });

                        priceMapChildSearch.run().each(function (result) {
                            var childMatrixList = result.getValue('custrecord_sb_pm_child_mat_opt_id');
                            var childMatrixOption = result.getValue('custrecord_sb_pm_var_id');

                            if (childMatrixList && childMatrixOption) {
                                childMatrixFilters.push({
                                    matrixList: childMatrixList,
                                    matrixOption: childMatrixOption
                                });
                            } else {
                                log.debug(
                                    'Incomplete Price Map Child Ignored',
                                    'Child ID: ' + result.id +
                                    ' | Matrix List: ' + childMatrixList +
                                    ' | Matrix Option: ' + childMatrixOption
                                );
                            }

                            return true;
                        });
                    } catch (priceMapChildError) {
                        log.error(
                            'Unable to Load Price Map Children',
                            'Price Map ID: ' + priceMapId + ' | ' + priceMapChildError.message
                        );
                    }
                }

                log.debug('Additional Matrix Matrix List:', additionalMapMatrixList);
                log.debug('Additional Matrix Option Matrix Option:', additionalmapMatrixOption);

                var matrixField = 'custitem2';

                if (additionalMapMatrixList === 'custitem1') matrixField = 'custitem1';
                if (additionalMapMatrixList === 'custitem21') matrixField = 'custitem21';

                var filters = [
                    ['parent', 'anyof', primaryItemId],
                    'AND',
                    [matrixField, 'isnotempty', ''],
                    'AND',
                    ['isinactive', 'is', 'F']
                ];

                if (childMatrixFilters.length) {
                    childMatrixFilters.forEach(function (childMatrixFilter) {
                        filters.push('AND');
                        filters.push([
                            childMatrixFilter.matrixList,
                            'anyof',
                            childMatrixFilter.matrixOption
                        ]);
                    });

                    log.debug('Price Map Child Filters Applied', JSON.stringify(childMatrixFilters));
                } else if (additionalMapMatrixList && additionalmapMatrixOption) {
                    // Legacy records store a single matrix list/option pair directly.
                    filters.push('AND');
                    filters.push([additionalMapMatrixList, 'anyof', additionalmapMatrixOption]);
                }

                var storageMatrixField = rec.getValue('custrecord_store_mat_id');
                var storageMatrixOption = rec.getValue('custrecord_storage_id');

                if (storageMatrixField && storageMatrixOption) {
                    filters.push('AND');
                    filters.push([storageMatrixField, 'anyof', storageMatrixOption]);
                }

                var itemSearch = search.create({
                    type: search.Type.ITEM,
                    filters: filters,
                    columns: ['internalid', matrixField]
                });

                var searchResultCount = 0;

                if (matrixField !== 'custitem21') {
                    log.debug('initializing standard Size Mapping');

                    itemSearch.run().each(function (result) {
                        var itemId = result.getValue('internalid');
                        var sizeOptionInternalId = result.getValue(matrixField);
                        var sizeOption = sizeMapping[sizeOptionInternalId] || 'Unknown';

                        searchResultCount++;

                        log.debug(
                            'Primary Child Item Found',
                            'Item ID: ' + itemId +
                            ' | Size Option ID: ' + sizeOptionInternalId +
                            ' | Mapped Value: ' + sizeOption
                        );

                        switch (sizeOption) {
                            case 'Single':
                                allChildItems['custrecord_sb_tick_single'] = itemId;
                                break;
                            case 'Small Double':
                                allChildItems['custrecord_sb_tick_smll_dble'] = itemId;
                                break;
                            case 'Double':
                                allChildItems['custrecord_sb_tick_double'] = itemId;
                                break;
                            case 'King':
                                allChildItems['custrecord_sb_tick_king'] = itemId;
                                break;
                            case 'Super King':
                                allChildItems['custrecord_sb_tick_sking'] = itemId;
                                break;
                            case 'King Zipped':
                                allChildItems['custrecord_sb_king_zipped'] = itemId;
                                break;
                            case 'Super King Zipped':
                                allChildItems['custrecord_sb_super_king_zipped'] = itemId;
                                break;
                        }

                        return true;
                    });
                } else {
                    log.debug('initializing Adjustable Sizes');

                    itemSearch.run().each(function (result) {
                        var itemId = result.getValue('internalid');
                        var sizeOptionInternalId = result.getValue(matrixField);
                        var sizeOption = sizeMapping[sizeOptionInternalId] || 'Unknown';

                        searchResultCount++;

                        log.debug(
                            'Primary Child Item Found',
                            'Item ID: ' + itemId +
                            ' | Size Option ID: ' + sizeOptionInternalId +
                            ' | Mapped Value: ' + sizeOption
                        );

                        switch (sizeOption) {
                            case 'Single':
                                allChildItems['custrecord_sb_tick_single'] = itemId;
                                break;
                            case 'Small Double':
                                allChildItems['custrecord_sb_tick_smll_dble'] = itemId;
                                break;
                            case 'Double':
                                allChildItems['custrecord_sb_tick_double'] = itemId;
                                break;
                            case 'King':
                                allChildItems['custrecord_sb_tick_king'] = itemId;
                                break;
                            case 'Super King':
                                allChildItems['custrecord_sb_tick_sking'] = itemId;
                                break;
                        }

                        return true;
                    });
                }

                log.debug('Total Primary Child Items Found', searchResultCount);
            }

            /**
             * Secondary Item Logic
             */
            if (secondaryItemId) {
                var secondaryItemMapping = {
                    
                    // Single Base Mapping // 

                    '2_1': 'custrecord_sb_single_non_store',
                    '2_19': 'custrecord_sb_single_2_drawer',
                    '2_2': 'custrecord_sb_single_2_drawer',
                    '2_21': 'custrecord_sb_single_4_drawer',
                    '2_3': 'custrecord_sb_single_4_drawer',
                    '2_4': 'custrecord_sb_single_side_list',
                    '2_5': 'custrecord_sb_single_end_lift',
                    '2_7': 'custrecord_single_shallow',
                    '2_13': 'custrecord_single_slim',

                    // Small Double Base Mapping // 

                    '3_1': 'custrecordsb_small_double_non_store',
                    '3_2': 'custrecord_sb_small_double_2_drawer',
                    '3_21': 'custrecord_sb_small_double_4_drawer',
                    '3_3': 'custrecord_sb_small_double_4_drawer',
                    '3_4': 'custrecord_sb_small_double_side_lift',
                    '3_5': 'custrecord_sb_small_double_end_lift',
                    '3_7': 'custrecord_small_double_shallow',
                    '3_13': 'custrecord_small_double_slim',

                    // Double Base Mapping // 

                    '4_1': 'custrecord_sb_double_non_store',
                    '4_2': 'custrecord_sb_double_2_drawer',
                    '4_21': 'custrecord_sb_double_4_drawer',
                    '4_3': 'custrecord_sb_double_4_drawer',
                    '4_4': 'custrecord_sb_double_side_lift',
                    '4_5': 'custrecord_sb_double_end_lift',
                    '4_7': 'custrecord_double_shallow',
                    '4_13': 'custrecord_double_slim',

                    // King Base Mapping // 

                    '5_1': 'custrecord_sb_king_non_store',
                    '5_2': 'custrecord_sb_king_2_drawer',
                    '5_21': 'custrecord_sb_king_4_drawer',
                    '5_3': 'custrecord_sb_king_4_drawer',
                    '5_4': 'custrecord_sb_king_side_lift',
                    '5_5': 'custrecord_sb_king_end_lift',
                    '5_7': 'custrecord_king_shallow',
                    '5_13': 'custrecord_king_slim',

                    // Super King Base Mapping //

                    '6_1': 'custrecord_sb_superking_non_store',
                    '6_2': 'custrecord_sb_superking_2_drawer',
                    '6_21': 'custrecord_sb_super_king_4_drawer',
                    '6_3': 'custrecord_sb_super_king_4_drawer',
                    '6_4': 'custrecord_sb_superking_side_lift',
                    '6_5': 'custrecord_sb_superking_end_lift',
                    '6_7': 'custrecord_superking_shallow',
                    '6_13': 'custrecord_sb_superking_slim',

                    // King Zipped Base Mapping // 

                    '104_1': 'custrecord_sb_king_zl_non_store',
                    '104_2': 'custrecord_sb_king_zl_2_drw',
                    '104_21': 'custrecord_sb_king_zl_4_drawer',
                    '104_7' : 'custrecord_sb_king_zl_shallow',
                    '104_13' : 'custrecord_sb_king_zl_slim',
                    '104_4': 'custrecord_sb_king_zl_side_lift',
                    '104_5' : 'custrecord_sb_king_zl_end_lift',

                    // Super King Zipped Base Mapping //

                    '105_1': 'custrecord_sb_sk_zl_non_store',
                    '105_2': 'custrecord_sb_sk_zl_2_drw',
                    '105_21': 'custrecord_sb_sk_zl_4_drw', 
                    '105_7' : 'custrecord_sb_sk_zl_shallow',
                    '105_13' : 'custrecord_sb_sk_zl_slim',
                    '105_4': 'custrecord_sb_sk_zl_side_otto',
                    '105_5' : 'custrecord_sb_sk_zl_end_otto'
                };

                if (additionalMapMatrixList != 'custitem21' && secondaryItemClass != 2) {

                    var secondarySearch = search.load({
                        id: 'customsearch_sb_item_by_matrix_option'
                    });

                    secondarySearch.filters.push(
                        search.createFilter({
                            name: 'class',
                            operator: search.Operator.ANYOF,
                            values: [secondaryItemClass]
                        })
                    );

                    secondarySearch.run().each(function (result) {
                        var itemId = result.getValue('internalid');
                        var sizeOption = result.getValue('custitem2');
                        var matrixOption;

                        if (secondaryItemId == '20911') {
                            matrixOption = result.getValue('custitem21');
                        } else {
                            matrixOption = result.getValue('custitem15');
                        }

                        var parentId = result.getValue('parent');

                        log.debug(
                            'Secondary Item Search Result',
                            'Item ID: ' + itemId +
                            ' | Size Option: ' + sizeOption +
                            ' | Matrix Option: ' + matrixOption +
                            ' | Parent ID: ' + parentId
                        );

                        if (parentId == secondaryItemId) {
                            var key = sizeOption + '_' + matrixOption;
                            var mappedField = secondaryItemMapping[key];

                            if (mappedField) {
                                allChildItems[mappedField] = itemId;
                                log.debug('Mapping Found', 'Mapped Field: ' + mappedField + ' | Child Item ID: ' + itemId);
                            } else {
                                log.debug('No Mapping Found for Combination', 'Combination: ' + key + ' does not match any mapping.');
                            }
                        }

                        return true;
                    });

                } else if (additionalMapMatrixList === 'custitem21' && secondaryItemClass != 2) {

                    var adjustableSecondarySearch = search.load({
                        id: 'customsearch_sb_item_by_matrix_option'
                    });

                    adjustableSecondarySearch.filters.push(
                        search.createFilter({
                            name: 'class',
                            operator: search.Operator.ANYOF,
                            values: [secondaryItemClass]
                        })
                    );

                    adjustableSecondarySearch.run().each(function (result) {
                        var itemId = result.getValue('internalid');
                        var sizeOption = result.getValue('custitem21');
                        var matrixOption = result.getValue('custitem358');
                        var parentId = result.getValue('parent');

                        log.debug(
                            'Secondary Item Search Result',
                            'Item ID: ' + itemId +
                            ' | Size Option: ' + sizeOption +
                            ' | Matrix Option: ' + matrixOption +
                            ' | Parent ID: ' + parentId
                        );

                        if (parentId == secondaryItemId) {
                            var key = sizeOption + '_' + matrixOption;
                            var mappedField = secondaryItemMapping[key];

                            if (mappedField) {
                                allChildItems[mappedField] = itemId;
                                log.debug('Mapping Found', 'Mapped Field: ' + mappedField + ' | Child Item ID: ' + itemId);
                            } else {
                                log.debug('No Mapping Found for Combination', 'Combination: ' + key + ' does not match any mapping.');
                            }
                        }

                        return true;
                    });
                }

                log.debug('Secondary Child Items Found', JSON.stringify(allChildItems));
            }

            /**
             * Frame Logic
             */
            if (secondaryItemClass == 2) {
                var frameSearch = search.create({
                    type: search.Type.ITEM,
                    filters: [
                        ['parent', 'anyof', secondaryItemId],
                    ],
                    columns: ['internalid', 'custitem21']
                });

                var frameSearchResultCount = 0;

                frameSearch.run().each(function (result) {
                    var frameid = result.getValue('internalid');
                    var framesize = result.getValue('custitem21');

                    var frameSizeOption = adjustableSizeMapping[framesize] || 'unknown';

                    frameSearchResultCount++;

                    log.debug('Frames Found', frameSearchResultCount);
                    log.debug(
                        'Frame Found: ',
                        'item ID: ' + frameid +
                        ' | Size Option: ' + framesize +
                        ' | mapped value: ' + frameSizeOption
                    );

                    switch (frameSizeOption) {
                        case 'Euro Single':
                            allChildItems['custrecord_sb_single_frame'] = frameid;
                            break;
                        case 'Euro Small Double':
                            allChildItems['custrecord_sb_small_dbl_frame'] = frameid;
                            break;
                        case 'Euro Double':
                            allChildItems['custrecord_sb_double_frame'] = frameid;
                            break;
                        case 'Euro King':
                            allChildItems['custrecord_sb_king_frame'] = frameid;
                            break;
                        case 'Euro Super King':
                            allChildItems['custrecord_sb_s_king_frame'] = frameid;
                            break;
                    }

                    return true;
                });
            }

            /**
             * Slim Z&L Disable Logic
             * 
             * If checked, force these fields to clear.
             * This allows the PDF/HTML print template to automatically stop rendering them.


             //// I killed this If block as the requirements changed for divan set layout /////
            
            if (disableSlimSl) {
                allChildItems['custrecord_sb_king_zipped'] = null;
                allChildItems['custrecord_sb_super_king_zipped'] = null;

                log.debug(
                    'Disable Slim Z&L Applied',
                    'custrecord_sb_king_zipped and custrecord_sb_super_king_zipped set to null'
                );
            }

            **/

            /**
             * Submit all updates in a single call
             */
            if (Object.keys(allChildItems).length > 0) {
                try {
                    record.submitFields({
                        type: rec.type,
                        id: rec.id,
                        values: allChildItems
                    });

                    log.debug('Child Items Updated Successfully', JSON.stringify(allChildItems));

                } catch (e) {
                    log.error('Error Submitting Fields', 'Error while updating custom record: ' + e.message);
                }
            } else {
                log.debug(
                    'No Matching Child Items Found',
                    'Ensure that the custitem2 + custitem15 combinations are correctly set on the secondary item.'
                );
            }

        } catch (error) {
            log.error('Error Updating Child Matrix Items', error);
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
