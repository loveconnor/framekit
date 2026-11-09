/*
 * Framekit preview bridge. Loaded only inside the preview workspace; never part of a saved project.
 * Talks to the editor through postMessage with a fixed origin and reports geometry, hierarchy and
 * computed styles for elements tagged with data-fk-id.
 */
(function () {
  if (window.__framekitBridge) return;
  var script = document.currentScript;
  var allowedOrigins = ((script && script.dataset && script.dataset.editorOrigins) || "").split(/\s+/).filter(Boolean);
  if (allowedOrigins.length === 0 || window.parent === window) return;
  // The parent page is the referrer of an embedded frame; lock to it when it is an allowed origin.
  // Otherwise post to every allowed origin until the editor speaks.
  var editorOrigin = null;
  try {
    var referrerOrigin = document.referrer ? new URL(document.referrer).origin : null;
    if (referrerOrigin && allowedOrigins.indexOf(referrerOrigin) !== -1) editorOrigin = referrerOrigin;
  } catch {
    editorOrigin = null;
  }

  var ID = "data-fk-id";
  var mode = "edit";
  var hovered = null;
  var selected = null; // { el, id, instance }
  var editing = null; // { el, original }
  var lastDblClick = null; // { x, y, at }: where the last double-click happened
  var lastClick = null; // { x, y, at }: where the last selecting click happened
  var treeTimer = null;
  var rectFrame = 0;
  var liveStyle = null;

  function post(message) {
    var payload = Object.assign({ fk: true }, message);
    if (editorOrigin) {
      window.parent.postMessage(payload, editorOrigin);
      return;
    }
    for (var i = 0; i < allowedOrigins.length; i++) window.parent.postMessage(payload, allowedOrigins[i]);
  }

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function idOf(el) {
    return el.getAttribute(ID);
  }

  function instanceOf(el) {
    var id = idOf(el);
    var all = document.querySelectorAll('[' + ID + '="' + cssEscape(id) + '"]');
    for (var i = 0; i < all.length; i++) if (all[i] === el) return i;
    return 0;
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
  }

  function find(id, instance) {
    var all = document.querySelectorAll('[' + ID + '="' + cssEscape(id) + '"]');
    return all[instance || 0] || all[0] || null;
  }

  function targetFrom(event) {
    var node = event.target;
    if (!(node instanceof Element)) return null;
    var el = node.closest("[" + ID + "]");
    if (!el) return null;
    if (el.tagName === "BODY" && node !== el) return el;
    return el;
  }

  /* ------------------------------ tree ------------------------------ */

  function buildTree() {
    var counts = {};
    function visit(el) {
      var out = [];
      var child = el.firstElementChild;
      while (child) {
        var id = child.getAttribute(ID);
        if (id) {
          counts[id] = (counts[id] || 0) + 1;
          out.push({ id: id, instance: counts[id] - 1, tag: child.tagName.toLowerCase(), text: shortText(child), children: visit(child) });
        } else {
          out = out.concat(visit(child));
        }
        child = child.nextElementSibling;
      }
      return out;
    }
    var body = document.body;
    var bodyId = body.getAttribute(ID);
    var root = { id: bodyId || "__body", instance: 0, tag: "body", text: "", children: visit(body) };
    if (bodyId) counts[bodyId] = 1;
    return root;
  }

  function shortText(el) {
    if (el.children.length > 0 && !/^(H[1-6]|P|A|BUTTON|SPAN|LI|LABEL)$/.test(el.tagName)) return "";
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > 40 ? text.slice(0, 39) + "…" : text;
  }

  function scheduleTree() {
    if (treeTimer) return;
    treeTimer = setTimeout(function () {
      treeTimer = null;
      post({ type: "tree", tree: buildTree(), path: location.pathname });
      sendRects();
    }, 120);
  }

  /* ------------------------------ rects ----------------------------- */

  function sendRects() {
    if (rectFrame) return;
    rectFrame = requestAnimationFrame(function () {
      rectFrame = 0;
      if (selected && !document.contains(selected.el)) {
        var again = find(selected.id, selected.instance);
        if (again) selected.el = again;
        else {
          selected = null;
          post({ type: "selection-lost" });
        }
      }
      post({
        type: "rects",
        selected: selected ? { id: selected.id, instance: selected.instance, rect: rectOf(selected.el), display: getComputedStyle(selected.el).display } : null,
        hovered: hovered && document.contains(hovered) ? { id: idOf(hovered), instance: instanceOf(hovered), rect: rectOf(hovered) } : null,
        scroll: { x: window.scrollX, y: window.scrollY },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
    });
  }

  /* --------------------------- computed ----------------------------- */

  var COMPUTED_PROPS = [
    "display", "flex-direction", "justify-content", "align-items", "align-content", "flex-wrap", "gap", "row-gap", "column-gap",
    "grid-template-columns", "grid-template-rows", "flex-grow", "flex-shrink", "flex-basis", "align-self", "order", "grid-column-start", "grid-column-end",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "width", "height", "max-width", "min-height", "min-width", "max-height", "overflow-x", "overflow-y", "object-fit", "aspect-ratio",
    "position", "top", "right", "bottom", "left", "z-index",
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "color", "text-decoration-line",
    "text-transform", "white-space", "text-shadow", "list-style-type",
    "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "border-top-width", "border-top-style", "border-top-color",
    "border-right-width", "border-right-style", "border-right-color",
    "border-bottom-width", "border-bottom-style", "border-bottom-color",
    "border-left-width", "border-left-style", "border-left-color",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "opacity", "box-shadow", "cursor", "mix-blend-mode", "transform", "transition-property", "transition-duration", "transition-timing-function",
    "filter", "backdrop-filter",
  ];

  /**
   * The visible text of the element and up to five ancestors, innermost first. The editor uses it to
   * find the source string behind text that is produced by code rather than written in the JSX.
   */
  function renderedTexts(el) {
    var levels = [];
    var own = (el.textContent || "").replace(/\s+/g, " ").trim();
    var pattern = segmentPattern(own);
    for (var node = el; node && node !== document.body && levels.length < 6; node = node.parentElement) {
      var text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 2000) break;
      // Which repeat of the selected text this is, counted in the text before it ("to" in
      // "Swipe to browse, double-tap to like"), so the editor can edit that one and not the first.
      var occurrence = null;
      if (pattern && node !== el) {
        try {
          var range = document.createRange();
          range.setStart(node, 0);
          range.setEndBefore(el);
          occurrence = (range.toString().replace(/\s+/g, " ").match(pattern) || []).length;
        } catch {
          occurrence = null;
        }
      }
      // Animated text components often render a screen-reader copy plus aria-hidden pieces, so the
      // raw text holds the sentence twice. The accessible text (aria-hidden left out) has it once.
      levels.push({ raw: text, accessible: accessibleText(node).replace(/\s+/g, " ").trim(), occurrence: node === el ? 0 : occurrence });
    }
    return levels;
  }

  /** Same as segmentPattern in lib/client/text-segment.ts: a whole run of words, any spacing. */
  function segmentPattern(text) {
    var words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    var body = words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("\\s+");
    var lead = /^[\p{L}\p{N}]/u.test(words[0]) ? "(?<![\\p{L}\\p{N}])" : "";
    var trail = /[\p{L}\p{N}]$/u.test(words[words.length - 1]) ? "(?![\\p{L}\\p{N}])" : "";
    try {
      return new RegExp(lead + body + trail, "gu");
    } catch {
      return null;
    }
  }

  /**
   * Text nodes inside the element that may each come from a different source string, e.g.
   * `{name}, {role}` or a sentence followed by a link: the one that was clicked first, then the
   * element's own direct text nodes.
   */
  function textPieces(el) {
    var pieces = [];
    var add = function (text) {
      var v = (text || "").replace(/\s+/g, " ").trim();
      if (v && /[\p{L}\p{N}]/u.test(v) && pieces.indexOf(v) === -1) pieces.push(v);
    };
    var click = lastClick && Date.now() - lastClick.at < 3000 ? lastClick : null;
    if (click && document.caretRangeFromPoint) {
      var caret = document.caretRangeFromPoint(click.x, click.y);
      if (caret && caret.startContainer.nodeType === 3 && el.contains(caret.startContainer)) add(caret.startContainer.nodeValue);
    }
    for (var child = el.firstChild; child; child = child.nextSibling) if (child.nodeType === 3) add(child.nodeValue);
    return pieces.slice(0, 6);
  }

  function accessibleText(node) {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1 || node.getAttribute("aria-hidden") === "true") return "";
    var out = "";
    for (var child = node.firstChild; child; child = child.nextSibling) out += accessibleText(child);
    return out;
  }

  function sendComputed(el, id, instance) {
    var cs = getComputedStyle(el);
    var styles = {};
    for (var i = 0; i < COMPUTED_PROPS.length; i++) styles[COMPUTED_PROPS[i]] = cs.getPropertyValue(COMPUTED_PROPS[i]);
    // The parent's layout decides which child controls (flex sizing, grid span) make sense.
    styles["__parent-display"] = el.parentElement ? getComputedStyle(el.parentElement).display : "";
    var r = el.getBoundingClientRect();
    post({ type: "computed", id: id, instance: instance, styles: styles, size: { width: r.width, height: r.height }, texts: renderedTexts(el), pieces: textPieces(el) });
  }

  /**
   * Does a declaration take effect on this element? Compare the computed value now with the value
   * the browser would compute if the declaration were applied inline (highest cascade priority).
   */
  function checkStyle(el, prop, value) {
    var cs = getComputedStyle(el);
    var current = cs.getPropertyValue(prop);
    var prev = el.style.getPropertyValue(prop);
    var prevPriority = el.style.getPropertyPriority(prop);
    el.style.setProperty(prop, value, "important");
    var expected = getComputedStyle(el).getPropertyValue(prop);
    if (prev) el.style.setProperty(prop, prev, prevPriority);
    else el.style.removeProperty(prop);
    return current === expected;
  }

  /* ------------------------------ live edits ------------------------ */

  function applyCss(css) {
    if (!liveStyle) {
      liveStyle = document.createElement("style");
      liveStyle.id = "__framekit-live";
      document.head.appendChild(liveStyle);
    }
    liveStyle.textContent = css;
  }

  /* ---------------------------- inline text ------------------------- */

  function startEditing(el, id, instance) {
    if (editing) stopEditing(true);
    editing = { el: el, id: id, instance: instance, original: el.textContent };
    try {
      el.contentEditable = "plaintext-only";
      if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
    } catch {
      el.contentEditable = "true";
    }
    el.setAttribute("data-fk-editing", "");
    el.focus();
    var sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      // Started by a double-click: select the word under the pointer, as a browser would, so any
      // part of the text can be selected from there. Otherwise select everything.
      var point = lastDblClick && Date.now() - lastDblClick.at < 3000 ? lastDblClick : null;
      lastDblClick = null;
      var caret = point && document.caretRangeFromPoint ? document.caretRangeFromPoint(point.x, point.y) : null;
      if (caret && el.contains(caret.startContainer) && sel.modify) {
        sel.addRange(caret);
        sel.modify("move", "backward", "word");
        sel.modify("extend", "forward", "word");
      } else {
        var range = document.createRange();
        range.selectNodeContents(el);
        sel.addRange(range);
      }
    }
    el.addEventListener("blur", onEditBlur);
    el.addEventListener("keydown", onEditKey);
    el.addEventListener("input", onEditInput);
  }

  function stopEditing(commit) {
    if (!editing) return;
    var state = editing;
    editing = null;
    state.el.removeEventListener("blur", onEditBlur);
    state.el.removeEventListener("keydown", onEditKey);
    state.el.removeEventListener("input", onEditInput);
    state.el.contentEditable = "false";
    state.el.removeAttribute("contenteditable");
    state.el.removeAttribute("data-fk-editing");
    var value = state.el.textContent || "";
    if (commit && value !== state.original) {
      post({ type: "text-commit", id: state.id, instance: state.instance, value: value });
    } else {
      state.el.textContent = state.original;
      post({ type: "text-cancel", id: state.id });
    }
    sendRects();
  }

  function onEditBlur() { stopEditing(true); }
  function onEditInput() { sendRects(); }
  function onEditKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopEditing(false); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); stopEditing(true); }
    else e.stopPropagation();
  }

  /* ------------------------------ events ---------------------------- */

  function onPointerMove(e) {
    if (mode !== "edit") return;
    var el = targetFrom(e);
    if (el !== hovered) {
      hovered = el;
      post({ type: "hover", target: el ? { id: idOf(el), instance: instanceOf(el), rect: rectOf(el), tag: el.tagName.toLowerCase() } : null });
    }
  }

  function onPointerLeave() {
    if (hovered) {
      hovered = null;
      post({ type: "hover", target: null });
    }
  }

  function blockInteraction(e) {
    if (mode !== "edit") return;
    if (editing && editing.el.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onClick(e) {
    if (mode !== "edit") return;
    if (editing && editing.el.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (editing) stopEditing(true);
    var el = targetFrom(e);
    if (!el) {
      post({ type: "select", target: null });
      return;
    }
    lastClick = { x: e.clientX, y: e.clientY, at: Date.now() };
    select(el, idOf(el), instanceOf(el));
    post({ type: "select", target: { id: selected.id, instance: selected.instance, rect: rectOf(el), tag: el.tagName.toLowerCase() } });
    sendComputed(el, selected.id, selected.instance);
  }

  function onDoubleClick(e) {
    if (mode !== "edit") return;
    e.preventDefault();
    e.stopPropagation();
    var el = targetFrom(e);
    if (!el) return;
    lastDblClick = { x: e.clientX, y: e.clientY, at: Date.now() };
    post({ type: "dblclick", id: idOf(el), instance: instanceOf(el) });
  }

  function onContextMenu(e) {
    if (mode !== "edit") return;
    e.preventDefault();
    e.stopPropagation();
    var el = targetFrom(e);
    if (!el) return;
    select(el, idOf(el), instanceOf(el));
    post({ type: "contextmenu", id: selected.id, instance: selected.instance, x: e.clientX, y: e.clientY, rect: rectOf(el) });
  }

  function onKeyDown(e) {
    if (editing) return;
    if (mode !== "edit") return;
    // Forward editor shortcuts so the parent can act on them even while the iframe has focus.
    var meta = e.metaKey || e.ctrlKey;
    if (e.key === "Escape" || e.key === "Delete" || e.key === "Backspace" || (meta && /^[zdsp]$/i.test(e.key))) {
      e.preventDefault();
      post({ type: "key", key: e.key, meta: meta, shift: e.shiftKey });
    }
  }

  function select(el, id, instance) {
    selected = { el: el, id: id, instance: instance };
  }

  /* ---------------------------- navigation -------------------------- */

  var lastPath = location.pathname + location.search;
  function reportNavigation() {
    // Next.js calls replaceState during refreshes; only a real path change counts as navigation.
    var path = location.pathname + location.search;
    if (path === lastPath) return;
    lastPath = path;
    post({ type: "navigate", path: path });
    scheduleTree();
  }

  var pushState = history.pushState;
  history.pushState = function () {
    var result = pushState.apply(this, arguments);
    setTimeout(reportNavigation, 0);
    return result;
  };
  var replaceState = history.replaceState;
  history.replaceState = function () {
    var result = replaceState.apply(this, arguments);
    setTimeout(reportNavigation, 0);
    return result;
  };
  window.addEventListener("popstate", reportNavigation);

  /* ----------------------------- messages --------------------------- */

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (editorOrigin ? event.origin !== editorOrigin : allowedOrigins.indexOf(event.origin) === -1) return;
    var msg = event.data;
    if (!msg || msg.fk !== true || typeof msg.type !== "string") return;
    editorOrigin = event.origin;
    switch (msg.type) {
      case "mode":
        mode = msg.mode === "preview" ? "preview" : "edit";
        if (mode === "preview") { hovered = null; if (editing) stopEditing(true); }
        applyModeStyle();
        sendRects();
        break;
      case "select": {
        if (editing) stopEditing(true);
        if (!msg.id) { selected = null; sendRects(); break; }
        var el = find(msg.id, msg.instance);
        if (!el) { selected = null; post({ type: "selection-lost" }); break; }
        select(el, msg.id, msg.instance || 0);
        if (msg.scroll) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
        sendRects();
        sendComputed(el, selected.id, selected.instance);
        break;
      }
      case "hover": {
        var h = msg.id ? find(msg.id, msg.instance) : null;
        hovered = h;
        sendRects();
        break;
      }
      case "css":
        applyCss(typeof msg.css === "string" ? msg.css : "");
        sendRects();
        if (selected) sendComputed(selected.el, selected.id, selected.instance);
        break;
      case "set-style-attr": {
        var all = document.querySelectorAll('[' + ID + '="' + cssEscape(msg.id) + '"]');
        for (var i = 0; i < all.length; i++) all[i].setAttribute("data-fk-style", msg.styleId);
        break;
      }
      case "set-text": {
        var nodes = document.querySelectorAll('[' + ID + '="' + cssEscape(msg.id) + '"]');
        for (var j = 0; j < nodes.length; j++) if (!editing || nodes[j] !== editing.el) nodes[j].textContent = msg.value;
        sendRects();
        break;
      }
      case "set-attr": {
        var targets = document.querySelectorAll('[' + ID + '="' + cssEscape(msg.id) + '"]');
        for (var k = 0; k < targets.length; k++) {
          if (msg.value === null) targets[k].removeAttribute(msg.name);
          else targets[k].setAttribute(msg.name, msg.value);
        }
        break;
      }
      case "edit-text": {
        var target = find(msg.id, msg.instance);
        if (target) { select(target, msg.id, msg.instance || 0); startEditing(target, msg.id, msg.instance || 0); }
        break;
      }
      case "stop-edit":
        stopEditing(msg.commit !== false);
        break;
      case "request-tree":
        post({ type: "tree", tree: buildTree(), path: location.pathname });
        sendRects();
        break;
      case "request-computed": {
        var c = find(msg.id, msg.instance);
        if (c) sendComputed(c, msg.id, msg.instance || 0);
        break;
      }
      case "check-style": {
        var s = find(msg.id, msg.instance);
        post({ type: "style-check", id: msg.id, property: msg.property, value: msg.value, applied: s ? checkStyle(s, msg.property, msg.value) : null });
        break;
      }
      case "navigate":
        if (typeof msg.path === "string") location.assign(msg.path);
        break;
      case "reload":
        reloadWhenUpdated(typeof msg.waitForText === "string" ? msg.waitForText : "");
        break;
    }
  });

  /**
   * A full reload, keeping the scroll position. Used after edits that hot reloading renders badly,
   * e.g. text inside components with entrance animations that only run on mount. Reloading before
   * the dev server has picked up the change would load the old code, so first wait (up to 5s) until
   * hot reloading has put `waitForText` on the page.
   */
  function reloadWhenUpdated(waitForText) {
    var normalize = function (s) {
      return String(s).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    };
    var wanted = normalize(waitForText);
    var started = Date.now();
    var reload = function () {
      try {
        sessionStorage.setItem("__framekit-scroll", JSON.stringify([window.scrollX, window.scrollY]));
      } catch {
        // storage blocked: the browser's own scroll restoration still applies
      }
      location.reload();
    };
    var check = function () {
      if (!wanted || normalize(document.body.textContent || "").indexOf(wanted) !== -1 || Date.now() - started > 5000) reload();
      else setTimeout(check, 150);
    };
    check();
  }

  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerleave", onPointerLeave, true);
  document.addEventListener("mousedown", blockInteraction, true);
  document.addEventListener("pointerdown", function (e) { if (mode === "edit" && !(editing && editing.el.contains(e.target))) e.stopPropagation(); }, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDoubleClick, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("submit", blockInteraction, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", sendRects, true);
  window.addEventListener("resize", function () { sendRects(); scheduleTree(); });

  var observer = new MutationObserver(function () { scheduleTree(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-fk-id", "class", "style", "src", "href"] });
  if (window.ResizeObserver) {
    new ResizeObserver(function () { sendRects(); }).observe(document.documentElement);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sendRects);

  var modeStyle = null;
  function applyModeStyle() {
    if (!modeStyle) {
      modeStyle = document.createElement("style");
      modeStyle.id = "__framekit-bridge-style";
      document.head.appendChild(modeStyle);
    }
    modeStyle.textContent =
      mode === "edit"
        ? "* { cursor: default !important; user-select: none !important; -webkit-user-select: none !important; }" +
          "[data-fk-editing] { user-select: text !important; -webkit-user-select: text !important; cursor: text !important; outline: none !important; }"
        : "";
  }
  applyModeStyle();

  // Next's dev tools badge lives in an open shadow root; hide the badge but keep error overlays.
  function hideDevBadge() {
    var portal = document.querySelector("nextjs-portal");
    var root = portal && portal.shadowRoot;
    if (!root || root.querySelector("#__framekit-hide-badge")) return;
    var css = document.createElement("style");
    css.id = "__framekit-hide-badge";
    css.textContent = "#devtools-indicator, [data-nextjs-dev-tools-button] { display: none !important; }";
    root.appendChild(css);
  }
  hideDevBadge();
  new MutationObserver(hideDevBadge).observe(document.documentElement, { childList: true, subtree: true });

  try {
    var savedScroll = sessionStorage.getItem("__framekit-scroll");
    if (savedScroll) {
      sessionStorage.removeItem("__framekit-scroll");
      var xy = JSON.parse(savedScroll);
      window.scrollTo(xy[0], xy[1]);
    }
  } catch {
    // storage blocked or malformed: keep the default position
  }

  window.__framekitBridge = { version: 1 };
  post({ type: "ready", path: location.pathname + location.search });
  scheduleTree();
})();
