// public/assistant/dailyDigest.js
console.log("🤖 VSA Daily Digest Assistant active");

import { registerAssistantFeature } from "/assistant/assistantHooks.js";

document.addEventListener("DOMContentLoaded", async () => {
    const saved = storageGet?.();
    if (!saved?.token) return;

    const headers = { Authorization: `Bearer ${saved.token}` };

    /* ==========================================================
       🧭 Register Feature
       ========================================================== */
    registerAssistantFeature("Daily Digest", (chatBody) => {
        startDigest(chatBody);
    });

    /* ==========================================================
       ⚙️ Helper: Safe JSON Fetch
       ========================================================== */
    async function fetchJSONSafe(url) {
        try {
            const res = await fetch(url, { headers });
            if (!res.ok) {
                const txt = await res.text().catch(() => "");
                console.warn(`⚠️ ${url} → HTTP ${res.status}`, txt.slice(0, 200));
                return { ok: false, data: null };
            }
            const ct = res.headers.get("content-type") || "";
            if (!ct.includes("application/json")) {
                const txt = await res.text().catch(() => "");
                console.warn(`⚠️ ${url} returned non-JSON`, txt.slice(0, 200));
                return { ok: false, data: null };
            }
            const json = await res.json();
            return { ok: true, data: json };
        } catch (err) {
            console.error(`❌ fetchJSONSafe(${url})`, err);
            return { ok: false, data: null };
        }
    }

    /* ==========================================================
       ⚙️ UI Helpers
       ========================================================== */
    function addMessage(text, sender, targetBody) {
        const div = document.createElement("div");
        div.className = `assistant-message ${sender}`;
        div.textContent = text;
        targetBody.appendChild(div);
        targetBody.scrollTop = targetBody.scrollHeight;
    }

    function clearInteractive(targetBody) {
        targetBody.querySelectorAll(".assistant-btn, .assistant-select, input.assistant-select")
            .forEach((el) => el.remove());
    }

    function clearChat(targetBody) {
        targetBody.innerHTML = "";
    }

    /* ==========================================================
       📋 Main Digest Flow
       ========================================================== */
    async function startDigest(chatBody) {
        clearChat(chatBody);
        // Add loading line with spinner
        const loadingDiv = document.createElement("div");
        loadingDiv.className = "assistant-message bot";
        loadingDiv.innerHTML = `Fetching your daily summary <span class="vsa-spinner"></span>`;
        chatBody.appendChild(loadingDiv);
        chatBody.scrollTop = chatBody.scrollHeight;


        /* ==========================================================
           1️⃣ Load Current User → resolve their primary store
           ========================================================== */
        let primaryStoreName = null;
        try {
            const meRes = await fetch("/api/me", { headers });
            const meData = await meRes.json();

            const storeId = meData?.user?.primaryStore;

            if (typeof storeId === "string") {
                primaryStoreName = storeId.trim().toLowerCase();
            } else if (typeof storeId === "number") {
                const storeRes = await fetch(`/api/meta/store/${storeId}`);
                const storeData = await storeRes.json();
                if (storeData.ok && storeData.name) {
                    primaryStoreName = storeData.name.trim().toLowerCase();
                }
            }

            console.log("🏪 Primary store resolved:", primaryStoreName);
        } catch (err) {
            console.warn("⚠️ Failed loading /api/me", err);
        }

        /* ==========================================================
   2️⃣ Announcements (Unacknowledged)
   ========================================================== */
        const ann = await fetchJSONSafe("/api/engagement/announcements");

        let announcements = Array.isArray(ann?.data?.announcements)
            ? ann.data.announcements
            : ann?.data?.results || [];

        // Deduplicate by announcement ID
        announcements = [
            ...new Map(
                announcements.map(a => [a.id || a.announcement_id, a])
            ).values()
        ];

        // Filter only unacknowledged
        const unAck = announcements.filter(a => !a.acknowledged && !a.userAck);

        /* ==========================================================
           3️⃣ Surveys (Only incomplete, visible to user)
           ========================================================== */
        const surv = await fetchJSONSafe("/api/engagement/surveys/active-surveys");
        const surveys = Array.isArray(surv?.data?.surveys)
            ? surv.data.surveys
            : [];

        // All returned surveys are incomplete by design
        const unCompleted = surveys;

        /* ==========================================================
           4️⃣ Sales Orders Ready For Delivery
           ========================================================== */
        const ord = await fetchJSONSafe("/api/netsuite/order-management");
        const ordersRaw = Array.isArray(ord?.data)
            ? ord.data
            : ord?.data?.results || [];

        const storeFilteredOrders = primaryStoreName
            ? ordersRaw.filter(
                (o) =>
                    o.Store &&
                    o.Store.trim().toLowerCase() === primaryStoreName.trim().toLowerCase()
            )
            : ordersRaw;

        const readyOrders = storeFilteredOrders.filter(
            (o) => o["Ready For Delivery"] === "Ready for Fulfilment"
        );

        /* ==========================================================
           5️⃣ Purchase Order Management
           ========================================================== */

        // PO data
        const poRes = await fetchJSONSafe("/api/netsuite/purchase-order-management");
        const poRaw = Array.isArray(poRes?.data?.results)
            ? poRes.data.results
            : [];

        // Lead time data
        const ltRes = await fetchJSONSafe("/api/netsuite/supplier-lead-time");
        const leadRaw = Array.isArray(ltRes?.data?.results)
            ? ltRes.data.results
            : [];

        // Map: supplierID → leadTimeDays
        const leadMap = {};
        leadRaw.forEach((s) => {
            if (s["Internal ID"]) {
                leadMap[String(s["Internal ID"]).trim()] = parseInt(s.days || "0", 10);
            }
        });

        // Filter by user's store
        const poFiltered = primaryStoreName
            ? poRaw.filter(
                (p) =>
                    p.Store &&
                    p.Store.trim().toLowerCase() === primaryStoreName.trim().toLowerCase()
            )
            : poRaw;

        const today = new Date();
        const in3Days = new Date(today.getTime() + 3 * 86400000);

        const dueImminently = [];
        const overdue = [];

        poFiltered.forEach((po) => {
            const poDateStr = po["Date"]; // dd/mm/yyyy
            const supplierId = String(po["Supplier Internal ID"] || "").trim();

            if (!poDateStr || !supplierId) return;

            const [dd, mm, yyyy] = poDateStr.split("/");
            const poDate = new Date(`${yyyy}-${mm}-${dd}`);

            const ltDays = leadMap[supplierId] || 0;
            const expected = new Date(poDate.getTime() + ltDays * 86400000);

            if (expected < today) {
                overdue.push({ ...po, expected });
            } else if (expected <= in3Days) {
                dueImminently.push({ ...po, expected });
            }
        });

        /* ==========================================================
           🧾 Render Digest Output
           ========================================================== */
        clearChat(chatBody);
        addMessage("📅 Here’s your Daily Digest:", "bot", chatBody);

        /* Announcements */
        if (ann.ok) {
            if (unAck.length > 0)
                addMessage(`🔔 You have ${unAck.length} announcement(s) to acknowledge.`, "bot", chatBody);
            else addMessage("🔔 All announcements acknowledged.", "bot", chatBody);
        } else {
            addMessage("⚠️ Couldn’t load announcements.", "bot", chatBody);
        }

        /* Surveys */
        if (surv.ok) {
            if (unCompleted.length > 0)
                addMessage(`📝 You have ${unCompleted.length} survey(s) to complete.`, "bot", chatBody);
            else addMessage("📝 All surveys completed.", "bot", chatBody);
        } else {
            addMessage("⚠️ Couldn’t load surveys.", "bot", chatBody);
        }

        /* Orders Ready */
        if (ord.ok) {
            if (readyOrders.length > 0) {
                addMessage(`🚚 ${readyOrders.length} order(s) are ready for delivery.`, "bot", chatBody);
                const btn = document.createElement("button");
                btn.className = "assistant-btn";
                btn.textContent = "Show ready orders";
                btn.onclick = () => showReadyOrders(chatBody, readyOrders);
                chatBody.appendChild(btn);
            } else {
                addMessage("🚚 No orders ready for delivery.", "bot", chatBody);
            }
        }

        /* Purchase Orders Due Imminently */
        if (dueImminently.length > 0) {
            addMessage(`⏳ ${dueImminently.length} purchase order(s) are due imminently.`, "bot", chatBody);
            const btn = document.createElement("button");
            btn.className = "assistant-btn";
            btn.textContent = "Show imminent orders";
            btn.onclick = () => showPOTable(chatBody, dueImminently, "Orders Due Imminently");
            chatBody.appendChild(btn);
        } else {
            addMessage("⏳ No imminent purchase orders.", "bot", chatBody);
        }

        /* Purchase Orders Overdue */
        if (overdue.length > 0) {
            addMessage(`⚠️ ${overdue.length} purchase order(s) need chasing.`, "bot", chatBody);
            const btn = document.createElement("button");
            btn.className = "assistant-btn";
            btn.textContent = "Show overdue orders";
            btn.onclick = () => showPOTable(chatBody, overdue, "Overdue Orders");
            chatBody.appendChild(btn);
        } else {
            addMessage("⚠️ No overdue purchase orders.", "bot", chatBody);
        }
    }

    /* ==========================================================
       📦 Orders Ready For Delivery Table
       ========================================================== */
    function showReadyOrders(chatBody, list) {
        clearInteractive(chatBody);

        addMessage("📦 Orders ready for delivery:", "bot", chatBody);

        const table = document.createElement("table");
        table.className = "assistant-stock-table";

        table.innerHTML = `
      <thead>
        <tr>
          <th>Date</th>
          <th>Customer</th>
          <th>Order #</th>
          <th>Store</th>
        </tr>
      </thead>
      <tbody>
        ${list
                .map((o) => {
                    const link = o["Document Number"]
                        ? `<a href="/sales/view/${o.ID}" target="_blank">${o["Document Number"]}</a>`
                        : "-";
                    return `
              <tr>
                <td>${o.Date || "-"}</td>
                <td>${o.Name || "-"}</td>
                <td>${link}</td>
                <td>${o.Store || "-"}</td>
              </tr>`;
                })
                .join("")}
      </tbody>
    `;

        chatBody.appendChild(table);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    /* ==========================================================
       📋 Purchase Order Table (Imminent + Overdue)
       ========================================================== */
    function showPOTable(chatBody, list, title) {
        clearInteractive(chatBody);

        addMessage(`📄 ${title}:`, "bot", chatBody);

        const table = document.createElement("table");
        table.className = "assistant-stock-table";

        table.innerHTML = `
      <thead>
        <tr>
          <th>PO Date</th>
          <th>Supplier</th>
          <th>PO #</th>
          <th>Sales Order</th>
          <th>Expected</th>
        </tr>
      </thead>
      <tbody>
        ${list
                .map((p) => {
                    const exp = p.expected.toLocaleDateString("en-GB");
                    const link = p["Document Number"]
                        ? `<a href="#" target="_blank">${p["Document Number"]}</a>`
                        : "-";
                    return `
              <tr>
                <td>${p.Date}</td>
                <td>${p.Supplier}</td>
                <td>${link}</td>
                <td>${p["Sales Order"]}</td>
                <td>${exp}</td>
              </tr>`;
                })
                .join("")}
      </tbody>
    `;

        chatBody.appendChild(table);
        chatBody.scrollTop = chatBody.scrollHeight;
    }
});
