const { nsPost, nsRestlet } = require("../netsuiteClient");

function trim(value) {
  return String(value || "").trim();
}

function normalizeCustomerPhone(value) {
  const phone = trim(value);
  return phone || "00000";
}

function normalizeCustomerEmail(value) {
  return trim(value);
}

function isLikelyEmail(value) {
  const email = normalizeCustomerEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicRequestError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function assignCustomerTitleIfPresent(body, title) {
  const titleId = trim(title);
  if (titleId) body.custentity_title = titleId;
}

function removeBlankFields(body) {
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === "") {
      delete body[key];
    }
  }
  return body;
}

function buildCustomerCreateBody(customer = {}) {
  const email = normalizeCustomerEmail(customer.email);
  if (!email) {
    throw publicRequestError("Customer email is required when creating a customer.");
  }
  if (!isLikelyEmail(email)) {
    throw publicRequestError("Enter a valid customer email before creating the customer.");
  }

  const firstName = trim(customer.firstName);
  const lastName = trim(customer.lastName);
  const noAddressRequired = customer?.noAddressRequired === true;

  const body = removeBlankFields({
    entityStatus: { id: "13" },
    companyName: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    email,
    phone: normalizeCustomerPhone(customer.contactNumber),
    altPhone: trim(customer.altContactNumber),
    subsidiary: { id: "1" },
    isPerson: true,
  });
  assignCustomerTitleIfPresent(body, customer?.title);

  if (!noAddressRequired) {
    body.addressbook = {
      items: [
        {
          defaultShipping: true,
          defaultBilling: true,
          label: "Main Address",
          addressbookAddress: {
            addr1: trim(customer.address1),
            addr2: trim(customer.address2),
            city: trim(customer.address3),
            state: trim(customer.county),
            zip: trim(customer.postcode),
          },
        },
      ],
    };
  }

  return body;
}

function extractCustomerId(result) {
  if (!result) return null;
  if (result.id) return String(result.id);
  if (result.internalId) return String(result.internalId);
  if (result.customerId) return String(result.customerId);

  const location = result._location || result.location || "";
  const match = String(location).match(/customer\/(\d+)/i);
  return match ? match[1] : null;
}

async function createNetSuiteCustomer(customer, userId) {
  const body = buildCustomerCreateBody(customer);
  const restletUrl = trim(process.env.NETSUITE_CUSTOMER_CREATE_RESTLET_URL);

  if (restletUrl) {
    console.log("Creating customer via customer-create RESTlet:", {
      hasEmail: !!body.email,
      noAddressRequired: customer?.noAddressRequired === true,
    });

    const result = await nsRestlet(restletUrl, body, userId, "POST");
    if (result?.ok === false) {
      throw new Error(result.error || "NetSuite customer-create RESTlet failed");
    }

    const customerId = extractCustomerId(result);
    if (!customerId) {
      throw new Error("Customer-create RESTlet did not return a customer ID");
    }

    return { id: customerId, body, via: "restlet" };
  }

  console.log("Creating customer via NetSuite REST Record API:", {
    hasEmail: !!body.email,
    noAddressRequired: customer?.noAddressRequired === true,
  });

  const result = await nsPost("/customer", body, userId, "sb");
  const customerId = extractCustomerId(result);
  if (!customerId) throw new Error("Failed to resolve new customer ID");

  return { id: customerId, body, via: "record-api" };
}

module.exports = {
  buildCustomerCreateBody,
  createNetSuiteCustomer,
  isLikelyEmail,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  publicRequestError,
};
