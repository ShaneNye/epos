(function () {
  const state = {
    attachments: [],
    canPost: false,
    composerStep: "body",
    editingPostId: null,
    hasScrolledOnLoad: false,
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

  const NEWS_DEPARTMENT_OPTIONS = [
    { value: "", label: "General" },
    { value: "sales", label: "Sales" },
    { value: "product-development", label: "Product Development" },
    { value: "it", label: "IT" },
    { value: "hr", label: "HR" },
    { value: "operations", label: "Operations" },
    { value: "finance", label: "Finance" },
    { value: "leadership", label: "Leadership" },
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

  function initialsForName(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "U";
  }

  function normalizeProfileImageUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";

    try {
      const parsed = new URL(value);
      const host = parsed.hostname.replace(/^www\./, "");
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      const openId = parsed.searchParams.get("id");
      const id = fileMatch?.[1] || openId;

      if (id && /(^|\.)google\.com$/i.test(host)) {
        const thumbnailUrl = new URL("https://drive.google.com/thumbnail");
        thumbnailUrl.searchParams.set("id", id);
        thumbnailUrl.searchParams.set("sz", "w160");
        const resourceKey = parsed.searchParams.get("resourcekey");
        if (resourceKey) thumbnailUrl.searchParams.set("resourcekey", resourceKey);
        return thumbnailUrl.href;
      }
    } catch {
      return value;
    }

    return value;
  }

  function renderAvatar(post) {
    const name = post.created_by_name || "Unknown user";
    const initials = initialsForName(name);
    const image = normalizeProfileImageUrl(post.created_by_profile_image);

    if (image) {
      return `
        <span class="news-post-avatar">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" onerror="this.parentElement.classList.add('image-failed'); this.remove();">
          <span class="news-avatar-initials">${escapeHtml(initials)}</span>
        </span>
      `;
    }

    return `<span class="news-post-avatar" aria-hidden="true"><span class="news-avatar-initials">${escapeHtml(initials)}</span></span>`;
  }

  function attachmentIcon(type) {
    if (type === "video") return "Video";
    if (type === "image") return "Image";
    if (type === "web") return "Link";
    return "Doc";
  }

  function googleDriveImageUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      const openId = parsed.searchParams.get("id");
      const id = fileMatch?.[1] || openId;

      if (id && /(^|\.)google\.com$/i.test(host)) {
        const thumbnailUrl = new URL("https://drive.google.com/thumbnail");
        thumbnailUrl.searchParams.set("id", id);
        thumbnailUrl.searchParams.set("sz", "w1200");
        const resourceKey = parsed.searchParams.get("resourcekey");
        if (resourceKey) thumbnailUrl.searchParams.set("resourcekey", resourceKey);
        return thumbnailUrl.href;
      }
    } catch {
      return url;
    }

    return url;
  }

  function getPageLabel(value) {
    return NEWS_PAGE_OPTIONS.find((option) => option.value === value)?.label || "";
  }

  function getDepartmentLabel(value) {
    return NEWS_DEPARTMENT_OPTIONS.find((option) => option.value === value)?.label || "";
  }

  function buildOptions(options, includeAllLabel) {
    const optionItems = includeAllLabel ? [{ value: "", label: includeAllLabel }, ...options.filter((option) => option.value)] : options;
    return optionItems
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join("");
  }

  function populateMetaSelects() {
    const composer = document.getElementById("newsPageSelect");
    const filter = document.getElementById("newsPageFilter");
    const departmentComposer = document.getElementById("newsDepartmentSelect");
    const departmentFilter = document.getElementById("newsDepartmentFilter");

    if (composer) composer.innerHTML = buildOptions(NEWS_PAGE_OPTIONS);
    if (filter) filter.innerHTML = buildOptions(NEWS_PAGE_OPTIONS, "All pages");
    if (departmentComposer) departmentComposer.innerHTML = buildOptions(NEWS_DEPARTMENT_OPTIONS);
    if (departmentFilter) departmentFilter.innerHTML = buildOptions(NEWS_DEPARTMENT_OPTIONS, "All departments");
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
          <span class="attachment-chip attachment-chip-${escapeHtml(item.type)}">
            <span class="attachment-type">${attachmentIcon(item.type)}</span>
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
    const images = items.filter((item) => item.type === "image");
    const links = items.filter((item) => item.type !== "video" && item.type !== "image");

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

    const imageHtml = images.length
      ? `
        <div class="news-image-grid">
          ${images
            .map(
              (item) => `
                <a class="news-image-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                  <img src="${escapeHtml(googleDriveImageUrl(item.url))}" alt="${escapeHtml(item.label)}" loading="lazy">
                  <span>${escapeHtml(item.label)}</span>
                </a>
              `
            )
            .join("")}
        </div>
      `
      : "";

    const tagHtml = links.length
      ? `
        <div class="news-attachment-tags">
          ${links
            .map(
              (item) => `
                <a class="news-attachment-tag news-attachment-${escapeHtml(item.type)}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                  <span class="attachment-type">${attachmentIcon(item.type)}</span>
                  <span>${escapeHtml(item.label)}</span>
                </a>
              `
            )
            .join("")}
        </div>
      `
      : "";

    return `${videoHtml}${imageHtml}${tagHtml}`;
  }

  function renderPostMeta(post) {
    const tags = Array.isArray(post.tags) ? post.tags.filter(Boolean) : [];
    const pageLabel = post.page_label || getPageLabel(post.page_key);
    const departmentLabel = post.department_label || getDepartmentLabel(post.department_key);

    if (!departmentLabel && !pageLabel && !tags.length) return "";

    return `
      <div class="news-post-taxonomy">
        ${departmentLabel ? `<span class="news-department-pill">${escapeHtml(departmentLabel)}</span>` : ""}
        ${pageLabel ? `<span class="news-page-pill">${escapeHtml(pageLabel)}</span>` : ""}
        ${tags.map((tag) => `<span class="news-tag">#${escapeHtml(tag)}</span>`).join("")}
      </div>
    `;
  }

  function renderPostReactions(post) {
    const likeActive = post.my_reaction === "like" ? " is-active" : "";
    const dislikeActive = post.my_reaction === "dislike" ? " is-active" : "";

    return `
      <div class="news-post-reactions" aria-label="Post reactions">
        <button type="button" class="news-reaction-btn${likeActive}" data-news-reaction="like" data-post-id="${post.id}" aria-pressed="${post.my_reaction === "like"}" title="Like">
          <span aria-hidden="true">&#128077;</span>
          <span data-like-count="${post.id}">${Number(post.like_count || 0)}</span>
        </button>
        <button type="button" class="news-reaction-btn${dislikeActive}" data-news-reaction="dislike" data-post-id="${post.id}" aria-pressed="${post.my_reaction === "dislike"}" title="Dislike">
          <span aria-hidden="true">&#128078;</span>
          <span data-dislike-count="${post.id}">${Number(post.dislike_count || 0)}</span>
        </button>
      </div>
    `;
  }

  function postMatchesFilters(post) {
    const search = document.getElementById("newsSearchInput")?.value.trim().toLowerCase() || "";
    const page = document.getElementById("newsPageFilter")?.value || "";
    const department = document.getElementById("newsDepartmentFilter")?.value || "";
    const dateFrom = document.getElementById("newsDateFromFilter")?.value || "";
    const dateTo = document.getElementById("newsDateToFilter")?.value || "";

    if (page && post.page_key !== page) return false;
    if (department && post.department_key !== department) return false;

    if (dateFrom || dateTo) {
      const created = new Date(post.created_at);
      if (Number.isNaN(created.getTime())) return false;

      if (dateFrom) {
        const start = new Date(`${dateFrom}T00:00:00`);
        if (created < start) return false;
      }

      if (dateTo) {
        const end = new Date(`${dateTo}T23:59:59.999`);
        if (created > end) return false;
      }
    }

    if (!search) return true;

    const haystack = [
      post.title,
      post.body,
      post.created_by_name,
      post.department_label,
      post.department_key,
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
              ${renderAvatar(post)}
              <div class="news-post-heading">
                <h2>${escapeHtml(post.title)}</h2>
                <div class="news-post-meta">Posted by ${escapeHtml(post.created_by_name)} &middot; ${escapeHtml(formatDate(post.created_at))}</div>
              </div>
              ${renderPostActions(post)}
            </header>
            <div class="news-post-body">${escapeHtml(post.body)}</div>
            ${renderPostAttachments(post.attachments)}
            ${renderPostMeta(post)}
            ${renderPostReactions(post)}
          </article>
        `
      )
      .join("");

    bindPostActionMenus();
  }

  function updateComposerViewportSpace() {
    const composer = document.getElementById("newsComposer");
    const page = document.querySelector(".news-page");
    if (!composer || !page) return;

    if (composer.classList.contains("hidden")) {
      page.style.setProperty("--news-composer-space", "28px");
      return;
    }

    const height = composer.offsetHeight || 0;
    page.style.setProperty("--news-composer-space", `${height + 8}px`);
  }

  function scrollToNewsBottomOnce() {
    if (state.hasScrolledOnLoad) return;
    state.hasScrolledOnLoad = true;

    const scrollToBottom = () => {
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      window.scrollTo({ top: height, behavior: "auto" });
    };

    requestAnimationFrame(() => {
      updateComposerViewportSpace();
      requestAnimationFrame(() => {
        scrollToBottom();
        window.setTimeout(scrollToBottom, 150);
        window.setTimeout(scrollToBottom, 500);
      });
    });
  }

  function renderPostActions(post) {
    return `
      <div class="news-post-actions">
        <button type="button" class="news-post-menu-btn" data-news-menu="${post.id}" aria-expanded="false" aria-label="Post actions">
          <span aria-hidden="true">...</span>
        </button>
        <div class="news-post-menu hidden" data-news-menu-panel="${post.id}">
          <button type="button" data-news-analytics="${post.id}">Analytics</button>
          ${post.can_manage ? `<button type="button" data-news-edit="${post.id}">Edit</button>` : ""}
          ${post.can_manage ? `<button type="button" class="danger" data-news-delete="${post.id}">Delete</button>` : ""}
        </div>
      </div>
    `;
  }

  function bindPostActionMenus() {
    document.querySelectorAll("[data-news-menu]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const id = button.dataset.newsMenu;
        const panel = document.querySelector(`[data-news-menu-panel="${id}"]`);
        const isOpening = panel?.classList.contains("hidden");

        closePostMenus();
        if (panel && isOpening) {
          panel.classList.remove("hidden");
          button.setAttribute("aria-expanded", "true");
        }
      });
    });

    document.querySelectorAll("[data-news-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        closePostMenus();
        startEditPost(Number(button.dataset.newsEdit));
      });
    });

    document.querySelectorAll("[data-news-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        closePostMenus();
        deletePost(Number(button.dataset.newsDelete));
      });
    });

    document.querySelectorAll("[data-news-analytics]").forEach((button) => {
      button.addEventListener("click", () => {
        closePostMenus();
        openAnalytics(Number(button.dataset.newsAnalytics));
      });
    });

    document.querySelectorAll("[data-news-reaction]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleReaction(Number(button.dataset.postId), button.dataset.newsReaction);
      });
    });
  }

  function closePostMenus() {
    document.querySelectorAll(".news-post-menu").forEach((panel) => panel.classList.add("hidden"));
    document.querySelectorAll("[data-news-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  async function loadPermissions() {
    const res = await fetch("/api/news/permissions");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to check permissions");

    state.canPost = Boolean(data.canPost);
    document.getElementById("newsComposer")?.classList.toggle("hidden", !state.canPost);
    document.getElementById("newsNoPostAccess")?.classList.toggle("hidden", state.canPost);
    restoreComposerState();
    updateComposerViewportSpace();
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
      updateComposerViewportSpace();
      scrollToNewsBottomOnce();
      await markNewsSeen();
    } catch (err) {
      console.error("Failed to load news:", err);
      feed.innerHTML = `<div class="news-empty">Unable to load news right now.</div>`;
    }
  }

  async function markNewsSeen() {
    try {
      const res = await fetch("/api/news/seen", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to mark news as seen");

      if (typeof window.refreshNewsNotification === "function") {
        await window.refreshNewsNotification();
      }
    } catch (err) {
      console.warn("Failed to mark news as seen:", err.message || err);
    }
  }

  async function toggleReaction(postId, reaction) {
    const post = state.posts.find((item) => Number(item.id) === Number(postId));
    if (!post) return;

    const nextReaction = post.my_reaction === reaction ? "" : reaction;

    try {
      const res = await fetch(`/api/news/posts/${encodeURIComponent(postId)}/reaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: nextReaction }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save reaction");

      post.my_reaction = data.reaction;
      post.like_count = data.likeCount;
      post.dislike_count = data.dislikeCount;
      renderPosts();
    } catch (err) {
      alert(err.message || "Unable to save reaction.");
    }
  }

  function renderUserList(users, emptyText) {
    if (!users.length) return `<div class="news-analytics-empty">${escapeHtml(emptyText)}</div>`;

    return `
      <div class="news-analytics-users">
        ${users
          .map(
            (user) => `
              <div class="news-analytics-user">
                <span>${escapeHtml(user.name || user.email)}</span>
                <small>${escapeHtml(user.viewedAt ? formatDate(user.viewedAt) : user.email || "")}</small>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderAnalytics(data) {
    const content = document.getElementById("newsAnalyticsContent");
    const title = document.getElementById("newsAnalyticsTitle");
    const subtitle = document.getElementById("newsAnalyticsSubtitle");
    if (!content) return;

    const metrics = data.metrics || {};
    const percent = Number(metrics.viewedPercent || 0);

    if (title) title.textContent = "Post Analytics";
    if (subtitle) subtitle.textContent = data.post?.title || "";

    content.innerHTML = `
      <div class="news-analytics-summary">
        <div class="news-analytics-ring" style="--viewed-percent: ${percent};" aria-label="${percent}% viewed">
          <span>${percent}%</span>
        </div>
        <div class="news-analytics-counts">
          <strong>${Number(metrics.viewedCount || 0)} of ${Number(metrics.totalUsers || 0)} viewed</strong>
          <span>${Number(metrics.notViewedCount || 0)} not viewed</span>
        </div>
      </div>
      <div class="news-analytics-grid">
        <section>
          <h3>Viewed</h3>
          ${renderUserList(data.viewed || [], "No users have viewed this post yet.")}
        </section>
        <section>
          <h3>Not Viewed</h3>
          ${renderUserList(data.notViewed || [], "Everyone has viewed this post.")}
        </section>
      </div>
    `;
  }

  async function openAnalytics(postId) {
    const modal = document.getElementById("newsAnalyticsModal");
    const content = document.getElementById("newsAnalyticsContent");
    if (!modal || !content) return;

    modal.classList.remove("hidden");
    content.innerHTML = `<div class="news-empty">Loading analytics...</div>`;

    try {
      const res = await fetch(`/api/news/posts/${encodeURIComponent(postId)}/analytics`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load analytics");
      renderAnalytics(data);
    } catch (err) {
      content.innerHTML = `<div class="news-empty">${escapeHtml(err.message || "Unable to load analytics.")}</div>`;
    }
  }

  function closeAnalytics() {
    document.getElementById("newsAnalyticsModal")?.classList.add("hidden");
  }

  function setComposerCollapsed(collapsed) {
    const composer = document.getElementById("newsComposer");
    const form = document.getElementById("newsPostForm");
    if (!composer || !form) return;

    composer.classList.toggle("is-collapsed", collapsed);
    form.hidden = collapsed;
    document.getElementById("newsSubmitBtn")?.setAttribute("aria-expanded", String(!collapsed));
    updateComposerViewportSpace();
  }

  function restoreComposerState() {
    if (!state.canPost) return;
    setComposerCollapsed(true);
  }

  function setComposerStep(step) {
    state.composerStep = step === "details" ? "details" : "body";
    const bodyStep = document.getElementById("newsComposerBodyStep");
    const detailsStep = document.getElementById("newsComposerDetailsStep");
    const back = document.getElementById("newsComposerBackBtn");
    const submit = document.getElementById("newsSubmitBtn");
    const label = submit?.querySelector(".news-submit-label");
    const icon = submit?.querySelector(".news-submit-icon");
    const isDetails = state.composerStep === "details";
    const isCollapsed = document.getElementById("newsComposer")?.classList.contains("is-collapsed");

    bodyStep?.classList.toggle("hidden", isDetails);
    detailsStep?.classList.toggle("hidden", !isDetails);
    back?.classList.toggle("hidden", !isDetails);

    if (label) label.textContent = isDetails ? (state.editingPostId ? "Save" : "Publish") : "Post";
    if (icon) icon.textContent = isDetails && !isCollapsed ? "" : "\u27A4";
    if (submit) submit.title = isDetails ? "Publish post" : "Post";
    updateComposerViewportSpace();
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

  function setEditMode(post) {
    const cancel = document.getElementById("cancelNewsEditBtn");
    const headerSubmit = document.getElementById("newsSubmitBtn");
    const label = headerSubmit?.querySelector(".news-submit-label");

    state.editingPostId = post?.id || null;

    if (label) label.textContent = state.composerStep === "details" ? (post ? "Save" : "Publish") : "Post";
    cancel?.classList.toggle("hidden", !post);
  }

  function resetComposer() {
    const form = document.getElementById("newsPostForm");
    form?.reset();
    state.attachments = [];
    renderDraftAttachments();
    setEditMode(null);
    setComposerStep("body");
    setComposerCollapsed(true);
  }

  function startEditPost(id) {
    const post = state.posts.find((item) => Number(item.id) === Number(id));
    if (!post) return;

    setComposerCollapsed(false);
    setEditMode(post);

    document.getElementById("newsTitle").value = post.title || "";
    document.getElementById("newsBody").value = post.body || "";
    document.getElementById("newsDepartmentSelect").value = post.department_key || "";
    document.getElementById("newsPageSelect").value = post.page_key || "";
    document.getElementById("newsTags").value = Array.isArray(post.tags) ? post.tags.join(", ") : "";
    state.attachments = Array.isArray(post.attachments) ? post.attachments.map((item) => ({ ...item })) : [];
    renderDraftAttachments();
    setComposerStep("body");
    document.getElementById("newsComposer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deletePost(id) {
    if (!confirm("Delete this news post?")) return;

    try {
      const res = await fetch(`/api/news/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to delete post");

      if (state.editingPostId === id) resetComposer();
      await loadPosts();
    } catch (err) {
      alert(err.message || "Unable to delete post.");
    }
  }

  async function submitPost(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById("newsFormStatus");
    const submit = document.getElementById("newsSubmitBtn");

    if (document.getElementById("newsComposer")?.classList.contains("is-collapsed")) {
      setComposerCollapsed(false);
      setComposerStep("body");
      document.getElementById("newsBody")?.focus();
      return;
    }

    if (state.composerStep === "body") {
      const body = document.getElementById("newsBody")?.value.trim() || "";
      if (!body) {
        if (status) status.textContent = "Write the post message first.";
        document.getElementById("newsBody")?.focus();
        return;
      }
      if (status) status.textContent = "";
      setComposerStep("details");
      document.getElementById("newsTitle")?.focus();
      return;
    }

    const title = document.getElementById("newsTitle")?.value.trim() || "";
    if (!title) {
      if (status) status.textContent = "Add a title before publishing.";
      document.getElementById("newsTitle")?.focus();
      return;
    }

    if (status) status.textContent = "Posting...";
    if (submit) submit.disabled = true;

    try {
      const isEditing = Boolean(state.editingPostId);
      const url = isEditing
        ? `/api/news/posts/${encodeURIComponent(state.editingPostId)}`
        : "/api/news/posts";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.getElementById("newsTitle")?.value,
          body: document.getElementById("newsBody")?.value,
          departmentKey: document.getElementById("newsDepartmentSelect")?.value,
          departmentLabel: document.getElementById("newsDepartmentSelect")?.selectedOptions?.[0]?.textContent,
          pageKey: document.getElementById("newsPageSelect")?.value,
          pageLabel: document.getElementById("newsPageSelect")?.selectedOptions?.[0]?.textContent,
          tags: document.getElementById("newsTags")?.value,
          attachments: state.attachments,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || (isEditing ? "Failed to update post" : "Failed to post"));

      resetComposer();
      if (status) status.textContent = isEditing ? "Post updated" : `Posted ${formatDate(data.post.created_at)}`;
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

    populateMetaSelects();

    const timestamp = document.getElementById("composerTimestamp");
    if (timestamp) timestamp.textContent = formatDate(new Date().toISOString());

    document.getElementById("addAttachmentBtn")?.addEventListener("click", addAttachment);
    document.getElementById("newsPostForm")?.addEventListener("submit", submitPost);
    document.getElementById("newsComposerBackBtn")?.addEventListener("click", () => setComposerStep("body"));
    document.getElementById("closeNewsComposerBtn")?.addEventListener("click", resetComposer);
    document.getElementById("cancelNewsEditBtn")?.addEventListener("click", resetComposer);
    document.getElementById("closeNewsAnalyticsBtn")?.addEventListener("click", closeAnalytics);
    document.getElementById("newsAnalyticsModal")?.addEventListener("click", (event) => {
      if (event.target.id === "newsAnalyticsModal") closeAnalytics();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAnalytics();
    });
    document.getElementById("refreshNewsBtn")?.addEventListener("click", loadPosts);
    document.getElementById("newsSearchInput")?.addEventListener("input", renderPosts);
    document.getElementById("newsDepartmentFilter")?.addEventListener("change", renderPosts);
    document.getElementById("newsPageFilter")?.addEventListener("change", renderPosts);
    document.getElementById("newsDateFromFilter")?.addEventListener("change", renderPosts);
    document.getElementById("newsDateToFilter")?.addEventListener("change", renderPosts);
    document.getElementById("toggleNewsFiltersBtn")?.addEventListener("click", () => {
      const filters = document.getElementById("newsAdvancedFilters");
      const button = document.getElementById("toggleNewsFiltersBtn");
      const isOpening = filters?.classList.contains("hidden");
      filters?.classList.toggle("hidden", !isOpening);
      button?.setAttribute("aria-expanded", String(Boolean(isOpening)));
    });
    document.getElementById("clearNewsFiltersBtn")?.addEventListener("click", () => {
      const search = document.getElementById("newsSearchInput");
      const department = document.getElementById("newsDepartmentFilter");
      const page = document.getElementById("newsPageFilter");
      const dateFrom = document.getElementById("newsDateFromFilter");
      const dateTo = document.getElementById("newsDateToFilter");
      if (search) search.value = "";
      if (department) department.value = "";
      if (page) page.value = "";
      if (dateFrom) dateFrom.value = "";
      if (dateTo) dateTo.value = "";
      renderPosts();
    });
    document.addEventListener("click", closePostMenus);
    window.addEventListener("resize", updateComposerViewportSpace);

    try {
      await loadPermissions();
    } catch (err) {
      console.error("Failed to load news permissions:", err);
    }
    await loadPosts();
  });
})();
