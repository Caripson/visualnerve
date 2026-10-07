(() => {
  const button = document.querySelector(".site-menu-toggle");
  const nav = document.getElementById("public-nav");
  if (!button || !nav) return;
  const close = () => {
    button.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
  };
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) {
      close();
      button.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target) && !button.contains(event.target)) close();
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  window
    .matchMedia("(min-width: 1001px)")
    .addEventListener("change", (event) => {
      if (event.matches) close();
    });
})();
