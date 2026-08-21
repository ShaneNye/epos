/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/record', 'N/https', 'N/file', 'N/log'], (record, https, file, log) => {

  const ENDPOINT_URL = 'https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4398&deploy=54&compid=7972741&ns-at=AAEJ7tMQcJCkuhjEYHIADmZ3NMFk6m-SRAOELSQ2nCcRqby7KBE';
  const NETSUITE_BASE_URL = 'https://7972741.app.netsuite.com';

  const RECORD_TYPE = 'customrecord_sb_headboard_books';

  const FIELD_ICON = 'custrecord_sb_hbb_icon';
  const FIELD_SUB_CLASS = 'custrecord_sb_hbb_sub_class';
  const FIELD_EXCLUDE = 'custrecord_sb_hbb_exclude';
  const FIELD_PRODUCT_RANGE = 'custrecord_sb_hbb_prod_range';

  const BASE_CLASS_IDS = ['1'];

  function onRequest(context) {
    try {
      const recordId = context.request.parameters.recordId;

      if (!recordId) {
        context.response.write('Missing recordId');
        return;
      }

      const rec = record.load({
        type: RECORD_TYPE,
        id: recordId,
        isDynamic: false
      });

      const recordName = rec.getValue({ fieldId: 'name' }) || '';
      const subClassId = rec.getValue({ fieldId: FIELD_SUB_CLASS });
      const excludedIds = getMultiSelectValues(rec, FIELD_EXCLUDE);
      const productRangeIds = getMultiSelectValues(rec, FIELD_PRODUCT_RANGE);
      const iconUrl = getFileUrl(rec.getValue({ fieldId: FIELD_ICON }));

      const rows = getFilteredProducts(subClassId, excludedIds, productRangeIds);

      const headboardRows = rows.filter(row => !isBaseRow(row));
      const baseRows = rows.filter(row => isBaseRow(row));

      const printBlocks = groupHeadboardProducts(headboardRows);
      const baseBlocks = groupBaseProducts(baseRows);

      const html = buildHtml(recordName, iconUrl, printBlocks, baseBlocks);

      context.response.setHeader({
        name: 'Content-Type',
        value: 'text/html'
      });

      context.response.write(html);

    } catch (e) {
      log.error('Print Suitelet Error', e);
      context.response.write('Error: ' + e.name + ' - ' + e.message);
    }
  }

  function getFilteredProducts(subClassId, excludedIds, productRangeIds) {
    const response = https.get({ url: ENDPOINT_URL });

    if (response.code !== 200) {
      throw new Error('Endpoint failed: ' + response.code);
    }

    const payload = JSON.parse(response.body);

    if (!payload.ok || !Array.isArray(payload.results)) {
      return [];
    }

    const results = payload.results;
    const includedBaseParentIds = [];

    // Include every base parent belonging to this headboard book's subclass.
    // The live custom-record table uses the subclass filter, whereas the saved
    // Product Range multiselect can omit a parent even though its rows are shown.
    results.forEach(row => {
      const itemId = normalise(row['Internal ID']);

      if (
        isBaseRow(row) &&
        !normalise(row['Parent ID']) &&
        normalise(row['Sub Class']) === normalise(subClassId) &&
        excludedIds.indexOf(itemId) === -1 &&
        includedBaseParentIds.indexOf(itemId) === -1
      ) {
        includedBaseParentIds.push(itemId);
      }
    });

    results.forEach(row => {
      if (!isBaseRow(row)) return;

      const itemId = normalise(row['Internal ID']);
      const parentId = normalise(row['Parent ID']);

      if (!parentId || excludedIds.indexOf(itemId) !== -1) return;

      if (
        productRangeIds.indexOf(itemId) !== -1 ||
        productRangeIds.indexOf(parentId) !== -1
      ) {
        if (includedBaseParentIds.indexOf(parentId) === -1) {
          includedBaseParentIds.push(parentId);
        }
      }
    });

    return results.filter(row => {
      const itemId = normalise(row['Internal ID']);
      const parentId = normalise(row['Parent ID']);

      if (excludedIds.indexOf(itemId) !== -1) return false;

      if (isBaseRow(row)) {
        if (parentId) {
          return includedBaseParentIds.indexOf(parentId) !== -1;
        }

        return includedBaseParentIds.indexOf(itemId) !== -1;
      }

      return normalise(row['Sub Class']) === normalise(subClassId);
    });
  }

  function isBaseRow(row) {
    const classId = normalise(row['Class']);
    return BASE_CLASS_IDS.indexOf(classId) !== -1 || !!normalise(row['Base Options']);
  }

  function groupHeadboardProducts(rows) {
  const parents = rows.filter(row => !row['Parent ID']);
  const children = rows.filter(row => row['Parent ID']);
  const childrenByParent = {};

  children.forEach(child => {
    const parentId = normalise(child['Parent ID']);
    if (!childrenByParent[parentId]) childrenByParent[parentId] = [];
    childrenByParent[parentId].push(child);
  });

  const floorstandingBlocks = [];
  const struttedBlocks = [];

  parents.forEach(parent => {
    const parentId = normalise(parent['Internal ID']);
    const parentChildren = childrenByParent[parentId] || [];
    const parentImage = buildImageUrl(parent['Item Image']);

    const floorTallChildren = parentChildren.filter(child => {
      const name = String(child['Name'] || '').toLowerCase();
      return name.indexOf('floorstanding') !== -1;
    });

    const struttedChildren = parentChildren.filter(child => {
      const name = String(child['Name'] || '').toLowerCase();
      return name.indexOf('strutted') !== -1;
    });

    if (floorTallChildren.length && parentImage) {
      floorstandingBlocks.push({
        type: 'floorstanding',
        pageTitle: 'Floorstanding Headboards',
        titleSuffix: 'Floorstanding',
        parent,
        children: floorTallChildren
      });
    }

    const struttedImageExists =
      parentImage ||
      struttedChildren.some(child => buildImageUrl(child['Item Image']));

    if (struttedChildren.length && struttedImageExists) {
      struttedBlocks.push({
        type: 'strutted',
        pageTitle: 'Strutted Headboards',
        titleSuffix: 'Strutted',
        parent,
        children: struttedChildren
      });
    }
  });

  return floorstandingBlocks.concat(struttedBlocks);
}

  function groupBaseProducts(rows) {
  const parents = rows.filter(row => !normalise(row['Parent ID']));
  const childrenByParent = {};

  rows.filter(row => normalise(row['Parent ID'])).forEach(child => {
    const parentId = normalise(child['Parent ID']);
    if (!childrenByParent[parentId]) childrenByParent[parentId] = [];
    childrenByParent[parentId].push(child);
  });

  return parents.map(parent => {
    const parentId = normalise(parent['Internal ID']);
    const children = childrenByParent[parentId] || [];
    const parentName = cleanBaseParentName(parent['Name']) ||
      normalise(parent['Base Options']) ||
      'Base';
    const storageOptions = {};

    children.forEach(child => {
      const baseOption = normalise(child['Base Options']) || 'Base';
      const imageUrl = buildImageUrl(child['Item Image']);

      // A missing image excludes only this variation, not its parent or siblings.
      if (!imageUrl) return;

      if (!storageOptions[baseOption]) {
        storageOptions[baseOption] = {
          baseOption,
          baseClass: normalise(child['Class']),
          imageUrl,
          rows: []
        };
      }

      if (!storageOptions[baseOption].imageUrl && imageUrl) {
        storageOptions[baseOption].imageUrl = imageUrl;
      }

      storageOptions[baseOption].rows.push({
        size: normalise(child['Size']),
        option: normalise(child['Headboard Option']) || getBaseColumnOption(child['Name']),
        retail: formatPrice(child['Retail'])
      });
    });

    return {
      parentName,
      groups: Object.keys(storageOptions)
        .sort((a, b) => sortBaseOptions(a, b))
        .map(key => storageOptions[key])
        .filter(group => !!group.imageUrl)
    };
  }).filter(parentGroup => parentGroup.groups.length > 0)
    .sort((a, b) => a.parentName.localeCompare(b.parentName));
}

  function buildHtml(recordName, iconUrl, printBlocks, baseBlocks) {
    let pages = `
      <section class="a4-page cover-page">
        <div class="cover-inner">
          ${iconUrl ? `<img class="cover-logo" src="${escapeHtml(iconUrl)}">` : ''}
          <h1>${escapeHtml(recordName)}</h1>
        </div>
        <div class="page-number">Page 1</div>
      </section>
    `;

    const floorstandingBlocks = printBlocks.filter(block => block.type === 'floorstanding');
    const struttedBlocks = printBlocks.filter(block => block.type === 'strutted');

    const floorstandingPages = chunkArray(floorstandingBlocks, 4);
    const struttedPages = chunkArray(struttedBlocks, 4);
    const basePages = [];

    baseBlocks.forEach(parentGroup => {
      chunkArray(parentGroup.groups, 4).forEach(groups => {
        basePages.push({
          basePage: true,
          parentName: parentGroup.parentName,
          groups
        });
      });
    });

    const allPages = []
      .concat(floorstandingPages)
      .concat(struttedPages)
      .concat(basePages);

    const totalPages = allPages.length + 1;

    allPages.forEach((page, index) => {
      const pageNumber = index + 2;

      if (page.basePage) {
        pages += buildBasePage(page.parentName, page.groups, pageNumber, totalPages);
      } else {
        pages += buildHeadboardPage(page, pageNumber, totalPages);
      }
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(recordName)}</title>

        <style>
          @page {
            size: A4 portrait;
            margin: 0;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            color: #222;
            background: #444;
          }

          .a4-page {
            width: 210mm;
            height: 297mm;
            box-sizing: border-box;
            background: #fff;
            margin: 10mm auto;
            padding: 14mm;
            position: relative;
            page-break-after: always;
            overflow: hidden;
            border: 1px solid #222;
          }

          .cover-page {
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
          }

          .cover-inner {
            width: 100%;
          }

          .cover-logo {
            max-height: 250px;
            object-fit: contain;
            margin-bottom: 140px;
          }

          .cover-page h1 {
            font-size: 34px;
            font-weight: 400;
            line-height: 1.3;
            white-space: pre-line;
            margin: 0;
          }

          .page-heading {
            text-align: center;
            font-size: 22px;
            font-weight: 400;
            margin: 0 0 10mm 0;
          }

          .product-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10mm 12mm;
          }

          .product-block,
          .base-row-block {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .product-image {
            width: 100%;
            height: 52mm;
            object-fit: contain;
            display: block;
            margin-bottom: 4mm;
          }

          .product-name,
          .base-name {
            font-size: 15px;
            margin-bottom: 3mm;
            border-bottom: 1px solid #222;
            padding-bottom: 2mm;
          }

          .product-type {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 2mm;
            color: #555;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
          }

          th {
            text-align: right;
            font-weight: 400;
            border-bottom: 1px solid #222;
            padding: 2px 3px;
          }

          th:first-child {
            text-align: left;
          }

          td {
            padding: 2px 3px;
            text-align: right;
          }

          td:first-child {
            text-align: left;
            font-style: italic;
          }

          .notes {
            margin-top: 3mm;
            border-top: 1px solid #222;
            padding-top: 2mm;
            font-size: 9px;
          }

          .base-row-layout {
            display: flex;
            flex-direction: column;
            gap: 9mm;
          }

          .base-parent-name {
            font-size: 17px;
            font-weight: 400;
            margin: -5mm 0 7mm 0;
            padding-bottom: 2mm;
            border-bottom: 1px solid #222;
          }

          .base-row-block {
            display: grid;
            grid-template-columns: 62% 32%;
            gap: 6%;
            align-items: center;
          }

          .base-row-image {
            width: 100%;
            height: 48mm;
            object-fit: contain;
            display: block;
          }

          .base-row-table-wrap table {
            font-size: 10px;
          }

          .page-number {
            position: absolute;
            bottom: 8mm;
            right: 12mm;
            font-size: 10px;
            color: #555;
          }

          .print-button {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 9999;
            padding: 8px 14px;
            border: 1px solid #333;
            background: #fff;
            cursor: pointer;
            font-size: 13px;
          }

          @media print {
            html,
            body {
              background: #fff;
            }

            .a4-page {
              margin: 0;
              border: none;
              page-break-after: always;
            }

            .print-button {
              display: none;
            }
          }
        </style>
      </head>

      <body>
        <button class="print-button" onclick="window.print()">Print</button>
        ${pages}
      </body>
      </html>
    `;
  }

  function buildHeadboardPage(pageGroups, pageNumber, totalPages) {
    let blocks = '';

    pageGroups.forEach(group => {
      blocks += buildHeadboardBlock(group);
    });

    const pageTitle = pageGroups[0] && pageGroups[0].pageTitle
      ? pageGroups[0].pageTitle
      : 'Headboards';

    return `
      <section class="a4-page">
        <h2 class="page-heading">${escapeHtml(pageTitle)}</h2>

        <div class="product-grid">
          ${blocks}
        </div>

        <div class="page-number">Page ${pageNumber} / ${totalPages}</div>
      </section>
    `;
  }

  function buildHeadboardBlock(group) {
    const parent = group.parent;
    const children = group.children || [];
    const parentName = cleanParentName(parent['Name']);
    const imageUrl = getHeadboardBlockImageUrl(group);

    const sizeOrder = [
      'Small Single',
      'Single',
      'Small Double',
      'Double',
      'King',
      'Super King'
    ];

    const optionMap = {};

    children.forEach(child => {
      const size = normalise(child['Size']);
      const option = getHeadboardOption(child['Name']);
      const retail = formatPrice(child['Retail']);

      if (!optionMap[size]) optionMap[size] = {};
      optionMap[size][option] = retail;
    });

    const options = getUniqueOptions(children);
    const heightNotes = buildHeadboardHeightNotes(group);

    let tableRows = '';

    sizeOrder.forEach(size => {
      if (!optionMap[size]) return;

      tableRows += `
        <tr>
          <td>${escapeHtml(size)}</td>
          ${options.map(option => `<td>${escapeHtml(optionMap[size][option] || '')}</td>`).join('')}
        </tr>
      `;
    });

    return `
      <div class="product-block">
        ${imageUrl ? `<img class="product-image" src="${escapeHtml(imageUrl)}">` : ''}
        <div class="product-name">${escapeHtml(parentName)}</div>
        <div class="product-type">${escapeHtml(group.titleSuffix)}</div>

        <table>
          <thead>
            <tr>
              <th></th>
              ${options.map(option => `<th>${escapeHtml(option)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>

        ${heightNotes ? `<div class="notes">${heightNotes}</div>` : ''}
      </div>
    `;
  }

  function buildHeadboardHeightNotes(group) {
    const children = group.children || [];
    const optionLabels = group.type === 'floorstanding'
      ? ['Standard', 'Tall']
      : ['Strutted'];

    return optionLabels.map(option => {
      const heights = [];

      children.forEach(child => {
        if (getHeadboardOption(child['Name']) !== option) return;

        const height = formatHeight(child['Height']);
        if (height && heights.indexOf(height) === -1) heights.push(height);
      });

      if (!heights.length) return '';

      const label = option === 'Strutted' ? 'Standard' : option;
      return `${escapeHtml(label)} Headboard Height: ${heights.map(escapeHtml).join(' / ')}`;
    }).filter(line => !!line).join('<br>');
  }

  function formatHeight(value) {
    const height = normalise(value);

    if (!height) return '';

    // The endpoint commonly returns the measurement as a number in centimetres.
    return /^\d+(?:\.\d+)?$/.test(height) ? height + 'cm' : height;
  }

  function buildBasePage(parentName, pageGroups, pageNumber, totalPages) {
    let blocks = '';

    pageGroups.forEach(group => {
      blocks += buildBaseRowBlock(group);
    });

    return `
      <section class="a4-page">
        <h2 class="page-heading">Bases</h2>
        <h3 class="base-parent-name">${escapeHtml(parentName)}</h3>

        <div class="base-row-layout">
          ${blocks}
        </div>

        <div class="page-number">Page ${pageNumber} / ${totalPages}</div>
      </section>
    `;
  }

  function buildBaseRowBlock(group) {
    const sizeOrder = [
      'Small Single',
      'Single',
      'Small Double',
      'Double',
      'King',
      'Super King'
    ];

    const optionMap = {};

    group.rows.forEach(row => {
      if (!optionMap[row.size]) optionMap[row.size] = {};
      optionMap[row.size][row.option] = row.retail;
    });

    const options = getBaseOptions(group.rows);

    let tableRows = '';

    sizeOrder.forEach(size => {
      tableRows += `
        <tr>
          <td>${escapeHtml(size)}</td>
          ${options.map(option => `<td>${escapeHtml(optionMap[size] && optionMap[size][option] ? optionMap[size][option] : '-')}</td>`).join('')}
        </tr>
      `;
    });

    return `
      <div class="base-row-block">
        <div class="base-row-image-wrap">
          ${group.imageUrl ? `<img class="base-row-image" src="${escapeHtml(group.imageUrl)}">` : ''}
        </div>

        <div class="base-row-table-wrap">
          <div class="base-name">${escapeHtml(group.baseOption)}</div>

          <table>
            <thead>
              <tr>
                <th></th>
                ${options.map(option => `<th>${escapeHtml(option)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function sortBaseOptions(a, b) {
    const aText = normalise(a);
    const bText = normalise(b);

    const aNum = getStartingNumber(aText);
    const bNum = getStartingNumber(bText);

    const aIsNumbered = aNum !== null;
    const bIsNumbered = bNum !== null;

    if (!aIsNumbered && bIsNumbered) return -1;
    if (aIsNumbered && !bIsNumbered) return 1;

    if (aIsNumbered && bIsNumbered) {
      if (aNum !== bNum) return aNum - bNum;
      return aText.localeCompare(bText);
    }

    const preferredNonNumbered = [
      'Non Storage',
      'End Lift Ottoman',
      'Side Lift Ottoman',
      'Shallow Base On Legs'
    ];

    const ai = preferredNonNumbered.indexOf(aText);
    const bi = preferredNonNumbered.indexOf(bText);

    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;

    return aText.localeCompare(bText);
  }

  function getStartingNumber(value) {
    const match = String(value || '').trim().match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  function getHeadboardBlockImageUrl(group) {
    if (group.type === 'strutted') {
      const doubleChild = (group.children || []).find(child => {
        return normalise(child['Size']).toLowerCase() === 'double' &&
               String(child['Name'] || '').toLowerCase().indexOf('strutted') !== -1 &&
               child['Item Image'];
      });

      if (doubleChild && doubleChild['Item Image']) {
        return buildImageUrl(doubleChild['Item Image']);
      }

      const firstChildWithImage = (group.children || []).find(child => child['Item Image']);
      if (firstChildWithImage) {
        return buildImageUrl(firstChildWithImage['Item Image']);
      }
    }

    return buildImageUrl(group.parent['Item Image']);
  }

  function getUniqueOptions(children) {
    const preferredOrder = ['Standard', 'Tall', 'Strutted'];
    const found = [];

    children.forEach(child => {
      const option = getHeadboardOption(child['Name']);
      if (option && found.indexOf(option) === -1) found.push(option);
    });

    return preferredOrder.filter(option => found.indexOf(option) !== -1);
  }

  function getBaseOptions(rows) {
    const preferredOrder = ['Standard drawer', 'Deluxe drawer', 'Standard', 'Deluxe', 'Base'];
    const found = [];

    rows.forEach(row => {
      if (row.option && found.indexOf(row.option) === -1) found.push(row.option);
    });

    const ordered = preferredOrder.filter(option => found.indexOf(option) !== -1);
    const remaining = found.filter(option => ordered.indexOf(option) === -1);

    return ordered.concat(remaining);
  }

  function getHeadboardOption(name) {
    const text = String(name || '').toLowerCase();

    if (text.indexOf('tall floorstanding') !== -1) return 'Tall';
    if (text.indexOf('floorstanding') !== -1) return 'Standard';
    if (text.indexOf('strutted') !== -1) return 'Strutted';

    return 'Option';
  }

  function getBaseColumnOption(name) {
    const text = String(name || '').toLowerCase();

    if (text.indexOf('deluxe') !== -1) return 'Deluxe drawer';
    if (text.indexOf('standard') !== -1) return 'Standard drawer';

    return 'Base';
  }

  function cleanParentName(name) {
    return String(name || '')
      .replace(/ Headboard$/i, '')
      .trim();
  }

  function cleanBaseParentName(name) {
    return String(name || '').trim();
  }

  function formatPrice(value) {
    const num = parseFloat(value);

    if (isNaN(num)) return '';

    return '£' + Math.round(num).toString();
  }

  function getFileUrl(fileId) {
    if (!fileId) return '';

    try {
      const f = file.load({ id: fileId });
      return buildImageUrl(f.url);
    } catch (e) {
      log.error('Icon Load Error', e);
      return '';
    }
  }

  function buildImageUrl(value) {
    const imagePath = String(value || '').trim();

    if (!imagePath) return '';

    if (imagePath.indexOf('http://') === 0 || imagePath.indexOf('https://') === 0) {
      return imagePath;
    }

    if (imagePath.charAt(0) === '/') {
      return NETSUITE_BASE_URL + imagePath;
    }

    return NETSUITE_BASE_URL + '/' + imagePath;
  }

  function getMultiSelectValues(rec, fieldId) {
    const value = rec.getValue({ fieldId });

    if (!value) return [];

    if (Array.isArray(value)) {
      return value.map(v => normalise(v)).filter(v => !!v);
    }

    return [normalise(value)].filter(v => !!v);
  }

  function chunkArray(arr, size) {
    const chunks = [];

    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }

    return chunks;
  }

  function normalise(value) {
    return String(value || '').trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  return {
    onRequest
  };
});
