// public/assistant/salesView.js
console.log("🤖 VSA Sales View Mode active");

document.addEventListener("DOMContentLoaded", async () => {
  const saved = storageGet?.();
  if (!saved || !saved.token) return;

  const headers = { Authorization: `Bearer ${saved.token}` };
  const path = window.location.pathname;
  if (!path.includes("/sales/view")) return; // Only run on Sales View pages

  /* ---------- Extract Sales Order ID ---------- */
  const parts = path.split("/");
  const tranId = parts.pop() || parts.pop();
  if (!tranId) return console.warn("⚠️ No transaction ID found in URL");

  /* ---------- Preload VSA item dataset ---------- */
  let itemDataCache = [];
  try {
    const res = await fetch("/api/netsuite/vsa-item-data", { headers });
    const data = await res.json();
    itemDataCache = data.results || data.data || [];
    console.log(`📦 Cached ${itemDataCache.length} VSA item records`);
  } catch (err) {
    console.error("❌ Error fetching VSA item data:", err);
  }

  /* ---------- Wait for assistant to be injected ---------- */
  function waitForAssistantReady(cb) {
    const check = setInterval(() => {
      const toggle = document.getElementById("assistantToggle");
      const body = document.getElementById("assistantBody");
      if (toggle && body) {
        clearInterval(check);
        cb(toggle, body);
      }
    }, 200);
  }

  waitForAssistantReady((toggle, body) => {
    console.log("✅ VSA found assistant toggle — attaching listener");

    toggle.addEventListener("click", () => {
      setTimeout(() => startSalesViewFlow(body), 300); // small delay for animation
    });

    /* ==========================================================
       🧭 Chat Flow Functions
       ========================================================== */

    function startSalesViewFlow(chatBody) {
      chatBody.innerHTML = ""; // clear chat window
      addMessage("I can help with ...", "bot", chatBody);

      const btn = document.createElement("button");
      btn.textContent = "Items";
      btn.className = "assistant-btn";
      btn.onclick = () => showItemsList(chatBody);
      chatBody.appendChild(btn);
    }

    function showItemsList(chatBody) {
      clearInteractiveElements(chatBody);
      addMessage("What item do you need help with?", "bot", chatBody);

      // ✅ Collect items from order table
      const rows = document.querySelectorAll("#orderItemsBody tr");
      const itemsOnOrder = [];

      rows.forEach((row) => {
        const name = (row.querySelector("td")?.textContent || "").trim();
        if (!name || name.toLowerCase().includes("service")) return;
        itemsOnOrder.push(name);
      });

      console.log("🧾 Items found on this order:", itemsOnOrder);

      if (!itemsOnOrder.length) {
        addMessage("I couldn’t find any valid items on this sales order.", "bot", chatBody);
        return;
      }

      addMessage("Which item do you need help with?", "bot", chatBody);

      itemsOnOrder.forEach((name) => {
        const btn = document.createElement("button");
        btn.textContent = name;
        btn.className = "assistant-btn";
        btn.onclick = () => showFieldOptions(name, chatBody);
        chatBody.appendChild(btn);
      });
    }

    function showFieldOptions(itemName, chatBody) {
      clearInteractiveElements(chatBody);
      addMessage(`What do you want to know about "${itemName}"?`, "bot", chatBody);

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

    /* ---------- Helpers ---------- */
    function addMessage(text, sender, targetBody) {
      const div = document.createElement("div");
      div.className = `assistant-message ${sender}`;
      div.textContent = text;
      targetBody.appendChild(div);
      targetBody.scrollTop = targetBody.scrollHeight;
    }

    function clearInteractiveElements(targetBody) {
      targetBody.querySelectorAll(".assistant-btn, .assistant-select").forEach((el) => el.remove());
    }
  });
});
