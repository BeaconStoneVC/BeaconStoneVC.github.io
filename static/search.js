/* Client-side search over the pre-built index. Vanilla, no dependency — the
   site has no frontend build step. The index is fetched lazily on first focus
   so its ~0.3 MB is never on the critical path of a normal page view. */
(function () {
  "use strict";
  var index = null, loading = null;

  function fold(s) {
    // \u0300-\u036f = combining diacritical marks. Written as escapes on
    // purpose: a literal range here is invisible in a diff and easy to corrupt.
    return (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  // Resolves to the index rows, or to NULL when the fetch failed.
  //
  // Failure must not be sticky. This used to `catch` by memoizing `index = []`,
  // which poisoned the page permanently: `loading` stayed set, so no later
  // keystroke ever retried, and every query rendered "No matches." — a message
  // indistinguishable from a genuine zero-result, off ONE transient 404 or one
  // moment offline. So on failure: clear `loading` (the next call re-fetches)
  // and leave `index` null (the caller can tell "never arrived" from "arrived
  // and matched nothing").
  function load(base) {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch(base + "/search-index.json")
        .then(function (r) {
          // A 404 is a RESOLVED fetch — without this it would fall through to
          // .json() and fail on a parse error, or worse, succeed on an error
          // page that happened to be JSON.
          if (!r.ok) throw new Error("search index HTTP " + r.status);
          return r.json();
        })
        .then(function (rows) { index = rows; return rows; })
        .catch(function () { loading = null; return null; });
    }
    return loading;
  }

  function score(name, q) {
    var n = fold(name);
    if (n === q) return 0;
    if (n.indexOf(q) === 0) return 1;
    if (n.indexOf(" " + q) !== -1) return 2;
    if (n.indexOf(q) !== -1) return 3;
    return -1;
  }

  function search(rows, query, limit) {
    var q = fold(query), hits = [];
    if (!q) return hits;
    for (var i = 0; i < rows.length; i++) {
      var s = score(rows[i][0], q);
      if (s >= 0) hits.push([s, rows[i]]);
    }
    hits.sort(function (a, b) {
      return a[0] - b[0] || a[1][0].length - b[1][0].length ||
             (a[1][0] < b[1][0] ? -1 : 1);
    });
    return hits.slice(0, limit || 25).map(function (h) { return h[1]; });
  }

  // A composed href becomes a live link only if it is a same-origin relative
  // path shaped like (optional base)/funds/<slug>.html or
  // (optional base)/companies/<slug>.html. The two charAt() checks rule out a
  // scheme (javascript:, data:, ...) and a protocol-relative URL (//evil.example/…) —
  // neither of those can start with "/" followed by a non-"/" character. This is
  // defense-in-depth: index urls are always build-generated (search_index.py),
  // never derived from the untrusted fields a company/fund page might carry
  // (website, linkedin, ...), but the client should not assume that invariant
  // holds rather than enforce it locally too.
  var SAFE_HREF_SUFFIX_RE = /\/(?:funds|companies)\/[a-z0-9][a-z0-9-]*\.html$/;

  function safeHref(href) {
    return href.charAt(0) === "/" && href.charAt(1) !== "/" &&
           SAFE_HREF_SUFFIX_RE.test(href);
  }

  // Replace the results list with a single status line. `cls` distinguishes the
  // states for both the reader and the stylesheet: "empty" = searched, found
  // nothing; "error" = could not search at all.
  function message(box, cls, text) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var li = document.createElement("li");
    li.className = cls;
    li.textContent = text;
    box.appendChild(li);
  }

  function render(box, hits, base) {
    // Built with DOM nodes, not string concatenation + innerHTML: name and url
    // are scraped/derived third-party data, and setting .textContent / .href as
    // properties (rather than splicing raw strings into an HTML template) means
    // neither can ever be parsed as markup or break out of an attribute, no
    // matter what characters they contain.
    if (!hits.length) {
      message(box, "empty", "No matches.");
      return;
    }
    while (box.firstChild) box.removeChild(box.firstChild);
    hits.forEach(function (h) {
      var kind = h[2] === "f" ? "fund" : "company";
      var li = document.createElement("li");
      var href = base + h[1];
      var ok = safeHref(href);
      var node = document.createElement(ok ? "a" : "span");
      if (ok) node.href = href;
      node.textContent = h[0];
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = kind + " · " + h[3];
      li.appendChild(node);
      li.appendChild(document.createTextNode(" "));
      li.appendChild(chip);
      box.appendChild(li);
    });
  }

  function wire(input, box, base) {
    function run() {
      load(base).then(function (rows) {
        if (!rows) {
          // Distinct from "No matches.": the index never loaded, so nothing was
          // actually searched. `load` cleared its memo, so the next keystroke
          // retries rather than repeating this forever.
          message(box, "error",
                  "Search is unavailable right now — check your connection, " +
                  "or browse the fund and company indexes.");
          return;
        }
        render(box, search(rows, input.value), base);
      });
    }
    input.addEventListener("focus", function () { load(base); });
    input.addEventListener("input", run);
    if (input.value) run();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var input = document.getElementById("site-search");
    var box = document.getElementById("site-search-results");
    if (!input || !box) return;
    var base = input.getAttribute("data-base") || "";
    var q = new URLSearchParams(window.location.search).get("q");
    if (q) input.value = q;
    wire(input, box, base);
  });
})();
