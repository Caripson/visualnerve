(() => {
  "use strict";
  const STORAGE = "visualnerve-site-consent-v1";
  const SAVED_AT = "visualnerve-site-consent-saved-at";
  const SERVICE = "google-analytics";
  const LIFETIME = 30 * 24 * 60 * 60 * 1000;
  const measurement = document.querySelector('meta[name="visualnerve-google-analytics"]')?.content?.trim() || "";
  const id = /^G-[A-Z0-9]{4,}$/.test(measurement) ? measurement : "";
  const route = document.querySelector('meta[name="visualnerve-analytics-page"]')?.content || "";
  const publicRoutes = new Set(["/", "/features/", "/use-cases/", "/process-simulator/", "/mcp/", "/developers/", "/privacy/", "/security/", "/license/"]);
  // The metadata must explicitly opt this exact public route in. No query,
  // fragment, referrer, DOM text, diagram content or integration state is read.
  const eligible = publicRoutes.has(route) && route === location.pathname;
  let manager;
  let started = false;
  let persistenceFailed = false;
  let expiryTimer;
  let storageTimer;
  let trigger;
  const disabledKey = "ga-disable-" + id;
  const safePage = {
    page_location: location.origin + route,
    page_referrer: "",
    page_title: "Visual Nerve",
  };

  function readSavedAt() {
    try { return Number(localStorage.getItem(SAVED_AT)); }
    catch { return 0; }
  }
  function fresh() {
    const at = readSavedAt();
    try {
      const value = JSON.parse(decodeURIComponent(localStorage.getItem(STORAGE) || "null"));
      return value !== null && !Array.isArray(value) && typeof value[SERVICE] === "boolean" &&
        at > 0 && at <= Date.now() && Date.now() - at < LIFETIME;
    } catch { return false; }
  }
  function clearExpired() {
    if (fresh()) return;
    try {
      localStorage.removeItem(STORAGE);
      localStorage.removeItem(SAVED_AT);
    } catch { /* Unavailable storage leaves consent off. */ }
  }
  clearExpired();

  function deleteAnalyticsCookies() {
    for (const entry of document.cookie.split(";")) {
      const name = entry.split("=")[0].trim();
      if (!/^_ga(?:_|$)/.test(name)) continue;
      const deletion = name + "=; Max-Age=0; Path=/; SameSite=Lax";
      document.cookie = deletion;
      document.cookie = deletion + "; Domain=" + location.hostname;
      document.cookie = deletion + "; Domain=." + location.hostname;
    }
  }
  function stopAnalytics() {
    if (id) window[disabledKey] = true;
    document.getElementById("visualnerve-google-tag")?.remove();
    deleteAnalyticsCookies();
    if (started) {
      started = false;
      // Removing a script cannot unload its listeners. A fresh public document
      // stops the tag completely, with the persisted rejection already saved.
      window.gtag = () => {};
      window.dataLayer = [];
      if (!persistenceFailed) location.reload();
    }
  }
  function allowAnalytics(consent) {
    if (!consent || !eligible || !id || !fresh() || persistenceFailed) {
      stopAnalytics();
      return;
    }
    if (started) return;
    started = true;
    window[disabledKey] = false;
    window.dataLayer = [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    // Basic gating: even default consent commands are queued only after a
    // confirmed opt-in. No denied-mode tag, request or consent ping is loaded.
    window.gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    window.gtag("consent", "update", { analytics_storage: "granted" });
    window.gtag("js", new Date());
    window.gtag("config", id, {
      ...safePage,
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: location.hostname,
      cookie_path: "/",
      cookie_expires: 30 * 24 * 60 * 60,
      cookie_update: false,
      cookie_flags: location.protocol === "https:" ? "SameSite=Lax;Secure" : "SameSite=Lax",
    });
    window.gtag("event", "page_view", { ...safePage, send_to: id });
    const script = document.createElement("script");
    script.id = "visualnerve-google-tag";
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.append(script);
  }
  const description = "Optional Google Analytics counts visits to public product pages. It never runs in the workspace, user guide or API reference. Diagram content and URL queries are excluded. You can reject it or withdraw later in Cookie settings.";
  window.visualNerveConsentConfig = {
    elementID: "visualnerve-consent",
    storageMethod: "localStorage",
    storageName: STORAGE,
    default: false,
    mustConsent: false,
    acceptAll: true,
    hideDeclineAll: false,
    hideLearnMore: false,
    showNoticeTitle: true,
    noAutoLoad: true,
    lang: "en",
    htmlTexts: false,
    translations: {
      en: {
        privacyPolicyUrl: "/privacy/",
        acceptAll: "Accept analytics",
        ok: "Accept analytics",
        save: "Save choices",
        acceptSelected: "Save choices",
        decline: "Reject analytics",
        consentNotice: { title: "Optional analytics", description: "Google Analytics measures visits to public pages only. It never runs in the workspace. You can reject or change this later in Cookie settings.", learnMore: "Cookie settings" },
        consentModal: { title: "Cookie settings", description },
        purposes: { analytics: { title: "Public-page analytics", description: "Optional visit statistics, separate from your diagrams." } },
      },
    },
    services: id ? [{
      name: SERVICE,
      title: "Google Analytics",
      purposes: ["analytics"],
      default: false,
      required: false,
      optOut: false,
      cookies: [[/^_ga(?:_|$)/, "/", location.hostname], [/^_ga(?:_|$)/, "/"]],
      translations: { en: { description: "Google receives a public page route and ordinary request metadata only after you accept. It may store _ga analytics cookies. No workspace, Help or API usage is measured." } },
      callback: allowAnalytics,
    }] : [],
  };

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (!fresh()) return;
    expiryTimer = setTimeout(() => {
      if (fresh()) scheduleExpiry();
      else {
        manager.resetConsents();
        try { localStorage.removeItem(SAVED_AT); } catch { /* Consent remains off. */ }
        stopAnalytics();
      }
    }, Math.min(readSavedAt() + LIFETIME - Date.now(), 2147483647));
  }
  function noAnalyticsDialog() {
    let dialog = document.getElementById("visualnerve-cookie-info");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "visualnerve-cookie-info";
      dialog.className = "site-cookie-info";
      dialog.setAttribute("aria-labelledby", "site-cookie-title");
      const title = document.createElement("h2");
      title.id = "site-cookie-title";
      title.textContent = "Cookie settings";
      const text = document.createElement("p");
      text.textContent = id ? "Optional analytics is unavailable and remains off. Reload to try Cookie settings again. Your browser must allow local storage to retain a choice." : "No optional analytics configured. The workspace uses separate local storage settings for your diagrams.";
      const close = document.createElement("button");
      close.textContent = "Close";
      close.addEventListener("click", () => dialog.close());
      dialog.append(title, text, close);
      dialog.addEventListener("close", () => trigger?.focus());
      document.body.append(dialog);
    }
    dialog.showModal();
  }
  function accessibleModal() {
    let current;
    let previous;
    const inert = new Map();
    const sync = () => {
      const modal = document.querySelector("#visualnerve-consent .cm-modal");
      if (modal === current) return;
      if (current) {
        for (const [element, value] of inert) element.inert = value;
        inert.clear();
        if (previous?.isConnected) previous.focus();
      }
      current = modal;
      if (!modal) return;
      previous = trigger || document.activeElement;
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      const title = modal.querySelector(".title");
      title.id = "visualnerve-cookie-title";
      modal.setAttribute("aria-labelledby", title.id);
      for (const element of document.body.children) {
        if (element.id === "visualnerve-consent" || element.tagName === "SCRIPT") continue;
        inert.set(element, element.inert);
        element.inert = true;
      }
      modal.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          modal.querySelector("button.hide")?.click();
        } else if (event.key === "Tab") {
          const controls = [...modal.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),[tabindex="0"]')]
            .filter((element) => element.getClientRects().length);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }
      });
    };
    new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
    sync();
  }
  function initialize() {
    const config = window.visualNerveConsentConfig;
    if (id && window.klaro) {
      try { manager = window.klaro.getManager(config); }
      catch { stopAnalytics(); }
    }
    if (manager) {
      // Klaro's persistence must fail closed even when storage becomes full or
      // is blocked after the initial read. A failed save cannot enable a tag.
      const persist = manager.store.set.bind(manager.store);
      manager.store.set = (value) => {
        try { persist(value); persistenceFailed = false; }
        catch {
          persistenceFailed = true;
          manager.changeAll(false);
          stopAnalytics();
          noAnalyticsDialog();
        }
      };
      manager.watch({
        update(_manager, name) {
          if (name !== "saveConsents") return;
          if (persistenceFailed) return;
          try { localStorage.setItem(SAVED_AT, String(Date.now())); }
          catch { persistenceFailed = true; stopAnalytics(); noAnalyticsDialog(); }
          scheduleExpiry();
        },
      });
      manager.applyConsents();
      scheduleExpiry();
      if (eligible && !manager.confirmed) window.klaro.show(config);
    }
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cookie-settings]");
      if (!button) return;
      event.preventDefault();
      trigger = button;
      if (!manager) noAnalyticsDialog();
      else window.klaro.show(config, true);
    });
    window.addEventListener("storage", (event) => {
      if (!manager || ![STORAGE, SAVED_AT, null].includes(event.key)) return;
      // Klaro saves the choice and our watcher saves its time in the same task.
      // Read both together; never erase another tab's choice during its save.
      clearTimeout(storageTimer);
      storageTimer = setTimeout(() => {
        try {
          if (fresh()) manager.loadConsents();
          else { manager.changeAll(false); manager.confirmed = false; }
          manager.applyConsents();
          scheduleExpiry();
        } catch { stopAnalytics(); }
      }, 0);
    });
    accessibleModal();
  }
  if (document.readyState !== "complete") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
