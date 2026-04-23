const productFeeds = {
  sandbox:
    "https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4058&deploy=2&compid=7972741_SB1&ns-at=AAEJ7tMQ-74HtNHaDkUIVEeh7BJ5FkmE6ELyzq7-HDyCsW7QtU4",
  production:
    "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4349&deploy=1&compid=7972741&ns-at=AAEJ7tMQJry3Xg_bYRGo6Nb9K7z8_2rleWv3_ujrUWhzaxks0Io",
};

const optionFeeds = {
  "Class": {
    sandbox: "SUITEPIM_SANDBOX_CLASS_FEED_URL",
    production: "SUITEPIM_PROD_CLASS_FEED_URL",
    defaultSandbox:
      "https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4060&deploy=1&compid=7972741_SB1&ns-at=AAEJ7tMQSZ9m0red-oo6DXPZPPXnRO-GNulE24ElPN_mylZzPFY",
    defaultProduction:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4350&deploy=1&compid=7972741&ns-at=AAEJ7tMQ6gXGb-vnNauhwWeEKPyMbLqQq-2k6SDvSApCCp3oiUg",
  },
  "Sub-Class": {
    sandbox: "SUITEPIM_SANDBOX_CLASS_FEED_URL",
    production: "SUITEPIM_PROD_CLASS_FEED_URL",
    defaultSandbox:
      "https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4060&deploy=1&compid=7972741_SB1&ns-at=AAEJ7tMQSZ9m0red-oo6DXPZPPXnRO-GNulE24ElPN_mylZzPFY",
    defaultProduction:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4350&deploy=1&compid=7972741&ns-at=AAEJ7tMQ6gXGb-vnNauhwWeEKPyMbLqQq-2k6SDvSApCCp3oiUg",
  },
  "Lead Time": {
    sandbox: "SUITEPIM_SANDBOX_LEAD_TIME_FEED_URL",
    production: "SUITEPIM_PROD_LEAD_TIME_FEED_URL",
    defaultSandbox:
      "https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4061&deploy=1&compid=7972741_SB1&ns-at=AAEJ7tMQunqZrTigLdKbwNR8zugyPk-_c97Orrg3Yvclxq_J3Uo",
    defaultProduction:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4351&deploy=1&compid=7972741&ns-at=AAEJ7tMQ_OGgGdPJmObcIQ9bLUboSg_5qESl552MtD_LV0iaFyo",
  },
  "Preferred Supplier": {
    sandbox: "SUITEPIM_SANDBOX_SUPPLIER_FEED_URL",
    production: "SUITEPIM_PROD_SUPPLIER_FEED_URL",
    defaultSandbox:
      "https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4062&deploy=1&compid=7972741_SB1&ns-at=AAEJ7tMQuVVpxBhFJ_f9Mh1J1yh-lhszFd2X9-tT7ZaadZ_fTkw",
    defaultProduction:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4352&deploy=1&compid=7972741&ns-at=AAEJ7tMQMfdQuRFm3vrD69S7SrazDWZtpj-3h8yWEw-pEo7xJpM",
  },
  "Web Fabrics": {
    sandbox: "SUITEPIM_SANDBOX_WEB_FABRICS_FEED_URL",
    production: "SUITEPIM_PROD_WEB_FABRICS_FEED_URL",
    defaultSandbox:
      "https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4071&deploy=1&compid=7972741_SB1&ns-at=AAEJ7tMQvzlM4oJsjY9bg35LIfIJ3beDV8rr9Zb87xgSVfh4vjM",
    defaultProduction:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4362&deploy=1&compid=7972741&ns-at=AAEJ7tMQuCblTEy2bK9e9ubRsyK1iJejSbpT0qKiF6gKlp70jQU",
  },
  "Web Images": {
    sandbox: "SUITEPIM_SANDBOX_WEB_IMAGES_FEED_URL",
    production: "SUITEPIM_PROD_WEB_IMAGES_FEED_URL",
    defaultSandbox:
      "https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4072&deploy=1&compid=7972741_SB1&ns-at=AAEJ7tMQJitxmFxKycziSYTCbda2g5B5wOaeadZmInVwV2x4its",
    defaultProduction:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4363&deploy=1&compid=7972741&ns-at=AAEJ7tMQj7nwNmk-xPekCtRHeFZqWvqHsTMC61_Fm5CUtqC4tJM",
  },
  "Reasons To Buy": {
    sandbox: "SUITEPIM_SANDBOX_REASONS_TO_BUY_FEED_URL",
    production: "SUITEPIM_PROD_REASONS_TO_BUY_FEED_URL",
    defaultSandbox:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4399&deploy=1&compid=7972741&ns-at=AAEJ7tMQshIS5msG7CoaDtoEGWXc55kRX059TX6GCiAUJeBu248",
    defaultProduction:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4399&deploy=1&compid=7972741&ns-at=AAEJ7tMQshIS5msG7CoaDtoEGWXc55kRX059TX6GCiAUJeBu248",
  },
  "Epos Fabric Colours": {
    sandbox: "SUITEPIM_SANDBOX_FABRIC_COLOURS_FEED_URL",
    production: "SUITEPIM_PROD_FABRIC_COLOURS_FEED_URL",
    defaultSandbox:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4519&deploy=1&compid=7972741&ns-at=AAEJ7tMQx1il7XmlrmBP3OnEFOcOaQ3fBQP5LRSYMiDumyAXS4c",
    defaultProduction:
      "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4519&deploy=1&compid=7972741&ns-at=AAEJ7tMQx1il7XmlrmBP3OnEFOcOaQ3fBQP5LRSYMiDumyAXS4c",
  },
};

const fields = [
  { name: "Internal ID", disableField: true },
  { name: "Name", internalid: "itemid", fieldType: "Free-Form Text" },
  { name: "Display Name", internalid: "displayname", fieldType: "Free-Form Text" },
  { name: "Supplier Name", internalid: "vendorname", fieldType: "Free-Form Text" },
  { name: "Class", internalid: "class", fieldType: "List/Record", optionFeed: "Class" },
  { name: "Purchase Price", internalid: "cost", fieldType: "Currency" },
  { name: "Base Price", internalid: "price", fieldType: "Currency" },
  { name: "Sub-Class", internalid: "custitem_sb_sub_class", fieldType: "List/Record", optionFeed: "Sub-Class" },
  { name: "Lead Time", internalid: "custitem_sb_leadtime_ltd", fieldType: "List/Record", optionFeed: "Lead Time" },
  { name: "Preferred Supplier", internalid: "vendor", fieldType: "List/Record", optionFeed: "Preferred Supplier" },
  { name: "Inactive", internalid: "isinactive", fieldType: "Checkbox" },
  { name: "Is Parent", internalid: "parent", fieldType: "Checkbox" },
  { name: "NS record", internalid: "nsrecord", fieldType: "Link", disableField: true },
  { name: "Record Type", internalid: "type", fieldType: "Free-Form Text", disableField: true },
  { name: "Size", disableField: true },
  { name: "Fabric / Colours", internalid: "custitem_sb_epos_fab_colours", fieldType: "multiple-select", optionFeed: "Epos Fabric Colours" },
  { name: "Category", internalid: "custitem_sb_category", fieldType: "multiple-select", optionFeed: "Class" },
  { name: "Fabric", internalid: "custitem_sb_web_fabric_swatch", fieldType: "multiple-select", optionFeed: "Web Fabrics" },
  { name: "Woo ID", internalid: "custitem_magentoid", fieldType: "Free-Form Text", disableField: true },
  { name: "Catalogue Image One", internalid: "custitem_sb_cat_img_one", fieldType: "image", optionFeed: "Web Images" },
  { name: "Catalogue Image Two", internalid: "custitem_sb_cat_img_two", fieldType: "image", optionFeed: "Web Images" },
  { name: "Catalogue Image Three", internalid: "custitem_sb_cat_img_three", fieldType: "image", optionFeed: "Web Images" },
  { name: "Catalogue Image Four", internalid: "custitem_sb_cat_img_four", fieldType: "image", optionFeed: "Web Images" },
  { name: "Catalogue Image Five", internalid: "custitem_sb_cat_img_five", fieldType: "image", optionFeed: "Web Images" },
  { name: "Item Image", internalid: "custitem_atlas_item_image", fieldType: "image", optionFeed: "Web Images" },
  { name: "Colour Filter", internalid: "custitem_sb_colour", fieldType: "Free-Form Text" },
  { name: "Fillings", internalid: "custitem_sb_fillings", fieldType: "Free-Form Text" },
  { name: "Length", internalid: "custitem_sb_length", fieldType: "Free-Form Text" },
  { name: "Turnable", internalid: "custitem_sb_turnable", fieldType: "Free-Form Text" },
  { name: "Country Of Origin", internalid: "custitem_sb_country_of_origin", fieldType: "Free-Form Text" },
  { name: "Head End Height", internalid: "custitem_sb_head_height", fieldType: "Free-Form Text" },
  { name: "Spring Type", internalid: "custitem_sb_spring_type", fieldType: "Free-Form Text" },
  { name: "Warranty", internalid: "custitem_sb_warranty", fieldType: "Free-Form Text" },
  { name: "Standard-Sizes", internalid: "custitem_sb_standard_sizes", fieldType: "Free-Form Text" },
  { name: "Tags", internalid: "custitem_sb_tags", fieldType: "Free-Form Text" },
  { name: "Depth", internalid: "custitem_sb_depth", fieldType: "Free-Form Text" },
  { name: "Height", internalid: "custitem_sb_height", fieldType: "Free-Form Text" },
  { name: "Width", internalid: "custitem_sb_width", fieldType: "Free-Form Text" },
  { name: "Storage", internalid: "custitem_sb_storage", fieldType: "Free-Form Text" },
  { name: "Built/Flat Packed", internalid: "custitem_sb_built_flat_packed", fieldType: "Free-Form Text" },
  { name: "Dimension Unit", internalid: "custitem_sb_dimension_unit", fieldType: "Free-Form Text" },
  { name: "Surface", internalid: "custitem_sb_surface", fieldType: "Free-Form Text" },
  { name: "Type", internalid: "custitem_sb_type", fieldType: "Free-Form Text" },
  { name: "Comfort", internalid: "custitem_sb_comfort", fieldType: "Free-Form Text" },
  { name: "Online?", fieldType: "Checkbox", disableField: true },
  { name: "Short Description", internalid: "storedescription", fieldType: "rich-text" },
  { name: "Detailed Description", internalid: "storedetaileddescription", fieldType: "rich-text" },
  { name: "New Short Desc", internalid: "custitem_sb_wb_short_description", fieldType: "rich-text" },
  { name: "Description Preview", internalid: "custitem_sb_web_desc", fieldType: "rich-text" },
  { name: "reasons to buy", internalid: "custitem_sb_reasons_to_buy", fieldType: "multiple-select", optionFeed: "Reasons To Buy" },
  { name: "New Feature Desc", internalid: "custitem_sb_web_prod_description", fieldType: "rich-text" },
];

module.exports = {
  fields,
  optionFeeds,
  productFeeds,
};
