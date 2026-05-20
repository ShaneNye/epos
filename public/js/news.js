(function () {
  const state = {
    attachments: [],
    canPost: false,
    posts: [],
  };

  const NEWS_PAGE_OPTIONS = [
    { value: "", label: "General" },
    { value: "home", label: "Home" },
    { value: "sales/new", label: "New Sales Order" },
    { value: "sales/kiosk", label: "Sales Kiosk" },
    { value: "quote/new", label: "New Quote" },
    { value: "orders", label: "Order Management" },
    { value: "reports", label: "Reports" },
    { value: "promotions", label: "Promotions" },
    { value: "eod", label: "End Of Day" },
    { value: "cashflow", label: "Cashflow" },
    { value: "engagement", label: "Engagement" },
    { value: "logistics", label: "Logistics" },
    { value: "suitepim", label: "SuitePim" },
    { value: "systems-processes", label: "Systems & Processes" },
    { value: "admin", label: "Admin" },
  ];

  function getToken() {
    return storageGet()?.token || null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function attachmentIcon(type) {
    if (type === "video") return "Video";
    if (type === "web") return "Link";
    return "Doc";
  }

  function getPageLabel(value) {
    return NEWS_PAGE_OPTIONS.find((option) => option.value === value)?.label || "";
  }

  function populatePageSelects() {
    const composer = document.getElementById("newsPageSelect");
    const filter = document.getElementById("newsPageFilter");
    const optionsHtml = NEWS_PAGE_OPTIONS.map(
      (option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
    ).join("");

    if (composer) composer.innerHTML = optionsHtml;
    if (filter) {
      filter.innerHTML = `<option value="">All pages</option>${NEWS_PAGE_OPTIONS.filter((option) => option.value)
        .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
        .join("")}`;
    }
  }

  function googleDrivePreviewUrl(url) {
    try {
      const parsed = new URL(url);
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      const openId = parsed.searchParams.get("id");
      const id = fileMatch?.[1] || openId;

      if (id && /(^|\.)google\.com$/i.test(parsed.hostname.replace(/^www\./, ""))) {
        const previewUrl = new URL(`https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`);
        const resourceKey = parsed.searchParams.get("resourcekey");
        if (resourceKey) previewUrl.searchParams.set("resourcekey", resourceKey);
        return previewUrl.href;
      }

      if (/youtube\.com$|youtu\.be$/i.test(parsed.hostname)) {
        const youtubeId =
          parsed.hostname.includes("youtu.be")
            ? parsed.pathname.slice(1)
            : parsed.searchParams.get("v");
        if (youtubeId) return `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&mute=1`;
      }
    } catch {
      return null;
    }
    return null;
  }

  function renderDraftAttachments() {
    const list = document.getElementById("attachmentDraftList");
    if (!list) return;

    list.innerHTML = state.attachments
      .map(
        (item, index) => `
          <span class="attachment-chip">
            ${attachmentIcon(item.type)}
            ${escapeHtml(item.label)}
            <button type="button" data-remove-attachment="${index}" aria-label="Remove ${escapeHtml(item.label)}">&times;</button>
          </span>
        `
      )
      .join("");

    list.querySelectorAll("[data-remove-attachment]").forEach((button) => {
      button.addEventListener("click", () => {
        state.attachments.splice(Number(button.dataset.removeAttachment), 1);
        renderDraftAttachments();
      });
    });
  }

  function renderPostAttachments(attachments) {
    const items = Array.isArray(attachments) ? attachments : [];
    const videos = items.filter((item) => item.type === "video");
    const links = items.filter((item) => item.type !== "video");

    const videoHtml = videos
      .map((item) => {
        const previewUrl = googleDrivePreviewUrl(item.url) || item.url;
        return `
          <div class="news-video-wrap">
            <div class="news-video-frame">
              <iframe src="${escapeHtml(previewUrl)}" allow="autoplay; fullscreen" allowfullscreen title="${escapeHtml(item.label)}"></iframe>
            </div>
            <a class="news-video-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Open video in new tab</a>
          </div>
        `;
      })
      .join("");

    const tagHtml = links.length
      ? `
        <div class="news-attachment-tags">
          ${links
            .map(
              (item) => `
                <a class="news-attachment-tag" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                  ${attachmentIcon(item.type)} ${escapeHtml(item.label)}
                </a>
              `
            )
            .join("")}
        </div>
      `
      : "";

    return `${videoHtml}${tagHtml}`;
  }

  function renderPostMeta(post) {
    const tags = Array.isArray(post.tags) ? post.tags.filter(Boolean) : [];
    const pageLabel = post.page_label || getPageLabel(post.page_key);

    if (!pageLabel && !tags.length) return "";

    return `
      <div class="news-post-taxonomy">
        ${pageLabel ? `<span class="news-page-pill">${escapeHtml(pageLabel)}</span>` : ""}
        ${tags.map((tag) => `<span class="news-tag">#${escapeHtml(tag)}</span>`).join("")}
      </div>
    `;
  }

  function postMatchesFilters(post) {
    const search = document.getElementById("newsSearchInput")?.value.trim().toLowerCase() || "";
    const page = document.getElementById("newsPageFilter")?.value || "";

    if (page && post.page_key !== page) return false;
    if (!search) return true;

    const haystack = [
      post.title,
      post.body,
      post.created_by_name,
      post.page_label,
      post.page_key,
      ...(Array.isArray(post.tags) ? post.tags : []),
      ...(Array.isArray(post.attachments) ? post.attachments.map((item) => `${item.label} ${item.url}`) : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  }

  function renderPosts() {
    const feed = document.getElementById("newsFeed");
    if (!feed) return;

    const posts = state.posts.filter(postMatchesFilters);

    if (!state.posts.length) {
      feed.innerHTML = `<div class="news-empty">No news posts yet.</div>`;
      return;
    }

    if (!posts.length) {
      feed.innerHTML = `<div class="news-empty">No posts match your search.</div>`;
      return;
    }

    feed.innerHTML = posts
      .map(
        (post) => `
          <article class="news-post">
            <header class="news-post-header">
              <div>
                <h2>${escapeHtml(post.title)}</h2>
                <div class="news-post-meta">Posted by ${escapeHtml(post.created_by_name)} &middot; ${escapeHtml(formatDate(post.created_at))}</div>
              </div>
            </header>
            ${renderPostMeta(post)}
            <div class="news-post-body">${escapeHtml(post.body)}</div>
            ${renderPostAttachments(post.attachments)}
          </article>
        `
      )
      .join("");
  }

  async function loadPermissions() {
    const res = await fetch("/api/news/permissions");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to check permissions");

    state.canPost = Boolean(data.canPost);
    document.getElementById("newsComposer")?.classList.toggle("hidden", !state.canPost);
    document.getElementById("newsNoPostAccess")?.classList.toggle("hidden", state.canPost);
  }

  async function loadPosts() {
    const feed = document.getElementById("newsFeed");
    if (!feed) return;

    feed.innerHTML = `<div class="news-empty">Loading news...</div>`;

    try {
      const res = await fetch("/api/news/posts");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load news posts");

      state.posts = data.posts || [];
      renderPosts();
    } catch (err) {
      console.error("Failed to load news:", err);
      feed.innerHTML = `<div class="news-empty">Unable to load news right now.</div>`;
    }
  }

  function addAttachment() {
    const type = document.getElementById("attachmentType")?.value || "document";
    const labelInput = document.getElementById("attachmentLabel");
    const urlInput = document.getElementById("attachmentUrl");
    const label = labelInput?.value.trim() || "";
    const url = urlInput?.value.trim() || "";

    if (!url) {
      urlInput?.focus();
      return;
    }

    try {
      const parsed = new URL(url);
      state.attachments.push({
        type,
        label: label || parsed.hostname.replace(/^www\./, ""),
        url: parsed.href,
      });
      if (labelInput) labelInput.value = "";
      if (urlInput) urlInput.value = "";
      renderDraftAttachments();
    } catch {
      alert("Please enter a valid link.");
    }
  }

  async function submitPost(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById("newsFormStatus");
    const submit = form.querySelector("button[type='submit']");

    if (status) status.textContent = "Posting...";
    if (submit) submit.disabled = true;

    try {
      const res = await fetch("/api/news/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.getElementById("newsTitle")?.value,
          body: document.getElementById("newsBody")?.value,
          pageKey: document.getElementById("newsPageSelect")?.value,
          pageLabel: document.getElementById("newsPageSelect")?.selectedOptions?.[0]?.textContent,
          tags: document.getElementById("newsTags")?.value,
          attachments: state.attachments,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to post");

      form.reset();
      state.attachments = [];
      renderDraftAttachments();
      if (status) status.textContent = `Posted ${formatDate(data.post.created_at)}`;
      await loadPosts();
    } catch (err) {
      console.error("Failed to create news post:", err);
      if (status) status.textContent = err.message || "Unable to post";
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!getToken()) return;

    populatePageSelects();

    const timestamp = document.getElementById("composerTimestamp");
    if (timestamp) timestamp.textContent = `Current time: ${formatDate(new Date().toISOString())}`;

    document.getElementById("addAttachmentBtn")?.addEventListener("click", addAttachment);
    document.getElementById("newsPostForm")?.addEventListener("submit", submitPost);
    document.getElementById("refreshNewsBtn")?.addEventListener("click", loadPosts);
    document.getElementById("newsSearchInput")?.addEventListener("input", renderPosts);
    document.getElementById("newsPageFilter")?.addEventListener("change", renderPosts);
    document.getElementById("clearNewsFiltersBtn")?.addEventListener("click", () => {
      const search = document.getElementById("newsSearchInput");
      const page = document.getElementById("newsPageFilter");
      if (search) search.value = "";
      if (page) page.value = "";
      renderPosts();
    });

    try {
      await loadPermissions();
    } catch (err) {
      console.error("Failed to load news permissions:", err);
    }
    await loadPosts();
  });
})();
