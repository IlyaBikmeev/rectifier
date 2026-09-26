export function initRouter({ routes, navigationElement }) {
  function renderRoute() {
    const route = routes.has(window.location.hash)
      ? window.location.hash
      : "#/";

    if (window.location.hash !== route) {
      window.history.replaceState(null, "", route);
    }

    for (const [path, view] of routes) {
      view.classList.toggle("d-none", path !== route);
    }

    for (const link of document.querySelectorAll("[data-route]")) {
      const isActive = link.dataset.route === route;
      link.classList.toggle("active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }

    if (navigationElement.classList.contains("show")) {
      window.bootstrap.Offcanvas.getOrCreateInstance(navigationElement).hide();
    }
  }

  window.addEventListener("hashchange", renderRoute);
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#/"]');
    if (link && link.hash === window.location.hash) renderRoute();
  });
  renderRoute();
}
