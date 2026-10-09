(() => {
  /** Accessible disclosure for our local workspace and reference pages. */
  class WorkspaceNavigation {
    constructor(header) {
      this.header = header;
      this.button = header.querySelector(".workspace-menu-toggle");
      this.nav = header.querySelector("#workspace-site-nav");
      if (!this.button || !this.nav) return;
      this.mobile = window.matchMedia("(max-width: 1100px)");
      this.header.classList.add("has-workspace-menu");
      this.button.addEventListener("click", () => this.setOpen(!this.isOpen()));
      this.button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" && this.mobile.matches) {
          event.preventDefault();
          this.setOpen(true);
          this.nav.querySelector("a")?.focus();
        }
      });
      this.header.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.isOpen()) {
          event.preventDefault();
          event.stopPropagation();
          this.setOpen(false);
          this.button.focus();
        }
      });
      this.header.addEventListener("focusout", (event) => {
        // Native touch focus briefly passes through body. Use the destination
        // so links inside the menu finish activating before it closes.
        if (
          event.relatedTarget instanceof Node &&
          !this.header.contains(event.relatedTarget)
        )
          this.setOpen(false);
      });
      window.addEventListener("blur", () => this.setOpen(false));
      document.addEventListener("pointerdown", (event) => {
        if (!this.header.contains(event.target)) this.setOpen(false);
      });
      this.nav.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("a"))
          this.setOpen(false);
      });
      this.mobile.addEventListener("change", () => {
        const focusedLink = this.nav.contains(document.activeElement);
        this.setOpen(false);
        if (this.mobile.matches && focusedLink) this.button.focus();
      });
    }

    isOpen() {
      return this.button.getAttribute("aria-expanded") === "true";
    }

    setOpen(open) {
      this.button.setAttribute(
        "aria-expanded",
        String(open && this.mobile.matches),
      );
      this.nav.classList.toggle("is-open", open && this.mobile.matches);
    }
  }

  for (const header of document.querySelectorAll(
    "header[data-workspace-navigation]",
  ))
    new WorkspaceNavigation(header);
})();
