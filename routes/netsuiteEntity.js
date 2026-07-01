const express = require("express");
const router = express.Router();
const { nsGet, nsPatch, nsPostRaw } = require("../netsuiteClient");
const { getSession } = require("../sessions");

function trim(value) {
  return String(value || "").trim();
}

async function resolveUserIdFromAuth(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return null;
  const session = await getSession(token);
  return session?.id || null;
}

function addressValue(address = {}, key) {
  const value = address[key];
  if (value && typeof value === "object") {
    return trim(value.id || value.value || value.refName || value.name);
  }
  return trim(value);
}

function rowValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    if (value && typeof value === "object") {
      const objectValue = trim(value.id || value.value || value.refName || value.name);
      if (objectValue) return objectValue;
      continue;
    }
    const stringValue = trim(value);
    if (stringValue) return stringValue;
  }
  return "";
}

function buildAddressBookItems(addresses = []) {
  return addresses
    .map((address, index) => {
      const line1 = addressValue(address, "address1");
      const line2 = addressValue(address, "address2");
      const line3 = addressValue(address, "address3");
      const county = addressValue(address, "county");
      const postcode = addressValue(address, "postcode");

      if (![line1, line2, line3, county, postcode].some(Boolean)) return null;

      const item = {
        defaultShipping: address.defaultShipping === true || index === 0,
        defaultBilling: address.defaultBilling === true || index === 0,
        label: trim(address.label) || line1 || `Address ${index + 1}`,
        addressbookAddress: {
          addr1: line1,
          addr2: line2,
          city: line3,
          state: county || undefined,
          zip: postcode,
        },
      };

      const id = trim(address.id || address.internalId || address.internalid);
      if (id) {
        const numericId = Number(id);
        item.id = Number.isFinite(numericId) ? numericId : id;
      }

      return item;
    })
    .filter(Boolean);
}

function suiteQlUrl() {
  return `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

function normalizeAddressBookRows(rows = []) {
  return rows
    .map((row, index) => {
      const nestedAddress =
        row.addressBookAddress ||
        row.addressbookAddress ||
        row.addressbookaddress ||
        {};
      const addressId = trim(row.id || row.internalid || row.addressbook_id || row.addressbookid);
      const addr1 = rowValue(row.addr1, row.address1, nestedAddress.addr1, nestedAddress.address1);
      const addr2 = rowValue(row.addr2, row.address2, nestedAddress.addr2, nestedAddress.address2);
      const city = rowValue(row.city, row.addr3, row.address3, nestedAddress.city, nestedAddress.addr3);
      const state = rowValue(row.state, row.county, nestedAddress.state, nestedAddress.county);
      const zip = rowValue(row.zip, row.postcode, row.postalcode, nestedAddress.zip, nestedAddress.postcode);
      const addrText = rowValue(
        row.addrtext ||
          row.addresstext ||
          row.address_text ||
          row.address ||
          row.addressBookAddress_text ||
          row.addressbookAddress_text ||
          nestedAddress.addrText ||
          nestedAddress.addrtext
      );

      if (![addressId, addr1, addr2, city, state, zip, addrText].some(Boolean)) return null;

      return {
        id: addressId,
        label: trim(row.label) || addr1 || `Address ${index + 1}`,
        defaultShipping:
          row.defaultshipping === true ||
          row.defaultshipping === "T" ||
          String(row.defaultshipping || "").toLowerCase() === "yes",
        defaultBilling:
          row.defaultbilling === true ||
          row.defaultbilling === "T" ||
          String(row.defaultbilling || "").toLowerCase() === "yes",
        addressbookAddress: {
          addr1,
          addr2,
          city,
          state,
          zip,
          addrText,
        },
      };
    })
    .filter(Boolean);
}

async function fetchAddressBookViaSubresource(id, userId) {
  const encodedId = encodeURIComponent(id);
  const endpoints = [
    `/customer/${encodedId}/addressbook?expandSubResources=true`,
    `/customer/${encodedId}/addressBook?expandSubResources=true`,
  ];

  for (const endpoint of endpoints) {
    try {
      const result = await nsGet(endpoint, userId, "sb");
      const items = Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result)
          ? result
          : [];
      if (items.length) return items;
    } catch (err) {
      console.warn(`Customer addressbook subresource failed for ${endpoint}:`, err.message);
    }
  }

  return [];
}

async function fetchAddressBookViaSuiteQl(id, userId) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) return [];

  const queries = [
    `
      SELECT
        cab.id,
        cab.internalid,
        cab.defaultshipping,
        cab.defaultbilling,
        cab.label,
        ea.addr1,
        ea.addr2,
        ea.city,
        ea.state,
        ea.zip,
        ea.addrtext
      FROM customerAddressbook cab
      LEFT JOIN customerAddressbookEntityAddress ea
        ON ea.nkey = cab.addressbookaddress
      WHERE cab.entity = ${numericId}
      ORDER BY cab.defaultshipping DESC, cab.defaultbilling DESC, cab.id
    `,
    `
      SELECT
        cab.id,
        cab.internalid,
        cab.defaultshipping,
        cab.defaultbilling,
        cab.label,
        ea.addr1,
        ea.addr2,
        ea.city,
        ea.state,
        ea.zip,
        ea.addrtext
      FROM CustomerAddressbook cab
      LEFT JOIN EntityAddress ea
        ON ea.nkey = cab.addressbookaddress
      WHERE cab.entity = ${numericId}
      ORDER BY cab.defaultshipping DESC, cab.defaultbilling DESC, cab.id
    `,
    `
      SELECT
        cab.id,
        cab.internalid,
        cab.defaultshipping,
        cab.defaultbilling,
        cab.label,
        BUILTIN.DF(cab.addressbookaddress) AS address_text
      FROM customerAddressbook cab
      WHERE cab.entity = ${numericId}
      ORDER BY cab.defaultshipping DESC, cab.defaultbilling DESC, cab.id
    `,
  ];

  for (const query of queries) {
    try {
      const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId, "sb");
      const rows = Array.isArray(result?.items) ? result.items : [];
      if (rows.length) return normalizeAddressBookRows(rows);
    } catch (err) {
      console.warn("Customer addressbook SuiteQL attempt failed:", err.message);
    }
  }

  return [];
}

async function fetchCustomerAddressBook(id, userId) {
  const subresourceItems = await fetchAddressBookViaSubresource(id, userId);
  const normalizedSubresource = normalizeAddressBookRows(subresourceItems);
  const hasExpandedFields = normalizedSubresource.some((address) => {
    const addr = address.addressbookAddress || {};
    return !!(addr.addr1 || addr.addr2 || addr.city || addr.state || addr.zip || addr.addrText);
  });
  if (hasExpandedFields) return normalizedSubresource;

  const suiteQlItems = await fetchAddressBookViaSuiteQl(id, userId);
  return suiteQlItems.length ? suiteQlItems : normalizedSubresource;
}

async function hydrateCustomerAddressBook(entity, id, userId) {
  const addressItems = await fetchCustomerAddressBook(id, userId);
  if (!addressItems.length) return entity;

  return {
    ...entity,
    addressbook: {
      ...(entity.addressbook && typeof entity.addressbook === "object" ? entity.addressbook : {}),
      items: addressItems,
    },
  };
}

async function fetchCustomerExpanded(id, userId) {
  const encodedId = encodeURIComponent(id);
  let entity;
  try {
    entity = await nsGet(`/customer/${encodedId}?expandSubResources=true`, userId, "sb");
  } catch (err) {
    console.warn("Expanded customer fetch failed, retrying basic customer fetch:", err.message);
    entity = await nsGet(`/customer/${encodedId}`, userId, "sb");
  }

  return hydrateCustomerAddressBook(entity, id, userId);
}

// netsuiteEntity.js
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const userId = await resolveUserIdFromAuth(req);

    console.log(`🔎 Fetching NetSuite entity ${id} (user ${userId || "env default"})`);
    const entity = await fetchCustomerExpanded(id, userId);

    console.log("✅ Entity fetched:", {
      id: entity.id,
      title: entity.custentity_title?.refName,
    });
    res.json({ ok: true, entity });
  } catch (err) {
    console.error("❌ Failed to fetch entity:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const userId = await resolveUserIdFromAuth(req);
    const {
      firstName,
      lastName,
      contactNumber,
      altContactNumber,
      email,
      addresses = [],
    } = req.body || {};

    const patchBody = {
      firstName: trim(firstName),
      lastName: trim(lastName),
      companyName: [trim(firstName), trim(lastName)].filter(Boolean).join(" "),
      phone: trim(contactNumber),
      altPhone: trim(altContactNumber),
      email: trim(email),
    };

    for (const key of Object.keys(patchBody)) {
      if (patchBody[key] === "") delete patchBody[key];
    }

    const addressItems = buildAddressBookItems(addresses);
    if (addressItems.length) {
      patchBody.addressbook = { items: addressItems };
    }

    console.log("Updating NetSuite customer details:", {
      id,
      userId: userId || "env default",
      fields: Object.keys(patchBody),
      addresses: addressItems.length,
    });

    await nsPatch(
      `/customer/${encodeURIComponent(id)}${addressItems.length ? "?replace=addressbook" : ""}`,
      patchBody,
      userId,
      "sb"
    );

    const entity = await fetchCustomerExpanded(id, userId);
    return res.json({ ok: true, entity });
  } catch (err) {
    console.error("Failed to update NetSuite customer:", err.message);
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
