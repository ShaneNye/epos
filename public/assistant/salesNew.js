// public/assistant/salesNew.js
console.log("🤖 VSA Sales New Assistant active");

// ✅ Import from shared assistant hook
import { registerAssistantFeature } from "/assistant/assistantHooks.js";

document.addEventListener("DOMContentLoaded", async () => {
  const saved = storageGet?.();
  if (!saved?.token) return;

  const headers = { Authorization: `Bearer ${saved.token}` };
  const path = window.location.pathname;
  if (!path.includes("/sales/new")) return; // ✅ Only run on New Sales Order pages

  // --- Preload VSA item dataset ---
  let itemDataCache = [];
  try {
    const res = await fetch("/api/netsuite/vsa-item-data", { headers });
    const data = await res.json();
    itemDataCache = data.results || data.data || [];
    console.log(`📦 Cached ${itemDataCache.length} VSA item records`);
  } catch (err) {
    console.error("❌ Error fetching VSA item data:", err);
  }

  /* ==========================================================
     📡 Dynamic item tracking
     ========================================================== */
  function getCurrentItems() {
    const rows = document.querySelectorAll("#orderItemsBody tr");
    const items = [];
    rows.forEach((row) => {
      const nameInput = row.querySelector(".item-search");
      const val = nameInput?.value?.trim();
      if (val) items.push(val);
    });
    return [...new Set(items)];
  }

  const orderBody = document.getElementById("orderItemsBody");
  const observer = new MutationObserver(() => {
    console.log("🔄 Items changed:", getCurrentItems());
  });
  if (orderBody) observer.observe(orderBody, { childList: true, subtree: true });

  /* ==========================================================
     🧭 Assistant Registration (using shared hook)
     ========================================================== */
  registerAssistantFeature("Items", (chatBody) => {
    startSalesNewFlow(chatBody);
  });

  /* ==========================================================
     💬 Chat Flow
     ========================================================== */
  function startSalesNewFlow(chatBody) {
    chatBody.innerHTML = "";
    addMessage("I can help with your new sales order…", "bot", chatBody);
    showItemsList(chatBody);
  }

  function showItemsList(chatBody) {
    clearInteractive(chatBody);
    const items = getCurrentItems();

    if (!items.length) {
      addMessage("You haven’t added any items yet — please add one first!", "bot", chatBody);
      return;
    }

    addMessage("Which item would you like help with?", "bot", chatBody);

    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.textContent = item;
      btn.className = "assistant-btn";
      btn.onclick = () => showFieldOptions(item, chatBody);
      chatBody.appendChild(btn);
    });
  }

  function showFieldOptions(itemName, chatBody) {
    clearInteractive(chatBody);
    addMessage(`What would you like to know about "${itemName}"?`, "bot", chatBody);

    const match = (itemDataCache || []).find(
      (i) => i["Display Name"]?.trim().toLowerCase() === itemName.trim().toLowerCase()
    );

    if (!match) {
      addMessage("I couldn’t find this item in the NetSuite VSA dataset.", "bot", chatBody);
      return;
    }

    const select = document.createElement("select");
    select.className = "assistant-select";
    select.innerHTML = `
      <option value="">Select field...</option>
      ${Object.keys(match)
        .map((f) => `<option value="${f}">${f}</option>`)
        .join("")}
    `;
    select.onchange = () => showFieldValue(match, select.value, chatBody);
    chatBody.appendChild(select);
  }

  function showFieldValue(itemObj, field, chatBody) {
    if (!field) return;
    const val = itemObj[field] ?? "(empty)";
    addMessage(`The '${field}' value is '${val}'.`, "bot", chatBody);
  }

  /* ==========================================================
     Helpers
     ========================================================== */
  function addMessage(text, sender, targetBody) {
    const div = document.createElement("div");
    div.className = `assistant-message ${sender}`;
    div.textContent = text;
    targetBody.appendChild(div);
    targetBody.scrollTop = targetBody.scrollHeight;
  }

  function clearInteractive(targetBody) {
    targetBody.querySelectorAll(".assistant-btn, .assistant-select").forEach((el) => el.remove());
  }
});
