(() => {
  const input = document.getElementById("help-search");
  const results = document.getElementById("help-search-results");
  if (!input || !results) return;
  const status = results.querySelector(".help-search-status");
  const list = results.querySelector("ul");
  const form = input.closest("form");
  const clear = form?.querySelector(".help-search-clear");
  const mobileTopics = document.querySelector(".help-mobile-topics");
  let index;
  let revision = 0;
  let timer;
  const normalize = (value) =>
    value
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
  const load = () =>
    (index ??= fetch("/help/index.json")
      .then((response) => {
        if (!response.ok) throw new Error("Help index unavailable");
        return response.json();
      })
      .then((value) => value.guides)
      .catch((error) => {
        index = undefined;
        throw error;
      }));
  const search = async () => {
    const current = ++revision;
    const query = input.value.trim().slice(0, 200);
    list.replaceChildren();
    results.hidden = !query;
    input.setAttribute("aria-expanded", String(Boolean(query)));
    if (clear) clear.hidden = !input.value;
    if (!query) return;
    status.textContent = "Searching help…";
    try {
      const guides = await load();
      if (current !== revision) return;
      const terms = normalize(query).split(/\s+/);
      const matches = guides
        .map((guide) => {
          const title = normalize(guide.title);
          const text = normalize(
            `${guide.title} ${guide.summary} ${guide.text}`,
          );
          return {
            guide,
            score: terms.every((term) => text.includes(term))
              ? 1 + terms.filter((term) => title.includes(term)).length * 3
              : 0,
          };
        })
        .filter((match) => match.score)
        .sort((a, b) => b.score - a.score);
      status.textContent = matches.length
        ? `${matches.length} guide${matches.length === 1 ? "" : "s"} found for “${query}”.`
        : `No guides found for “${query}”. Try a shorter term, a format or a button name.`;
      for (const { guide } of matches) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = guide.url;
        link.textContent = guide.title;
        const excerpt = document.createElement("p");
        const position = normalize(guide.text).indexOf(terms[0]);
        excerpt.textContent =
          position >= 0
            ? `${position > 70 ? "…" : ""}${guide.text.slice(Math.max(0, position - 70), position + 180).replace(/\s+/g, " ")}…`
            : guide.summary;
        item.append(link, excerpt);
        list.append(item);
      }
    } catch {
      if (current === revision)
        status.textContent =
          "Search is unavailable. Browse Topics below, or reload to try again.";
    }
  };
  input.addEventListener("input", () => {
    revision++;
    clearTimeout(timer);
    if (clear) clear.hidden = !input.value;
    if (input.value.trim() && mobileTopics) mobileTopics.open = false;
    timer = setTimeout(search, 150);
  });
  const reset = () => {
    input.value = "";
    clearTimeout(timer);
    void search();
    input.focus();
  };
  const focusResult = async () => {
    clearTimeout(timer);
    await search();
    if (input.value.trim()) list.querySelector("a")?.focus();
  };
  clear?.addEventListener("click", reset);
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void focusResult();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      reset();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      void focusResult();
    }
  });
  results.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); reset(); }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.target.closest('input,textarea,select,[contenteditable="true"]')
    ) {
      event.preventDefault();
      input.focus();
    }
  });
})();
