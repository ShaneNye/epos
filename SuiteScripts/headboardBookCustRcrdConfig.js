/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/https', 'N/record', 'N/log'], (https, record, log) => {

  const ENDPOINT_URL = 'https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4398&deploy=54&compid=7972741&ns-at=AAEJ7tMQcJCkuhjEYHIADmZ3NMFk6m-SRAOELSQ2nCcRqby7KBE';
  const EXCLUDE_SUITELET_URL = 'https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4545&deploy=1&compid=7972741&ns-at=AAEJ7tMQ3NvvCPmzN15QUR6DidgDmWtkkyogOv8lpk7MqZAtgac';
  const NETSUITE_BASE_URL = 'https://7972741.app.netsuite.com';

  const RECORD_TYPE = 'customrecord_sb_headboard_books';

  const FIELD_SUB_CLASS = 'custrecord_sb_hbb_sub_class';
  const FIELD_PRODUCT_RANGE = 'custrecord_sb_hbb_prod_range';
  const FIELD_EXCLUDE = 'custrecord_sb_hbb_exclude';

  function beforeLoad(context) {
    if (context.type === context.UserEventType.CREATE) return;

    try {
      const rec = context.newRecord;
      const subClassId = rec.getValue({ fieldId: FIELD_SUB_CLASS });
      const excludedIds = getMultiSelectValues(rec, FIELD_EXCLUDE);

      if (!subClassId) return;

      const filteredRows = getFilteredProducts(subClassId, excludedIds);

      context.form.addSubtab({
        id: 'custpage_hbb_products_tab',
        label: 'Filtered Products'
      });

      const htmlField = context.form.addField({
        id: 'custpage_hbb_filtered_products',
        type: 'inlinehtml',
        label: 'Filtered Products',
        container: 'custpage_hbb_products_tab'
      });

      htmlField.defaultValue = buildProductTable(filteredRows, rec.id);

    } catch (e) {
      log.error('beforeLoad error', e);
    }
  }

  function afterSubmit(context) {
    if (
      context.type === context.UserEventType.DELETE ||
      context.type === context.UserEventType.XEDIT
    ) return;

    try {
      const rec = record.load({
        type: RECORD_TYPE,
        id: context.newRecord.id,
        isDynamic: false
      });

      const subClassId = rec.getValue({ fieldId: FIELD_SUB_CLASS });
      const excludedIds = getMultiSelectValues(rec, FIELD_EXCLUDE);

      if (!subClassId) return;

      const filteredRows = getFilteredProducts(subClassId, excludedIds);

      const itemIds = filteredRows
        .map(row => row['Internal ID'])
        .filter(id => !!id);

      record.submitFields({
        type: RECORD_TYPE,
        id: context.newRecord.id,
        values: {
          [FIELD_PRODUCT_RANGE]: itemIds
        },
        options: {
          enableSourcing: false,
          ignoreMandatoryFields: true
        }
      });

    } catch (e) {
      log.error('afterSubmit error', e);
    }
  }

  function getFilteredProducts(subClassId, excludedIds) {
    const response = https.get({ url: ENDPOINT_URL });

    if (response.code !== 200) {
      throw new Error(`Endpoint failed. Code: ${response.code}`);
    }

    const payload = JSON.parse(response.body);

    if (!payload.ok || !Array.isArray(payload.results)) {
      return [];
    }

    return payload.results.filter(row => {
      const itemId = normalise(row['Internal ID']);
      const rowSubClassId = normalise(row['Sub Class']);

      return rowSubClassId === normalise(subClassId) &&
             excludedIds.indexOf(itemId) === -1;
    });
  }

  function buildProductTable(rows, recordId) {
    if (!rows || rows.length === 0) {
      return `
        <div style="margin:15px 0;">
          <strong>No matching products found.</strong>
        </div>
      `;
    }

    const parentRows = rows.filter(row => !row['Parent ID']);
    const childRows = rows.filter(row => row['Parent ID']);

    const childrenByParent = {};

    childRows.forEach(child => {
      const parentId = normalise(child['Parent ID']);

      if (!childrenByParent[parentId]) {
        childrenByParent[parentId] = [];
      }

      childrenByParent[parentId].push(child);
    });

    const columns = Object.keys(rows[0]).filter(
      col => col !== 'Item Image' && col !== 'Height'
    );

    // Height is returned by the endpoint and should always have its own column,
    // even when the first result does not contain the property.
    columns.push('Height');

    let html = `
      <style>
        .hbb-wrapper { margin-top:15px; width:100%; overflow-x:auto; }
        .hbb-title { font-size:16px; font-weight:bold; margin-bottom:10px; }
        .hbb-table { border-collapse:collapse; width:100%; min-width:1100px; font-size:12px; background:white; }
        .hbb-table th, .hbb-table td { border:1px solid #ddd; padding:6px 8px; text-align:left; vertical-align:middle; }
        .hbb-table th { background:#f3f3f3; font-weight:bold; position:sticky; top:0; z-index:1; }
        .hbb-parent-row { cursor:pointer; background:#fff; font-weight:bold; }
        .hbb-parent-row:hover { background:#eef5ff; }
        .hbb-child-row { display:none; background:#fafafa; }
        .hbb-child-row td { font-weight:normal; }
        .hbb-child-indent { padding-left:25px !important; }
        .hbb-toggle { display:inline-block; width:18px; font-weight:bold; font-size:14px; }
        .hbb-img { max-width:90px; max-height:70px; object-fit:contain; display:block; }
        .hbb-muted { color:#777; font-weight:normal; }

        .hbb-missing-image {
          background: #ffe0b2 !important;
        }

        .hbb-missing-image:hover {
          background: #ffd08a !important;
        }

        .hbb-missing-label {
          color: #b35c00;
          font-weight: bold;
          font-size: 11px;
        }

        .hbb-bin {
          border:0;
          background:transparent;
          cursor:pointer;
          font-size:16px;
          line-height:1;
        }

        .hbb-bin:hover { transform:scale(1.15); }
      </style>

      <script>
        function hbbToggleChildren(parentId) {
          var rows = document.querySelectorAll('[data-hbb-parent="' + parentId + '"]');
          var toggle = document.getElementById('hbb-toggle-' + parentId);
          var isOpening = false;

          for (var i = 0; i < rows.length; i++) {
            if (rows[i].style.display === 'none' || rows[i].style.display === '') {
              isOpening = true;
              break;
            }
          }

          for (var j = 0; j < rows.length; j++) {
            rows[j].style.display = isOpening ? 'table-row' : 'none';
          }

          if (toggle) {
            toggle.innerHTML = isOpening ? '−' : '+';
          }
        }

        function hbbExcludeItem(event, itemId) {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }

          if (!confirm('Exclude this item from the product range?')) {
            return false;
          }

          var url = '${EXCLUDE_SUITELET_URL}' +
            '&recordId=${recordId}' +
            '&itemId=' + encodeURIComponent(itemId);

          fetch(url, {
            method: 'GET',
            mode: 'no-cors'
          }).catch(function() {
            // Ignore response issues
          });

          setTimeout(function() {
            window.location.reload();
          }, 1000);

          return false;
        }
      </script>

      <div class="hbb-wrapper">
        <div class="hbb-title">
          Filtered Headboard Products (${parentRows.length} parents / ${childRows.length} children)
        </div>

        <table class="hbb-table">
          <thead>
            <tr>
              <th></th>
              <th>Exclude</th>
              <th>Image</th>
              ${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    parentRows.forEach(parent => {
      const parentId = normalise(parent['Internal ID']);
      const children = childrenByParent[parentId] || [];
      const hasChildren = children.length > 0;
      const imageUrl = buildImageUrl(parent['Item Image']);
      const parentMissingImageClass = imageUrl ? '' : ' hbb-missing-image';

      html += `
        <tr id="hbb-row-${escapeHtml(parentId)}" class="hbb-parent-row${parentMissingImageClass}" onclick="hbbToggleChildren('${escapeJs(parentId)}')">
          <td>
            ${
              hasChildren
                ? `<span id="hbb-toggle-${escapeHtml(parentId)}" class="hbb-toggle">+</span>`
                : `<span class="hbb-muted">—</span>`
            }
          </td>
          <td>
            <button type="button" class="hbb-bin" title="Exclude item" onclick="return hbbExcludeItem(event, '${escapeJs(parentId)}');">🗑️</button>
          </td>
          <td>
            ${
              imageUrl
                ? `<img src="${escapeHtml(imageUrl)}" class="hbb-img" alt="Product Image" />`
                : `<span class="hbb-missing-label">Missing image</span>`
            }
          </td>
          ${columns.map(col => `<td>${escapeHtml(parent[col] || '')}</td>`).join('')}
        </tr>
      `;

      children.forEach(child => {
        const childId = normalise(child['Internal ID']);
        const childImageUrl = buildImageUrl(child['Item Image']);
        const childMissingImageClass = childImageUrl ? '' : ' hbb-missing-image';

        html += `
          <tr id="hbb-row-${escapeHtml(childId)}" class="hbb-child-row${childMissingImageClass}" data-hbb-parent="${escapeHtml(parentId)}">
            <td></td>
            <td>
              <button type="button" class="hbb-bin" title="Exclude item" onclick="return hbbExcludeItem(event, '${escapeJs(childId)}');">🗑️</button>
            </td>
            <td>
              ${
                childImageUrl
                  ? `<img src="${escapeHtml(childImageUrl)}" class="hbb-img" alt="Product Image" />`
                  : `<span class="hbb-missing-label">Missing image</span>`
              }
            </td>
            ${columns.map(col => {
              const cellClass = col === 'Name' ? ' class="hbb-child-indent"' : '';
              return `<td${cellClass}>${escapeHtml(child[col] || '')}</td>`;
            }).join('')}
          </tr>
        `;
      });
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    return html;
  }

  function getMultiSelectValues(rec, fieldId) {
    const value = rec.getValue({ fieldId });

    if (!value) return [];

    if (Array.isArray(value)) {
      return value.map(v => normalise(v)).filter(v => !!v);
    }

    return [normalise(value)].filter(v => !!v);
  }

  function buildImageUrl(value) {
    const imagePath = String(value || '').trim();

    if (
      !imagePath ||
      imagePath.toLowerCase() === 'null' ||
      imagePath.toLowerCase() === 'undefined'
    ) {
      return '';
    }

    if (imagePath.indexOf('http://') === 0 || imagePath.indexOf('https://') === 0) {
      return imagePath;
    }

    if (imagePath.charAt(0) === '/') {
      return NETSUITE_BASE_URL + imagePath;
    }

    return NETSUITE_BASE_URL + '/' + imagePath;
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

  function escapeJs(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  return {
    beforeLoad,
    afterSubmit
  };
});
