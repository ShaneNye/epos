(function () {
  const DRAFT_KEY = "salesKioskDraft:v1";
  const TTL_MS = 2 * 60 * 60 * 1000;

  function readDraft() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.createdAt || Date.now() - parsed.createdAt > TTL_MS) {
        sessionStorage.removeItem(DRAFT_KEY);
        return null;
      }
      if (!Array.isArray(parsed.lines) || !parsed.lines.length) return null;
      return parsed;
    } catch (err) {
      console.warn("Failed to read Sales Kiosk draft:", err);
      return null;
    }
  }

  async function waitForEditor() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (
        window.salesNewItemEditor?.applyItemToRow &&
        Array.isArray(window.items) &&
        window.items.length
      ) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
  }

  async function importDraft() {
    const draft = readDraft();
    if (!draft) return;

    const ready = await waitForEditor();
    if (!ready) return;

    try {
      for (let index = 0; index < draft.lines.length; index += 1) {
        const line = draft.lines[index];
        const item = window.items.find(
          (entry) => String(entry["Internal ID"] || "") === String(line.itemId || "")
        );
        if (!item) continue;

        if (index > 0) {
          document.getElementById("addItemBtn")?.click();
          await new Promise((resolve) => setTimeout(resolve, 60));
        }

        const row = document.querySelector(`#orderItemsBody .order-line[data-line="${index}"]`);
        if (!row) continue;

        window.salesNewItemEditor.applyItemToRow(row, item, {
          quantity: line.quantity,
          salePrice: line.salePrice,
          fulfilmentMethod: line.fulfilmentMethod || "",
          inventoryDetail: line.inventoryDetail || "",
          inventoryMeta: line.inventoryMeta || "",
          inventoryMetaJson: line.inventoryMetaJson || "",
          lotnumber: line.lotnumber || "",
          optionsSelections: line.optionsSelections || {},
        });
      }

      sessionStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      console.error("Failed importing Sales Kiosk draft:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", importDraft);
})();
