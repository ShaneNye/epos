/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(["N/record", "N/search", "N/log"], (record, search, log) => {
  const ITEM_OPTION_IDS = [
    
    "17153","13975","10929","11030","10923","10483","15415","13076","13074","16719","16455","11028","10499","13972","13971","13970","10498","10808","14956","14952","10691","14978","13693","10969","10968","10965","10964","10563","10967","10966","10886","10853","10715","10601","10887","11040","11039","10882","16443","16335","14020","11042","11041","10921","10954","10953","10971","10970","14026","13976","10930","12980","10919","10794","10854","10771","10722","10973","10972","10731","10497","14029","11282","16060","10493","10227","10228","10477","13958","10773","10855","10511","10645","14962","13854","10521","10795","11277","14966","16603","13856","11062","10956","10955","10787","10856","10857","16353","10495","11484","13733","10689","10937","12881","12880","10975","10974","10585","10977","10976","10717","10506","10565","13735","10796","10775","16337","10883","10703","10903","10669","10539","10797","10753","15383","11044","11043","10605","10760","10512","16347","11586","10958","10957","10540","10752","10781","10631","16345","10575","10979","10978","10661","10981","10980","10983","10982","10649","10736","15763","11278","16355","10985","10984","10751","10947","10681","13674","10734","10623","10673","12311","16068","10798","10619","10884","10564","10541","11950","10643","10542","15397","14206","10858","16605","10859","10885","16201","16199","10987","10986","10960","10959","10200","10526","10543","16718","10739","10743","10571","11045","15408","10765","10888","10767","10938","10675","16058","15411","10544","10770","10769","13898","14982","14980","10545","10860","10799","11587","10920","10749","10747","16601","15417","13929","12961","10889","10905","15225","10925","10225","10224","13931","13923","10861","14974","16203","15381","10695","10219","10221","10240","17040","10922","12887","10557","10862","14958","14960","10918","14976","13680","10576","16579","10599","10633","10513","10801","10863","10864","10865","10866","10492","10800","13927","10697","10194","11047","11046","10759","15413","14964","10782","16599","10566","16205","10758","10579","11049","11048","16357","10723","10570","10517","16052","14018","16452","16575","16359","10667","10867","12885","11058","11923","10528","14986","10988","10788","16597","10494","13688","10609","10212","10737","16467","10724","10589","10868","13369","10546","13913","16450","16448","10869","10641","10906","10754","10766","16339","16341","10699","10655","10907","10741","10783","10941","10223","10222","10239","13717","11921","11925","10220","10218","10216","10241","10237","10201","15389","14021","10496","16463","16465","10733","15639","16958","10651","10569","11279","16715","10487","10527","10500","15637","11937","16207","10870","10198","10197","10949","10665","10572","13753","10607","10871","10491","10784","10677","10755","13905","10768","16950","16063","10514","10932","10939","11922","10872","10507","14023","10659","10234","12934","16333","10647","10962","10961","16577","10547","10763","13725","10912","10873","10657","14024","16371","10874","10558","13861","16369","16607","13755","13684","10875","10876","13731","11280","12967","13911","16373","10902","10721","13907","16365","16367","13939","12981","12986","10908","10909","10785","13678","10611","10790","10587","10890","10910","10635","16351","15387","15395","10548","10233","12327","10214","10213","12892","10877","10538","10534","14972","10990","10989","14970","10705","11056","11055","11063","10878","11065","10879","13944","16309","10880","10940","16361","14948","14950","10992","10991","10536","10891","10504","10916","16197","17017","10735","13952","13921","13743","10559","13909","11061","10725","11899","11898","11900","10515","10562","15385","10549","10881","16363","10709","10994","10993","11932","10911","11929","10745","10490","10522","13676","10711","10810","10996","10995","13729","10892","10567","10637","10893","10764","10509","12930","12929","12326","14946","11066","10236","10904","10603","10812","10777","10550","10998","10997","10814","10613","10913","16091","15762","13968","13974","16066","13975","10479","10202","10935","10196","10478","11051","11050","10232","10231","10245","10247","10719","16056","13836","10963","10894","10505","10560","10685","11059","13935","10238","14133","16445","10948","10999","16311","13751","10551","10663","10552","10931","16313","11001","11000","11003","11002","13723","12071","10928","10226","10806","12889","12888","12890","12891","10533","11005","11004","10529","10950","10951","15391","11007","11006","10728","14968","10577","10729","15393","16315","16054","10761","10595","11008","11010","11009","16050","10895","11012","11011","10713","11053","11052","13747","10804","10816","10230","10229","13636","10244","10246","16471","16317","10510","10561","15399","10818","10896","13761","10235","10820","13741","10531","10802","11595","13737","13682","10897","10615","13858","10822","10824","10730","13894","11060","11064","13925","11038","11037","10826","16319","13745","10944","10943","10942","10779","10786","16454","16065","16062","10568","10503","13739","10828","13919","11014","11013","10489","10946","10720","10583","13903","10898","11281","10830","11589","16077","10621","10591","10629","12658","10687","13917","10501","10484","12973","13900","12072","11057","10756","13933","10217","13686","16473","10639","11015","11017","11016","10625","10518","10832","11019","11018","15406","13727","16321","10204","10480","10486","10701","10597","10581","10671","10926","12979","10778","10519","10945","12927","10834","10574","10520","16323","11934","11936","13749","16048","10488","11021","11020","11023","11022","10530","14410","13361","10836","10934","10683","10750","10535","10508","10838","10502","11025","11024","11054","10555","11027","11026","11032","11031","10840","11909","10524","10915","11034","11033","14984","13937","10924","10732","11029","10553","10554","10726","11036","11035","16325","10842","10844","10846","13915","11588","10899","10848","10927","10205","10206","10208","10209","10207","10952","13666","13629","10900","10901","16327","10792","10578","10780","10525","10914","10727","14234","10617","10627","10537","15404","10757","13769","10653","14028","16343","10933","10215","15409","10210","16735","10211","10917","10573","10556","14954","10679","10707","10593","10693","16469","16329","16331","10516","10850","16349","10485","10852","13896"
  ];

  function safeString(v) {
    if (v == null) return "";
    try { return String(v); } catch (e) { return ""; }
  }

  function asBool(v) {
    return v === true || v === "T" || v === "true";
  }

  function safeGetValue(rec, fieldId) {
    try { return rec.getValue({ fieldId }); } catch (e) { return null; }
  }

  function safeGetText(rec, fieldId) {
    try { return rec.getText({ fieldId }); } catch (e) { return ""; }
  }

  function getMultiValue(rec, fieldId) {
    try {
      const val = rec.getValue({ fieldId });
      if (Array.isArray(val)) return val.map((x) => safeString(x)).filter(Boolean);
      if (val == null || val === "") return [];
      return [safeString(val)];
    } catch (e) {
      return [];
    }
  }

  function getItemsByIds(itemIds) {
    const ids = (itemIds || []).map(safeString).filter(Boolean);
    if (!ids.length) return [];

    const out = [];
    try {
      const itemSearch = search.create({
        type: search.Type.ITEM,
        filters: [["internalid", "anyof", ids]],
        columns: [
          search.createColumn({ name: "internalid" }),
          search.createColumn({ name: "itemid" }),
          search.createColumn({ name: "displayname" }),
          search.createColumn({ name: "type" }),
          search.createColumn({ name: "isinactive" })
        ]
      });

      itemSearch.run().each((r) => {
        out.push({
          id: safeString(r.getValue({ name: "internalid" })),
          itemId: safeString(r.getValue({ name: "itemid" })),
          displayName: safeString(r.getValue({ name: "displayname" })),
          type: safeString(r.getText({ name: "type" }) || r.getValue({ name: "type" })),
          inactive: asBool(r.getValue({ name: "isinactive" }))
        });
        return true;
      });
    } catch (e) {
      log.error("getItemsByIds failed", safeString(e && e.message ? e.message : e));
    }

    const byId = {};
    out.forEach((x) => { byId[x.id] = x; });

    return ids.map((id) => byId[id] || {
      id,
      itemId: "",
      displayName: "",
      type: "",
      inactive: false
    });
  }

  function tryLoadCustomList(sourceId) {
    try {
      const rec = record.load({ type: "customlist", id: sourceId });
      const values = [];
      const lineCount = Number(rec.getLineCount({ sublistId: "customvalue" }) || 0);

      for (let i = 0; i < lineCount; i++) {
        values.push({
          id: safeString(rec.getSublistValue({
            sublistId: "customvalue",
            fieldId: "valueid",
            line: i
          })),
          name: safeString(rec.getSublistValue({
            sublistId: "customvalue",
            fieldId: "value",
            line: i
          })),
          inactive: asBool(rec.getSublistValue({
            sublistId: "customvalue",
            fieldId: "isinactive",
            line: i
          }))
        });
      }

      return {
        ok: true,
        kind: "customlist",
        source: {
          id: safeString(sourceId),
          scriptId: safeString(safeGetValue(rec, "scriptid")),
          name: safeString(safeGetValue(rec, "name"))
        },
        values
      };
    } catch (e) {
      return {
        ok: false,
        kind: "customlist",
        error: safeString(e && e.message ? e.message : e)
      };
    }
  }

  function tryResolveCustomRecordType(sourceId) {
    try {
      const typeRec = record.load({ type: "customrecordtype", id: sourceId });
      const scriptId = safeString(safeGetValue(typeRec, "scriptid"));
      const name = safeString(safeGetValue(typeRec, "name"));

      if (!scriptId) {
        return {
          ok: false,
          kind: "customrecord",
          error: "Custom record type scriptId not found"
        };
      }

      const values = [];
      const s = search.create({
        type: scriptId,
        filters: [],
        columns: [
          search.createColumn({ name: "internalid" }),
          search.createColumn({ name: "name" }),
          search.createColumn({ name: "isinactive" })
        ]
      });

      s.run().each((r) => {
        values.push({
          id: safeString(r.getValue({ name: "internalid" })),
          name: safeString(r.getValue({ name: "name" })),
          inactive: asBool(r.getValue({ name: "isinactive" }))
        });
        return true;
      });

      return {
        ok: true,
        kind: "customrecord",
        source: {
          id: safeString(sourceId),
          scriptId,
          name
        },
        values
      };
    } catch (e) {
      return {
        ok: false,
        kind: "customrecord",
        error: safeString(e && e.message ? e.message : e)
      };
    }
  }

  function serialiseItemOption(id) {
    const rec = record.load({
      type: "itemoptioncustomfield",
      id: id
    });

    const sourceId = safeString(safeGetValue(rec, "selectrecordtype"));
    const sourceText = safeString(safeGetText(rec, "selectrecordtype"));

    const appliedItemIds = getMultiValue(rec, "items");
    const appliedItems = getItemsByIds(appliedItemIds);

    let sourceResult = null;
    if (sourceId) {
      const listTry = tryLoadCustomList(sourceId);
      if (listTry.ok) {
        sourceResult = listTry;
      } else {
        const recordTry = tryResolveCustomRecordType(sourceId);
        if (recordTry.ok) {
          sourceResult = recordTry;
        } else {
          sourceResult = {
            ok: false,
            sourceId,
            sourceText,
            listError: listTry.error,
            customRecordError: recordTry.error
          };
        }
      }
    }

    return {
      id: safeString(id),
      label: safeString(safeGetValue(rec, "label")),
      scriptId: safeString(safeGetValue(rec, "scriptid")),
      inactive: asBool(safeGetValue(rec, "inactive")),
      selectrecordtype: sourceId,
      selectrecordtype_text: sourceText,
      includeChildItems: asBool(safeGetValue(rec, "includechilditems")),
      appliesToSales: asBool(safeGetValue(rec, "colsale")),
      appliedItemIds,
      appliedItems,
      sourceResult
    };
  }

  function onRequest(context) {
    const response = context.response;
    const request = context.request;

    try {
      let ids = ITEM_OPTION_IDS.slice();

      const only = safeString(request.parameters.only);
      if (only) {
        const allowed = only.split(",").map((s) => s.trim()).filter(Boolean);
        ids = ids.filter((id) => allowed.indexOf(id) !== -1);
      }

      const includeInactive = safeString(request.parameters.includeInactive) === "T";

      let pageSize = parseInt(request.parameters.pageSize || "25", 10);
      if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 25;
      if (pageSize > 100) pageSize = 100;

      let page = parseInt(request.parameters.page || "1", 10);
      if (!Number.isFinite(page) || page < 1) page = 1;

      const totalRecords = ids.length;
      const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
      if (page > totalPages) page = totalPages;

      const startIndex = (page - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalRecords);

      const pageIds = ids.slice(startIndex, endIndex);

      const results = [];
      const errors = [];

      pageIds.forEach((id) => {
        try {
          const row = serialiseItemOption(id);
          if (!includeInactive && row.inactive) return;
          results.push(row);
        } catch (e) {
          errors.push({
            id: safeString(id),
            message: safeString(e && e.message ? e.message : e)
          });
        }
      });

      response.setHeader({
        name: "Content-Type",
        value: "application/json; charset=utf-8"
      });

      response.write(JSON.stringify({
        ok: true,
        meta: {
          configuredCount: ITEM_OPTION_IDS.length,
          filteredCount: totalRecords,
          page,
          pageSize,
          totalPages,
          totalRecords,
          startIndex,
          endIndex: endIndex - 1,
          hasPrev: page > 1,
          hasNext: page < totalPages,
          prevPage: page > 1 ? page - 1 : null,
          nextPage: page < totalPages ? page + 1 : null
        },
        returnedCount: results.length,
        failed: errors.length,
        results,
        errors
      }));
    } catch (e) {
      response.setHeader({
        name: "Content-Type",
        value: "application/json; charset=utf-8"
      });

      response.write(JSON.stringify({
        ok: false,
        error: safeString(e && e.message ? e.message : e)
      }));
    }
  }

  return { onRequest };
});