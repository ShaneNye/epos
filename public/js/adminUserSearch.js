document.addEventListener("DOMContentLoaded", () => {
  const searchColumn = document.getElementById("searchColumn");
  const searchQuery = document.getElementById("searchQuery");
  const clearSearch = document.getElementById("clearSearch");

  function applySearch() {
    const col = searchColumn.value;
    const query = searchQuery.value.trim().toLowerCase();

    // handle empty search
    if (!query) {
      window.AdminUsers.renderUsers(window.AdminUsers.allUsers);
      return;
    }

    const filtered = window.AdminUsers.allUsers.filter(user => {
      switch (col) {
        case "name":
          return `${user.firstName || ""} ${user.lastName || ""}`
            .toLowerCase()
            .includes(query);

        case "email":
          return (user.email || "").toLowerCase().includes(query);

        case "roles":
          if (Array.isArray(user.roles)) {
            return user.roles.some(r => r.name.toLowerCase().includes(query));
          }
          return false;

        case "location":
        case "primaryStore": // fallback alias
          return (
            user.location &&
            user.location.name &&
            user.location.name.toLowerCase().includes(query)
          );

        default:
          // fallback: search across multiple fields
          return (
            `${user.firstName || ""} ${user.lastName || ""}`.toLowerCase().includes(query) ||
            (user.email || "").toLowerCase().includes(query) ||
            (Array.isArray(user.roles)
              ? user.roles.some(r => r.name.toLowerCase().includes(query))
              : false) ||
            (user.location && user.location.name
              ? user.location.name.toLowerCase().includes(query)
              : false)
          );
      }
    });

    window.AdminUsers.renderUsers(filtered);
  }

  if (searchColumn && searchQuery) {
    searchColumn.addEventListener("change", applySearch);
    searchQuery.addEventListener("input", applySearch);
  }

  if (clearSearch) {
    clearSearch.addEventListener("click", () => {
      searchQuery.value = "";
      window.AdminUsers.renderUsers(window.AdminUsers.allUsers);
    });
  }
});
