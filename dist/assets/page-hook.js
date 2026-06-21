(function () {
  "use strict";

  const EVENT_NAME = "BVA_BILIBILI_DATA";
  const seenUrls = new Set();

  function emit(kind, url, payload) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: JSON.stringify({ kind, url: String(url || ""), payload })
      }));
    } catch {
      // Ignore non-serializable responses.
    }
  }

  function inspect(url, payload) {
    if (!payload || typeof payload !== "object") return;
    if (Array.isArray(payload.body)) {
      emit("subtitle-body", url, payload);
    }
    const subtitleTracks = [];
    collectSubtitleTracks(payload, subtitleTracks);
    if (subtitleTracks.length) {
      emit("player-data", url, { subtitles: subtitleTracks });
    }
  }

  function collectSubtitleTracks(value, output, depth = 0) {
    if (!value || typeof value !== "object" || depth > 9 || output.length > 40) return;
    const url = value.subtitle_url || (
      typeof value.url === "string" &&
      (value.lan || value.language || value.lan_doc || value.language_doc) &&
      /subtitle|aisubtitle|\.json/i.test(value.url)
        ? value.url
        : ""
    );
    if (url) {
      output.push({
        id: value.id || value.sid || "",
        subtitle_url: url,
        lan: value.lan || value.language || "",
        lan_doc: value.lan_doc || value.language_doc || value.name || "",
        ai_type: value.ai_type,
        ai_status: value.ai_status
      });
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectSubtitleTracks(item, output, depth + 1));
    } else {
      Object.values(value).forEach((item) => collectSubtitleTracks(item, output, depth + 1));
    }
  }

  function inspectText(url, text) {
    if (!text || text.length > 20_000_000) return;
    try {
      inspect(url, JSON.parse(text));
    } catch {
      // Not JSON.
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = response.url || String(args[0] || "");
    if (isRelevantUrl(url)) {
      response.clone().text().then((text) => inspectText(url, text)).catch(() => {});
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__bvaUrl = String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      const url = this.responseURL || this.__bvaUrl || "";
      if (!isRelevantUrl(url)) return;
      if (this.responseType === "json") {
        inspect(url, this.response);
      } else if (!this.responseType || this.responseType === "text") {
        inspectText(url, this.responseText);
      }
    }, { once: true });
    return originalSend.apply(this, args);
  };

  function isRelevantUrl(url) {
    return /subtitle|aisubtitle|\/x\/player\/|\.json(?:\?|$)/i.test(String(url));
  }

  function emitGlobals() {
    for (const [name, value] of [
      ["__INITIAL_STATE__", window.__INITIAL_STATE__],
      ["__playinfo__", window.__playinfo__]
    ]) {
      if (value) inspect(`page-state:${name}`, value);
    }
  }

  function scanResources() {
    for (const entry of performance.getEntriesByType("resource")) {
      const url = entry.name;
      if (!seenUrls.has(url) && isRelevantUrl(url)) {
        seenUrls.add(url);
        emit("resource-url", url, null);
      }
    }
  }

  emitGlobals();
  document.addEventListener("DOMContentLoaded", emitGlobals, { once: true });
  window.addEventListener("load", emitGlobals, { once: true });
  window.setInterval(scanResources, 1500);
})();
