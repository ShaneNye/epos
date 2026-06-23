/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {

  const FIELD_PAIRED_LINE_ID = 'custcol_sb_pairedlineid';
  const FIELD_TAKEN_FROM_STORE = 'custcol_sb_taken_from_store';
  const FIELD_LOT_NUMBER = 'custcol_sb_lotnumber';
  const FIELD_SUBSIDIARY_DC_LOCATION = 'custrecord_storedistributioncentreloc';

  function afterSubmit(context) {
    try {
      if (
        context.type !== context.UserEventType.CREATE &&
        context.type !== context.UserEventType.EDIT
      ) return;

      const currentSoId = context.newRecord.id;

      const currentSo = record.load({
        type: record.Type.SALES_ORDER,
        id: currentSoId,
        isDynamic: false
      });

      const customerId = currentSo.getValue({ fieldId: 'entity' });
      if (!customerId) return;

      const customerData = search.lookupFields({
        type: search.Type.CUSTOMER,
        id: customerId,
        columns: ['entityid']
      });

      const entityId = customerData.entityid || '';

      log.audit('Customer Check', {
        currentSoId,
        customerId,
        entityId
      });

      if (!entityId.startsWith('I/C -')) {
        log.audit('Skipped', 'Entity does not start with I/C -');
        return;
      }

      const pairedSoId = currentSo.getValue({
        fieldId: 'custbody_sb_pairedsalesorder'
      });

      const intercoTransactionId = currentSo.getValue({
        fieldId: 'intercotransaction'
      });

      if (!pairedSoId || !intercoTransactionId) {
        log.audit('Skipped', 'No paired SO or intercompany transaction');
        return;
      }

      const pairedSo = record.load({
        type: record.Type.SALES_ORDER,
        id: pairedSoId,
        isDynamic: false
      });

      const pairedSubsidiaryId = pairedSo.getValue({
        fieldId: 'subsidiary'
      });

      const fulfilmentLocationId = getSubsidiaryFulfilmentLocation(pairedSubsidiaryId);

      log.audit('Fulfilment Location Lookup', {
        pairedSoId,
        pairedSubsidiaryId,
        fulfilmentLocationId
      });

      if (!fulfilmentLocationId) {
        log.error('Skipped', 'No fulfilment location found on subsidiary');
        return;
      }

      const currentLineCount = currentSo.getLineCount({
        sublistId: 'item'
      });

      const targetOrderLines = [];
      let currentSoNeedsSave = false;

      log.audit('Auto Store Fulfilment Start', {
        currentSoId,
        pairedSoId,
        currentLineCount
      });

      for (let i = 0; i < currentLineCount; i++) {
        const pairedLineId = currentSo.getSublistValue({
          sublistId: 'item',
          fieldId: FIELD_PAIRED_LINE_ID,
          line: i
        });

        const currentQuantity = Number(currentSo.getSublistValue({
          sublistId: 'item',
          fieldId: 'quantity',
          line: i
        })) || 0;

        const currentCommitted = Number(currentSo.getSublistValue({
          sublistId: 'item',
          fieldId: 'quantitycommitted',
          line: i
        })) || 0;

        const currentAllocated = Number(currentSo.getSublistValue({
          sublistId: 'item',
          fieldId: 'quantityallocated',
          line: i
        })) || 0;

        log.audit('Current SO Line Check', {
          currentLine: i,
          pairedLineId,
          currentQuantity,
          currentCommitted,
          currentAllocated
        });

        if (!pairedLineId) continue;

        const pairedLineIndex = pairedSo.findSublistLineWithValue({
          sublistId: 'item',
          fieldId: 'id',
          value: pairedLineId
        });

        if (pairedLineIndex < 0) {
          log.error('Paired Line Not Found', {
            currentLine: i,
            pairedLineId
          });
          continue;
        }

        const pairedTakenFromStore = pairedSo.getSublistValue({
          sublistId: 'item',
          fieldId: FIELD_TAKEN_FROM_STORE,
          line: pairedLineIndex
        });

        const currentTakenFromStore = currentSo.getSublistValue({
          sublistId: 'item',
          fieldId: FIELD_TAKEN_FROM_STORE,
          line: i
        });

        const takenFromStore = pairedTakenFromStore === true || pairedTakenFromStore === 'T';

        log.audit('Taken FS Pulled From Paired SO', {
          currentLine: i,
          pairedLineIndex,
          currentTakenFromStore,
          pairedTakenFromStore,
          takenFromStore
        });

        if ((currentTakenFromStore === true || currentTakenFromStore === 'T') !== takenFromStore) {
          currentSo.setSublistValue({
            sublistId: 'item',
            fieldId: FIELD_TAKEN_FROM_STORE,
            line: i,
            value: takenFromStore
          });

          currentSoNeedsSave = true;
        }

        if (!takenFromStore) continue;
        if (currentQuantity <= 0) continue;

        if (currentCommitted !== currentQuantity && currentAllocated !== currentQuantity) {
          log.audit('Line Skipped', {
            reason: 'Not fully committed / allocated',
            currentLine: i,
            currentQuantity,
            currentCommitted,
            currentAllocated
          });
          continue;
        }

        const pairedQuantity = Number(pairedSo.getSublistValue({
          sublistId: 'item',
          fieldId: 'quantity',
          line: pairedLineIndex
        })) || currentQuantity;

        const pairedFulfilled = Number(pairedSo.getSublistValue({
          sublistId: 'item',
          fieldId: 'quantityfulfilled',
          line: pairedLineIndex
        })) || 0;

        const pairedOrderLine = pairedSo.getSublistValue({
          sublistId: 'item',
          fieldId: 'line',
          line: pairedLineIndex
        });

        const currentOrderLine = currentSo.getSublistValue({
          sublistId: 'item',
          fieldId: 'line',
          line: i
        });

        const currentItemId = currentSo.getSublistValue({
          sublistId: 'item',
          fieldId: 'item',
          line: i
        });

        const lotNumberValue = pairedSo.getSublistValue({
          sublistId: 'item',
          fieldId: FIELD_LOT_NUMBER,
          line: pairedLineIndex
        });

        const lotNumberText = pairedSo.getSublistText({
          sublistId: 'item',
          fieldId: FIELD_LOT_NUMBER,
          line: pairedLineIndex
        });

        log.audit('Paired SO Fulfilment Check', {
          currentLine: i,
          pairedLineIndex,
          pairedQuantity,
          pairedFulfilled,
          pairedOrderLine,
          currentOrderLine,
          lotNumberValue,
          lotNumberText
        });

        if (pairedFulfilled >= pairedQuantity) continue;

        targetOrderLines.push({
          orderLine: String(currentOrderLine),
          pairedLineIndex,
          itemId: currentItemId,
          lotNumberValue,
          lotNumberText,
          quantity: pairedQuantity
        });
      }

      if (!targetOrderLines.length) {
        if (currentSoNeedsSave) {
          currentSo.save({
            enableSourcing: true,
            ignoreMandatoryFields: false
          });

          log.audit('Current SO Saved With Paired Taken FS', currentSoId);
        }

        log.audit('Skipped', 'No qualifying lines to fulfil');
        return;
      }

      createItemFulfilment({
        salesOrderId: currentSoId,
        targetOrderLines,
        fulfilmentLocationId
      });

      if (currentSoNeedsSave) {
        currentSo.save({
          enableSourcing: true,
          ignoreMandatoryFields: false
        });

        log.audit('Current SO Saved With Paired Taken FS', currentSoId);
      }

    } catch (e) {
      log.error('Auto Store Fulfilment Error', {
        name: e.name,
        message: e.message,
        stack: e.stack
      });
    }
  }

  function createItemFulfilment(options) {
    const salesOrderId = options.salesOrderId;
    const targetOrderLines = options.targetOrderLines;
    const fulfilmentLocationId = options.fulfilmentLocationId;

    const fulfilment = record.transform({
      fromType: record.Type.SALES_ORDER,
      fromId: salesOrderId,
      toType: record.Type.ITEM_FULFILLMENT,
      isDynamic: false
    });

    const fulfilmentLineCount = fulfilment.getLineCount({
      sublistId: 'item'
    });

    let fulfilledLineCount = 0;

    for (let i = 0; i < fulfilmentLineCount; i++) {
      const fulfilmentOrderLine = fulfilment.getSublistValue({
        sublistId: 'item',
        fieldId: 'orderline',
        line: i
      });

      const targetLine = targetOrderLines.find(line =>
        line.orderLine === String(fulfilmentOrderLine)
      );

      if (!targetLine) {
        fulfilment.setSublistValue({
          sublistId: 'item',
          fieldId: 'itemreceive',
          line: i,
          value: false
        });

        continue;
      }

      fulfilment.setSublistValue({
        sublistId: 'item',
        fieldId: 'itemreceive',
        line: i,
        value: true
      });

      fulfilment.setSublistValue({
        sublistId: 'item',
        fieldId: 'location',
        line: i,
        value: Number(fulfilmentLocationId)
      });

      fulfilment.setSublistValue({
        sublistId: 'item',
        fieldId: 'quantity',
        line: i,
        value: Number(targetLine.quantity)
      });

      log.audit('Fulfilment Line Pre-Commit', {
        fulfilmentLine: i,
        orderline: fulfilmentOrderLine,
        itemreceive: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'itemreceive',
          line: i
        }),
        item: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'item',
          line: i
        }),
        location: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'location',
          line: i
        }),
        quantity: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'quantity',
          line: i
        }),
        inventorydetailavail: getFulfilmentLineValueSafe(fulfilment, i, 'inventorydetailavail'),
        inventorydetailset: getFulfilmentLineValueSafe(fulfilment, i, 'inventorydetailset')
      });

      const itemId = fulfilment.getSublistValue({
        sublistId: 'item',
        fieldId: 'item',
        line: i
      });

      log.audit('Fulfilment Current Line Before Inventory Detail', {
        line: i,
        itemreceive: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'itemreceive',
          line: i
        }),
        item: itemId,
        location: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'location',
          line: i
        }),
        quantity: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'quantity',
          line: i
        }),
        inventorydetailavail: getFulfilmentLineValueSafe(fulfilment, i, 'inventorydetailavail'),
        inventorydetailset: getFulfilmentLineValueSafe(fulfilment, i, 'inventorydetailset')
      });

      const initialLotNumberId = resolveLotNumberId({
        lotNumberValue: targetLine.lotNumberValue,
        lotNumberText: targetLine.lotNumberText,
        itemId
      });

      if (!initialLotNumberId) {
        log.error('Lot Number Not Resolved From Paired SO Field', {
          fulfilmentLine: i,
          itemId,
          lotNumberValue: targetLine.lotNumberValue,
          lotNumberText: targetLine.lotNumberText
        });

        fulfilment.setSublistValue({
          sublistId: 'item',
          fieldId: 'itemreceive',
          line: i,
          value: false
        });

        continue;
      }

      const inventoryBalance = resolveInventoryBalance({
        itemId,
        locationId: fulfilmentLocationId,
        initialLotNumberId,
        lotNumberText: targetLine.lotNumberText,
        requiredQuantity: targetLine.quantity
      });

      if (!inventoryBalance.inventoryNumberId || !inventoryBalance.binNumberId) {
        log.error('Inventory Balance Assignment Not Resolved', {
          fulfilmentLine: i,
          itemId,
          fulfilmentLocationId,
          initialLotNumberId,
          lotNumberText: targetLine.lotNumberText,
          inventoryBalance
        });

        fulfilment.setSublistValue({
          sublistId: 'item',
          fieldId: 'itemreceive',
          line: i,
          value: false
        });

        continue;
      }

      setStandardInventoryDetail({
        fulfilment,
        fulfilmentLine: i,
        lotNumberId: inventoryBalance.inventoryNumberId,
        lotNumberText: inventoryBalance.inventoryNumberText || targetLine.lotNumberText,
        binNumberId: inventoryBalance.binNumberId,
        inventoryStatusId: inventoryBalance.inventoryStatusId,
        quantity: targetLine.quantity
      });

      fulfilledLineCount++;
    }

    logFulfilmentInventoryDetailSummary(fulfilment);

    if (!fulfilledLineCount) {
      log.audit('Skipped', 'No fulfilment lines completed');
      return;
    }

    fulfilment.setValue({
      fieldId: 'shipstatus',
      value: 'C'
    });

    const fulfilmentId = fulfilment.save({
      enableSourcing: true,
      ignoreMandatoryFields: false
    });

    log.audit('Item Fulfilment Created', {
      salesOrderId,
      fulfilmentId,
      fulfilledLineCount
    });
  }

  function setStandardInventoryDetail(options) {
    const fulfilment = options.fulfilment;
    const fulfilmentLine = options.fulfilmentLine;
    const lotNumberId = options.lotNumberId;
    const lotNumberText = options.lotNumberText;
    const binNumberId = options.binNumberId;
    const inventoryStatusId = options.inventoryStatusId;
    const quantity = Number(options.quantity) || 0;

    const inventoryDetail = fulfilment.getSublistSubrecord({
      sublistId: 'item',
      fieldId: 'inventorydetail',
      line: fulfilmentLine
    });

    const assignmentCount = inventoryDetail.getLineCount({
      sublistId: 'inventoryassignment'
    });

    log.audit('Inventory Assignment Initial Count', {
      fulfilmentLine,
      assignmentCount
    });

    for (let line = assignmentCount - 1; line >= 0; line--) {
      inventoryDetail.removeLine({
        sublistId: 'inventoryassignment',
        line
      });
    }

    inventoryDetail.insertLine({
      sublistId: 'inventoryassignment',
      line: 0
    });

    inventoryDetail.setSublistValue({
      sublistId: 'inventoryassignment',
      fieldId: 'binnumber',
      line: 0,
      value: Number(binNumberId)
    });

    if (inventoryStatusId) {
      inventoryDetail.setSublistValue({
        sublistId: 'inventoryassignment',
        fieldId: 'inventorystatus',
        line: 0,
        value: Number(inventoryStatusId)
      });
    }

    setIssueInventoryNumber({
      inventoryDetail,
      line: 0,
      lotNumberId
    });

    inventoryDetail.setSublistValue({
      sublistId: 'inventoryassignment',
      fieldId: 'quantity',
      line: 0,
      value: quantity
    });

    log.audit('Inventory Assignment Before Commit', {
      fulfilmentLine,
      assignmentCount,
      binnumber: getAssignmentValueSafe(inventoryDetail, 0, 'binnumber'),
      issueinventorynumber: getAssignmentValueSafe(inventoryDetail, 0, 'issueinventorynumber'),
      issueinventorynumberText: getAssignmentTextSafe(inventoryDetail, 0, 'issueinventorynumber'),
      receiptinventorynumber: getAssignmentValueSafe(inventoryDetail, 0, 'receiptinventorynumber'),
      inventorystatus: getAssignmentValueSafe(inventoryDetail, 0, 'inventorystatus'),
      quantity: getAssignmentValueSafe(inventoryDetail, 0, 'quantity')
    });

    log.audit('Standard Fulfilment Inventory Detail Set', {
      fulfilmentLine,
      binnumber: binNumberId,
      issueinventorynumber: lotNumberId,
      issueinventorynumberText: lotNumberText,
      inventorystatus: inventoryStatusId,
      quantity
    });
  }

  function setIssueInventoryNumber(options) {
    const inventoryDetail = options.inventoryDetail;
    const line = options.line;
    const lotNumberId = options.lotNumberId;

    inventoryDetail.setSublistValue({
      sublistId: 'inventoryassignment',
      fieldId: 'issueinventorynumber',
      line,
      value: lotNumberId
    });

    const resolvedValue = getAssignmentValueSafe(inventoryDetail, line, 'issueinventorynumber');
    const resolvedText = getAssignmentTextSafe(inventoryDetail, line, 'issueinventorynumber');

    log.audit('Issue Inventory Number Set By Value', {
      line,
      lotNumberId,
      resolvedValue,
      resolvedText
    });

    if (!resolvedValue) {
      throw new Error(`Issue inventory number did not resolve for lot internal id ${lotNumberId}`);
    }
  }

  function resolveLotNumberId(options) {
    const lotNumberValue = options.lotNumberValue;
    const lotNumberText = options.lotNumberText;
    const itemId = options.itemId;

    if (lotNumberValue && !isNaN(Number(lotNumberValue))) {
      return lotNumberValue;
    }

    const searchValue = lotNumberText || lotNumberValue;
    if (!searchValue) return '';

    let lotId = '';

    search.create({
      type: 'inventorynumber',
      filters: [
        ['inventorynumber', 'is', searchValue],
        'AND',
        ['item', 'anyof', itemId]
      ],
      columns: ['internalid']
    }).run().each(result => {
      lotId = result.getValue({
        name: 'internalid'
      });
      return false;
    });

    return lotId;
  }

  function resolveInventoryBalance(options) {
    const itemId = options.itemId;
    const locationId = options.locationId;
    const initialLotNumberId = options.initialLotNumberId;
    const lotNumberText = options.lotNumberText;
    const requiredQuantity = Number(options.requiredQuantity) || 0;

    const resultData = {
      inventoryNumberId: '',
      inventoryNumberText: '',
      binNumberId: '',
      inventoryStatusId: ''
    };

    const filters = [
      ['item', 'anyof', itemId],
      'AND',
      ['location', 'anyof', locationId],
      'AND',
      ['available', 'greaterthan', '0']
    ];

    if (initialLotNumberId) {
      filters.push('AND');
      filters.push(['inventorynumber', 'anyof', initialLotNumberId]);
    } else if (lotNumberText) {
      filters.push('AND');
      filters.push(['inventorynumber.inventorynumber', 'is', lotNumberText]);
    }

    search.create({
      type: 'inventorybalance',
      filters,
      columns: [
        search.createColumn({
          name: 'available',
          sort: search.Sort.DESC
        }),
        'inventorynumber',
        'binnumber',
        'status'
      ]
    }).run().each(result => {
      const available = Number(result.getValue({
        name: 'available'
      })) || 0;

      const inventoryNumberId = result.getValue({
        name: 'inventorynumber'
      });

      const inventoryNumberText = result.getText({
        name: 'inventorynumber'
      });

      const binNumberId = result.getValue({
        name: 'binnumber'
      });

      const inventoryStatusId = result.getValue({
        name: 'status'
      });

      log.audit('Inventory Balance Check', {
        itemId,
        locationId,
        initialLotNumberId,
        lotNumberText,
        inventoryNumberId,
        inventoryNumberText,
        binNumberId,
        inventoryStatusId,
        available,
        requiredQuantity
      });

      if (inventoryNumberId && binNumberId && available >= requiredQuantity) {
        resultData.inventoryNumberId = inventoryNumberId;
        resultData.inventoryNumberText = inventoryNumberText;
        resultData.binNumberId = binNumberId;
        resultData.inventoryStatusId = inventoryStatusId;
        return false;
      }

      if (!resultData.inventoryNumberId && inventoryNumberId && binNumberId) {
        resultData.inventoryNumberId = inventoryNumberId;
        resultData.inventoryNumberText = inventoryNumberText;
        resultData.binNumberId = binNumberId;
        resultData.inventoryStatusId = inventoryStatusId;
      }

      return true;
    });

    log.audit('Resolved Inventory Balance Assignment', resultData);

    return resultData;
  }

  function getAssignmentValueSafe(inventoryDetail, line, fieldId) {
    try {
      return inventoryDetail.getSublistValue({
        sublistId: 'inventoryassignment',
        fieldId,
        line
      });
    } catch (e) {
      return '';
    }
  }

  function getAssignmentTextSafe(inventoryDetail, line, fieldId) {
    try {
      return inventoryDetail.getSublistText({
        sublistId: 'inventoryassignment',
        fieldId,
        line
      });
    } catch (e) {
      return '';
    }
  }

  function getFulfilmentLineValueSafe(fulfilment, line, fieldId) {
    try {
      return fulfilment.getSublistValue({
        sublistId: 'item',
        fieldId,
        line
      });
    } catch (e) {
      return '';
    }
  }

  function logFulfilmentInventoryDetailSummary(fulfilment) {
    const lineCount = fulfilment.getLineCount({
      sublistId: 'item'
    });

    for (let i = 0; i < lineCount; i++) {
      const itemreceive = fulfilment.getSublistValue({
        sublistId: 'item',
        fieldId: 'itemreceive',
        line: i
      });

      const lineSummary = {
        line: i,
        orderline: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'orderline',
          line: i
        }),
        itemreceive,
        item: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'item',
          line: i
        }),
        location: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'location',
          line: i
        }),
        quantity: fulfilment.getSublistValue({
          sublistId: 'item',
          fieldId: 'quantity',
          line: i
        }),
        inventorydetailavail: getFulfilmentLineValueSafe(fulfilment, i, 'inventorydetailavail'),
        inventorydetailset: getFulfilmentLineValueSafe(fulfilment, i, 'inventorydetailset'),
        assignmentCount: 0,
        assignments: []
      };

      if (!(itemreceive === true || itemreceive === 'T')) {
        log.audit('Fulfilment Inventory Detail Summary', lineSummary);
        continue;
      }

      try {
        const inventoryDetail = fulfilment.getSublistSubrecord({
          sublistId: 'item',
          fieldId: 'inventorydetail',
          line: i
        });

        lineSummary.assignmentCount = inventoryDetail.getLineCount({
          sublistId: 'inventoryassignment'
        });

        for (let assignmentLine = 0; assignmentLine < lineSummary.assignmentCount; assignmentLine++) {
          lineSummary.assignments.push({
            binnumber: getAssignmentValueSafe(inventoryDetail, assignmentLine, 'binnumber'),
            issueinventorynumber: getAssignmentValueSafe(inventoryDetail, assignmentLine, 'issueinventorynumber'),
            issueinventorynumberText: getAssignmentTextSafe(inventoryDetail, assignmentLine, 'issueinventorynumber'),
            receiptinventorynumber: getAssignmentValueSafe(inventoryDetail, assignmentLine, 'receiptinventorynumber'),
            inventorystatus: getAssignmentValueSafe(inventoryDetail, assignmentLine, 'inventorystatus'),
            quantity: getAssignmentValueSafe(inventoryDetail, assignmentLine, 'quantity')
          });
        }
      } catch (e) {
        lineSummary.inventoryDetailError = {
          name: e.name,
          message: e.message
        };
      }

      log.audit('Fulfilment Inventory Detail Summary', lineSummary);
    }
  }

  function getSubsidiaryFulfilmentLocation(subsidiaryId) {
    if (!subsidiaryId) return '';

    const subsidiaryData = search.lookupFields({
      type: search.Type.SUBSIDIARY,
      id: subsidiaryId,
      columns: [FIELD_SUBSIDIARY_DC_LOCATION]
    });

    const locationValue = subsidiaryData[FIELD_SUBSIDIARY_DC_LOCATION];

    if (Array.isArray(locationValue) && locationValue.length) {
      return locationValue[0].value;
    }

    if (locationValue && locationValue.value) {
      return locationValue.value;
    }

    return locationValue || '';
  }

  return {
    afterSubmit
  };

});
