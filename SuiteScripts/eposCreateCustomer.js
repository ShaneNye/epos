/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(["N/record", "N/log"], (record, log) => {
  function valueOfRef(value) {
    if (value && typeof value === "object") return value.id || value.value || "";
    return value || "";
  }

  function text(value) {
    return String(value || "").trim();
  }

  function setIfPresent(rec, fieldId, value) {
    const cleaned = typeof value === "string" ? text(value) : value;
    if (cleaned === undefined || cleaned === null || cleaned === "") return;
    rec.setValue({ fieldId, value: cleaned });
  }

  function setAddress(rec, addressbook) {
    const firstAddress = addressbook?.items?.[0];
    const address = firstAddress?.addressbookAddress;
    if (!address) return;

    rec.insertLine({ sublistId: "addressbook", line: 0 });
    rec.setSublistValue({
      sublistId: "addressbook",
      fieldId: "defaultshipping",
      line: 0,
      value: firstAddress.defaultShipping === true,
    });
    rec.setSublistValue({
      sublistId: "addressbook",
      fieldId: "defaultbilling",
      line: 0,
      value: firstAddress.defaultBilling === true,
    });
    if (text(firstAddress.label)) {
      rec.setSublistValue({
        sublistId: "addressbook",
        fieldId: "label",
        line: 0,
        value: text(firstAddress.label),
      });
    }

    const subrecord = rec.getSublistSubrecord({
      sublistId: "addressbook",
      fieldId: "addressbookaddress",
      line: 0,
    });
    setIfPresent(subrecord, "addr1", address.addr1);
    setIfPresent(subrecord, "addr2", address.addr2);
    setIfPresent(subrecord, "city", address.city);
    setIfPresent(subrecord, "state", address.state);
    setIfPresent(subrecord, "zip", address.zip);
  }

  function post(data = {}) {
    log.debug("EPOS customer create payload", {
      hasEmail: !!data.email,
      hasAddress: !!data.addressbook?.items?.length,
    });

    try {
      const email = text(data.email);
      if (!email) throw new Error("Missing required field: email");

      const rec = record.create({
        type: record.Type.CUSTOMER,
        isDynamic: false,
      });

      rec.setValue({ fieldId: "isperson", value: data.isPerson !== false });
      setIfPresent(rec, "entitystatus", valueOfRef(data.entityStatus));
      setIfPresent(rec, "subsidiary", valueOfRef(data.subsidiary));
      setIfPresent(rec, "companyname", data.companyName);
      setIfPresent(rec, "firstname", data.firstName);
      setIfPresent(rec, "lastname", data.lastName);
      setIfPresent(rec, "email", email);
      setIfPresent(rec, "phone", data.phone);
      setIfPresent(rec, "altphone", data.altPhone);
      setIfPresent(rec, "custentity_title", valueOfRef(data.custentity_title));
      setAddress(rec, data.addressbook);

      const id = rec.save({
        enableSourcing: true,
        ignoreMandatoryFields: false,
      });
      log.audit("EPOS customer created", { id, hasEmail: true });

      return { ok: true, id };
    } catch (err) {
      log.error("EPOS customer create failed", err);
      return { ok: false, error: err.message };
    }
  }

  function get(params) {
    return { ok: true, message: "EPOS customer create RESTlet is live", params };
  }

  return { post, get };
});
