(function () {
  const state = {
    documentType: "sale",
    score: 0,
    hoverScore: 0,
    comment: "",
    submitted: false,
    inFlight: null,
  };

  function selectedStore() {
    const select = document.getElementById("store");
    const option = select?.selectedOptions?.[0];
    return {
      storeId: select?.value || "",
      storeName: option?.dataset?.storeName || option?.textContent?.trim() || "",
    };
  }

  function endpointPayload(extra = {}) {
    const store = selectedStore();
    return {
      documentType: state.documentType,
      storeId: store.storeId,
      storeName: store.storeName,
      score: state.score,
      comment: state.score <= 3 ? state.comment : "",
      ...extra,
    };
  }

  async function submitFeedback() {
    if (!state.score || state.submitted) return { ok: false, skipped: true };
    state.submitted = true;

    const saved = typeof storageGet === "function" ? storageGet() : null;
    const headers = {
      "Content-Type": "application/json",
      ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
    };

    state.inFlight = fetch("/api/sales-order-experience/feedback", {
      method: "POST",
      headers,
      body: JSON.stringify(endpointPayload()),
    })
      .then((res) => res.json().catch(() => ({ ok: false })))
      .catch((err) => {
        console.warn("SalesOrder feedback was not submitted:", err.message || err);
        return { ok: false };
      });

    return state.inFlight;
  }

  function renderStars(root) {
    const stars = root.querySelectorAll(".sales-order-rating-star");
    const activeScore = state.hoverScore || state.score;
    stars.forEach((star) => {
      const value = Number(star.dataset.score || 0);
      star.classList.toggle("is-active", value <= activeScore);
      star.classList.toggle("is-selected", state.score > 0 && value <= state.score);
      star.textContent = value <= state.score ? "\u2605" : "\u2606";
    });
  }

  function setMessage(root, message, tone = "neutral") {
    const el = root.querySelector(".sales-order-rating-message");
    if (!el) return;
    el.textContent = message || "";
    el.dataset.tone = tone;
  }

  function renderComment(root) {
    const wrap = root.querySelector(".sales-order-rating-comment-wrap");
    const textarea = root.querySelector(".sales-order-rating-comment");
    if (!wrap || !textarea) return;

    const show = state.score >= 1 && state.score <= 3;
    wrap.classList.toggle("hidden", !show);
    if (show) textarea.value = state.comment;
  }

  function reset(root, documentType) {
    state.documentType = documentType || state.documentType;
    state.score = 0;
    state.hoverScore = 0;
    state.comment = "";
    state.submitted = false;
    state.inFlight = null;
    root.classList.remove("hidden");
    renderStars(root);
    renderComment(root);
    setMessage(root, "");
  }

  function ensureWidget() {
    const spinner = document.getElementById("orderSpinner");
    if (!spinner) return null;

    let root = document.getElementById("salesOrderExperienceRating");
    if (root) return root;

    root = document.createElement("div");
    root.id = "salesOrderExperienceRating";
    root.className = "sales-order-rating hidden";
    root.innerHTML = `
      <div class="sales-order-rating-title">Rate SalesOrder Experience</div>
      <div class="sales-order-rating-stars" role="radiogroup" aria-label="Rate SalesOrder Experience">
        ${[1, 2, 3, 4, 5]
          .map(
            (score) =>
              `<button type="button" class="sales-order-rating-star" data-score="${score}" aria-label="${score} stars">&#9734;</button>`
          )
          .join("")}
      </div>
      <div class="sales-order-rating-message" aria-live="polite"></div>
      <div class="sales-order-rating-comment-wrap hidden">
        <textarea class="sales-order-rating-comment" rows="3" placeholder="What could can we do to make this process better for you"></textarea>
      </div>
    `;
    spinner.appendChild(root);

    root.querySelectorAll(".sales-order-rating-star").forEach((star) => {
      star.addEventListener("mouseenter", () => {
        state.hoverScore = Number(star.dataset.score || 0);
        renderStars(root);
      });
      star.addEventListener("mouseleave", () => {
        state.hoverScore = 0;
        renderStars(root);
      });
      star.addEventListener("click", () => {
        state.score = Number(star.dataset.score || 0);
        state.submitted = false;
        renderStars(root);
        renderComment(root);

        if (state.score >= 4) {
          setMessage(root, "Thanks for your feedback!", "success");
          submitFeedback();
        } else {
          setMessage(root, "");
          root.querySelector(".sales-order-rating-comment")?.focus();
        }
      });
    });

    const comment = root.querySelector(".sales-order-rating-comment");
    comment?.addEventListener("input", () => {
      state.comment = comment.value;
    });
    comment?.addEventListener("change", () => {
      state.comment = comment.value;
      submitFeedback();
    });
    comment?.addEventListener("blur", () => {
      state.comment = comment.value;
      submitFeedback();
    });

    return root;
  }

  window.SalesOrderExperienceFeedback = {
    show(documentType) {
      const root = ensureWidget();
      if (!root) return;
      reset(root, documentType);
    },
    hide() {
      document.getElementById("salesOrderExperienceRating")?.classList.add("hidden");
    },
    async flush(extra = {}) {
      if (extra.documentType) state.documentType = extra.documentType;
      if (state.score && !state.submitted) return submitFeedback();
      if (state.inFlight) return state.inFlight;
      return { ok: true, skipped: true };
    },
  };
})();
