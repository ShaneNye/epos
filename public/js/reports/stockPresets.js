// /public/js/reports/stockPresets.js

export const stockSearchPresets = [
  {
    name: 'Pillows Sussex W/h',
    filters: [
      { filter: "Class", value: "Pillows" },
      { filter: "Status", value: "stock" },
      { filter: "Location", value: "Sussex Main Warehouse" }
    ]
  },
  {
    name: 'Pillows Kent W/H',
    filters: [
      { filter: "Class", value: "Pillows" },
      { filter: "Status", value: "stock" },
      { filter: "Location", value: "Kent Main Warehouse" }
    ]
  },
  {
    name: 'Protectors Sussex W/H',
    filters: [
      { filter: "Class", value: "Mattress Protectors" },
      { filter: "Status", value: "stock" },
      { filter: "Location", value: "Sussex Main Warehouse" }
    ]
  },
  {
    name: 'Protectors Kent W/H',
    filters: [
      { filter: "Class", value: "Mattress Protectors" },
      { filter: "Status", value: "stock" },
      { filter: "Location", value: "Kent Main Warehouse" } // (you had "Keny" typo)
    ]
  }
];
