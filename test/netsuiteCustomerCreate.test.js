const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCustomerCreateBody,
  customerCountyDisplayValue,
} = require("../utils/netsuiteCustomerCreate");

const baseCustomer = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  postcode: "BH1 1AA",
  address1: "1 Example Street",
  address2: "",
  address3: "Bournemouth",
  contactNumber: "01202 000000",
};

test("customerCountyDisplayValue prefers county display text over dropdown id", () => {
  assert.equal(
    customerCountyDisplayValue({ county: "269", countyName: "Dorset" }),
    "Dorset"
  );
});

test("buildCustomerCreateBody sends address state as county display text", () => {
  const body = buildCustomerCreateBody({
    ...baseCustomer,
    county: "269",
    countyName: "Dorset",
  });

  assert.equal(
    body.addressbook.items[0].addressbookAddress.state,
    "Dorset"
  );
});

test("buildCustomerCreateBody falls back to county when no display text is supplied", () => {
  const body = buildCustomerCreateBody({
    ...baseCustomer,
    county: "Dorset",
  });

  assert.equal(
    body.addressbook.items[0].addressbookAddress.state,
    "Dorset"
  );
});
