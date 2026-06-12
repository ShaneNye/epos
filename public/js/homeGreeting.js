(function initHomeGreeting() {
  const title = document.getElementById("homeWelcomeTitle");
  const subtitle = document.getElementById("homeWelcomeSubtitle");
  if (!title) return;

  function cleanText(value) {
    return String(value || "").trim();
  }

  function nameFromEmail(value) {
    const email = cleanText(value);
    if (!email || !email.includes("@")) return "";
    return email.split("@")[0].replace(/[._-]+/g, " ").trim();
  }

  function displayName(user, saved) {
    return (
      cleanText(user?.firstName) ||
      cleanText(user?.name) ||
      cleanText(user?.email) ||
      cleanText(saved?.name) ||
      nameFromEmail(saved?.username) ||
      cleanText(saved?.username) ||
      "there"
    );
  }

  function setGreeting(name) {
    const greeting = `Hi ${name} - Welcome to Epos`;
    title.textContent = greeting;
    document.title = greeting;
  }

  function setSubtitle() {
    if (!subtitle) return;
    const today = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
    subtitle.textContent = `Your dashboard for ${today}.`;
  }

  async function loadGreeting() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    if (!saved?.token) {
      setGreeting("there");
      return;
    }

    try {
      const response = await fetch("/api/me");
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Failed to load current user");
      setGreeting(displayName(data.user, saved));
    } catch (err) {
      console.warn("Failed to load home greeting:", err);
      setGreeting(displayName(null, saved));
    }
  }

  setSubtitle();
  loadGreeting();
})();
