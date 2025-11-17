// public/assistant/stockSearch.js
console.log("🤖 VSA Stock Search Assistant active");

// ✅ Use the shared assistant hook system
import { registerAssistantFeature } from "/assistant/assistantHooks.js";

document.addEventListener("DOMContentLoaded", async () => {
  const saved = storageGet?.();
  if (!saved?.token) return;

  const headers = { Authorization: `Bearer ${saved.token}` };

  /* ==========================================================
     🧭 Register Assistant Feature
     ========================================================== */
  registerAssistantFeature("Stock", (chatBody) => {
    startStockFlow(chatBody);
  });

  /* ==========================================================
     💬 Chat Flow
     ========================================================== */

  function startStockFlow(chatBody) {
    clearChat(chatBody);
    addMessage("Would you like to check current stock?", "bot", chatBody);
    askForItem(chatBody);
  }

  // Step 1️⃣ — Ask for item and live filter as user types
  function askForItem(chatBody) {
    clearInteractive(chatBody);
    addMessage("Type the product name or SKU to search:", "bot", chatBody);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Start typing...";
    input.className = "assistant-select";
    chatBody.appendChild(input);

    const resultsDiv = document.createElement("div");
    resultsDiv.style.maxHeight = "140px";
    resultsDiv.style.overflowY = "auto";
    resultsDiv.style.marginTop = "6px";
    chatBody.appendChild(resultsDiv);

    let mergedData = [];

    fetchInventoryData().then((data) => (mergedData = data));

    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      resultsDiv.innerHTML = "";
      if (!query) return;

      // ✅ Filter for matches that have available stock > 0
      const matches = mergedData.filter(
        (r) =>
          r.itemName.toLowerCase().includes(query) &&
          Number(r.available) > 0
      );

      const uniqueNames = [...new Set(matches.map((r) => r.itemName))].slice(
        0,
        10
      );

      resultsDiv.innerHTML = "";

      // ✅ No matches → show message
      if (uniqueNames.length === 0) {
        const noRes = document.createElement("div");
        noRes.className = "assistant-message bot";
        noRes.style.marginTop = "6px";
        noRes.textContent = "No stock available for that item.";
        resultsDiv.appendChild(noRes);
        return;
      }

      // ✅ Otherwise list the matching items
      uniqueNames.forEach((name) => {
        const opt = document.createElement("div");
        opt.textContent = name;
        opt.className = "assistant-btn";
        opt.style.display = "block";
        opt.onclick = () => askForLocation(chatBody, name, mergedData);
        resultsDiv.appendChild(opt);
      });
    });
  }

  // Step 2️⃣ — Show available locations for that product
  function askForLocation(chatBody, itemName, mergedData) {
    clearInteractive(chatBody);
    addMessage(
      `Where would you like to check stock for "${itemName}"?`,
      "bot",
      chatBody
    );

    const locations = [
      ...new Set(
        mergedData
          .filter((r) => r.itemName === itemName && Number(r.available) > 0)
          .map((r) => r.location)
      ),
    ].sort();

    if (!locations.length) {
      addMessage("No available stock found for this product.", "bot", chatBody);
      return;
    }

    locations.forEach((loc) => {
      const btn = document.createElement("button");
      btn.className = "assistant-btn";
      btn.textContent = loc;
      btn.onclick = () => askForCondition(chatBody, itemName, loc, mergedData);
      chatBody.appendChild(btn);
    });
  }

  // Step 3️⃣ — Ask for condition (status)
  function askForCondition(chatBody, itemName, location, mergedData) {
    clearInteractive(chatBody);
    addMessage(
      `Are you looking for a specific condition of "${itemName}" at ${location}?`,
      "bot",
      chatBody
    );

    const statuses = [
      ...new Set(
        mergedData
          .filter(
            (r) =>
              r.itemName === itemName &&
              r.location === location &&
              Number(r.available) > 0
          )
          .map((r) => r.status)
      ),
    ].sort();

    if (!statuses.length) {
      showResults(chatBody, itemName, location, null, mergedData);
      return;
    }

    statuses.forEach((status) => {
      const btn = document.createElement("button");
      btn.className = "assistant-btn";
      btn.textContent = status;
      btn.onclick = () =>
        showResults(chatBody, itemName, location, status, mergedData);
      chatBody.appendChild(btn);
    });

    const anyBtn = document.createElement("button");
    anyBtn.className = "assistant-btn";
    anyBtn.textContent = "Any";
    anyBtn.onclick = () =>
      showResults(chatBody, itemName, location, null, mergedData);
    chatBody.appendChild(anyBtn);
  }

  // Step 4️⃣ — Display results as table
  function showResults(chatBody, itemName, location, status, mergedData) {
    clearInteractive(chatBody);
    addMessage(
      `Here’s what we found for "${itemName}" at ${location}${
        status ? " (" + status + ")" : ""
      }:`,
      "bot",
      chatBody
    );

    const filtered = mergedData.filter(
      (r) =>
        r.itemName === itemName &&
        r.location === location &&
        (!status || r.status === status) &&
        Number(r.available) > 0
    );

    if (!filtered.length) {
      addMessage("No stock found for your selection.", "bot", chatBody);
      return;
    }

    const table = document.createElement("table");
    table.className = "assistant-stock-table";
    table.innerHTML = `
      <thead>
        <tr><th>Lot / Serial</th><th>Bin</th><th>Available</th></tr>
      </thead>
      <tbody>
        ${filtered
          .map(
            (r) => `
          <tr>
            <td>${r.inventoryNumber}</td>
            <td>${r.bin}</td>
            <td style="text-align:right;">${r.available}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    `;
    chatBody.appendChild(table);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  /* ==========================================================
     📦 Fetch + Merge Inventory (updated to match main stock search)
     ========================================================== */

  function clean(str) {
    return (str || "").trim().toLowerCase();
  }

  function idStr(val) {
    return val == null ? "" : String(val).trim();
  }

  async function fetchInventoryData() {
    try {
      const [balanceRes, numbersRes] = await Promise.all([
        fetch("/api/netsuite/inventorybalance").then((r) => r.json()),
        fetch("/api/netsuite/invoice-numbers").then((r) => r.json()),
      ]);

      if (!balanceRes.ok || !numbersRes.ok) throw new Error("Fetch failed");

      const balance = balanceRes.results || balanceRes.data || [];
      const numbers = numbersRes.results || numbersRes.data || [];

      console.log(
        `🤖 VSA merge: ${balance.length} balance rows, ${numbers.length} number rows`
      );

      // 1️⃣ Aggregate invoice-number quantities per (itemId + number + location)
      const numberAgg = {};

      for (const row of numbers) {
        const itemId = idStr(row["Item Id"] || row["Item ID"] || row["itemid"]);
        const inv = clean(row["Number"]);
        const loc = clean(row["Location"]);
        if (!inv || !loc) continue;

        const key = `${itemId}||${inv}||${loc}`;

        if (!numberAgg[key]) {
          numberAgg[key] = {
            available: 0,
            onHand: 0,
            itemId,
            itemName: row["Item"] || "",
            invNumberId: row["inv number id"] || "",
          };
        }

        numberAgg[key].available += parseInt(row["Available"] || 0, 10) || 0;
        numberAgg[key].onHand += parseInt(row["On Hand"] || 0, 10) || 0;
      }

      // 2️⃣ Collapse duplicate balance rows (1 per item + inventory number + location)
      const collapsed = {};

      for (const b of balance) {
        const itemId = idStr(
          b["Item ID"] || b["Item Id"] || b["itemid"] || b["Item"]
        );
        const inv = clean(b["Inventory Number"]);
        const loc = clean(b["Location"]);
        const key = `${itemId}||${inv}||${loc}`;

        if (!collapsed[key]) {
          collapsed[key] = b;
        }
      }

      const balanceFinal = Object.values(collapsed);

      // 3️⃣ Merge: status/bin from balance, qty from aggregated numbers
      const merged = balanceFinal.map((b) => {
        const itemId = idStr(
          b["Item ID"] || b["Item Id"] || b["itemid"] || b["Item"]
        );
        const inv = clean(b["Inventory Number"]);
        const loc = clean(b["Location"]);
        const rawLoc = b["Location"] || "-";

        const key = `${itemId}||${inv}||${loc}`;
        const agg = numberAgg[key] || {
          available: 0,
          onHand: 0,
          itemId,
          itemName: "",
          invNumberId: "",
        };

        return {
          itemId: agg.itemId || itemId,
          itemName: agg.itemName || b["Name"] || b["Item"] || "-",
          location: rawLoc,
          bin: b["Bin Number"] || "-",
          status: b["Status"] || "-",
          inventoryNumber: b["Inventory Number"] || "-",
          available: agg.available,
          onHand: agg.onHand,
        };
      });

      // 4️⃣ Only keep rows where available > 0
      const filtered = merged.filter(
        (r) => (parseInt(r.available, 10) || 0) > 0
      );

      console.log(`🤖 VSA merged stock rows (available > 0): ${filtered.length}`);
      return filtered;
    } catch (err) {
      console.error("❌ Stock fetch error:", err);
      return [];
    }
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
    targetBody
      .querySelectorAll(
        ".assistant-btn, .assistant-select, input.assistant-select"
      )
      .forEach((el) => el.remove());
  }

  function clearChat(targetBody) {
    targetBody.innerHTML = "";
  }
});
