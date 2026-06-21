(function () {
  "use strict";

  const app = document.querySelector("#app");
  let dashboard = null;
  let cards = [];
  let view = "today";
  let query = "";

  if (!app) throw new Error("Popup root element not found.");

  renderLoading();
  void refresh();

  async function refresh() {
    const [dashboardResponse, cardsResponse] = await Promise.all([
      sendMessage({ type: "BVA_DASHBOARD" }),
      sendMessage({ type: "BVA_LIST_CARDS" })
    ]);
    dashboard = dashboardResponse;
    cards = cardsResponse;
    render();
  }

  function renderLoading() {
    app.innerHTML = `<main class="shell"><div class="loading">正在准备学习数据...</div></main>`;
  }

  function render() {
    app.innerHTML = `
      <main class="shell">
        <header class="header">
          <div>
            <h1>视频生词学习</h1>
            <p>${dashboard.totalCards} 个单词 · ${dashboard.totalContexts} 个语境</p>
          </div>
          <button class="icon-button" data-action="export" title="导出 CSV">↓</button>
        </header>

        <nav class="tabs">
          ${tabButton("today", "今日")}
          ${tabButton("library", "词库")}
          ${tabButton("settings", "设置")}
        </nav>

        ${view === "today" ? renderToday() : view === "library" ? renderLibrary() : renderSettings()}
      </main>
    `;
    wireEvents();
  }

  function tabButton(id, label) {
    return `<button class="tab ${view === id ? "tab-active" : ""}" data-view="${id}">${label}</button>`;
  }

  function renderToday() {
    return `
      <section class="today">
        <div class="stats">
          ${stat("到期复习", dashboard.dueCount)}
          ${stat("建议新词", dashboard.remainingRecommended)}
          ${stat("待学新词", dashboard.newCount)}
          ${stat("连续天数", dashboard.streak)}
        </div>
        <div class="workload">
          <div>
            <strong>今天预计 ${dashboard.estimatedMinutes} 分钟</strong>
            <p>先复习 ${dashboard.dueCount} 个到期词，再学习 ${dashboard.remainingRecommended} 个新词。</p>
          </div>
          <span>${dashboard.reviewedToday} 次已完成</span>
        </div>
        <button class="primary-button" data-action="review">开始复习</button>
        <p class="note">新词推荐会根据复习积压与近期错误率自动调整，但不会限制你继续学习。</p>
      </section>
    `;
  }

  function stat(label, value) {
    return `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`;
  }

  function renderLibrary() {
    const filtered = filterCards(cards, query);
    return `
      <section>
        <label class="search">
          <span>搜索词库</span>
          <input type="search" value="${escapeHtml(query)}" placeholder="单词、释义或字幕" />
        </label>
        <div class="list">
          ${
            filtered.length
              ? filtered.slice(0, 60).map(renderCard).join("")
              : `<div class="empty">没有匹配的词卡。</div>`
          }
        </div>
      </section>
    `;
  }

  function renderCard(card) {
    const latest = card.contexts.at(-1) || {};
    const meta = [card.phonetic, card.partOfSpeech].filter(Boolean).join(" · ");
    return `
      <article class="card">
        <div class="card-top">
          <div>
            <h2>${escapeHtml(card.lemma || card.word)}</h2>
            ${meta ? `<p class="word-meta">${escapeHtml(meta)}</p>` : ""}
            <p class="definition">${escapeHtml(card.translationZh || "暂无释义")}</p>
          </div>
          <button class="icon-button danger" data-action="delete" data-id="${escapeHtml(card.id)}" title="删除">×</button>
        </div>
        <p class="sentence">${escapeHtml(latest.sentence || "")}</p>
        <div class="context-meta">${card.contexts.length} 个语境 · ${stateLabel(card.state)}</div>
        <div class="card-actions">
          ${
            card.state === "mastered"
              ? `<button data-action="relearn" data-id="${escapeHtml(card.id)}">重新学习</button>`
              : `<button data-action="master" data-id="${escapeHtml(card.id)}">标记掌握</button>`
          }
        </div>
      </article>
    `;
  }

  function renderSettings() {
    const settings = dashboard.settings;
    return `
      <section class="settings">
        <label>
          <span>每日新词目标</span>
          <input type="number" min="5" max="100" step="5" value="${settings.newWordTarget}" data-setting="newWordTarget" />
          <small>动态建议不会超过这个目标，默认 30。</small>
        </label>
        <label class="toggle-row">
          <span>自动播放发音</span>
          <input type="checkbox" data-setting="autoSpeak" ${settings.autoSpeak ? "checked" : ""} />
        </label>
        <button class="secondary-button" data-action="save-settings">保存设置</button>
        <div class="setting-status"></div>
      </section>
    `;
  }

  function wireEvents() {
    app.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        view = button.dataset.view;
        render();
      });
    });
    app.querySelector("[data-action='review']")?.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
      window.close();
    });
    app.querySelector("[data-action='export']")?.addEventListener("click", () => exportCsv(cards));
    app.querySelector("input[type='search']")?.addEventListener("input", (event) => {
      query = event.target.value;
      render();
    });
    app.querySelectorAll("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", async () => {
        await sendMessage({ type: "BVA_DELETE_CARD", cardId: button.dataset.id });
        await refresh();
      });
    });
    app.querySelectorAll("[data-action='master']").forEach((button) => {
      button.addEventListener("click", async () => {
        await sendMessage({ type: "BVA_SET_CARD_STATE", cardId: button.dataset.id, state: "mastered" });
        await refresh();
      });
    });
    app.querySelectorAll("[data-action='relearn']").forEach((button) => {
      button.addEventListener("click", async () => {
        await sendMessage({ type: "BVA_SET_CARD_STATE", cardId: button.dataset.id, state: "new" });
        await refresh();
      });
    });
    app.querySelector("[data-action='save-settings']")?.addEventListener("click", async () => {
      const targetInput = app.querySelector("[data-setting='newWordTarget']");
      const autoSpeakInput = app.querySelector("[data-setting='autoSpeak']");
      await sendMessage({
        type: "BVA_SET_SETTINGS",
        settings: {
          newWordTarget: Number(targetInput.value),
          autoSpeak: autoSpeakInput.checked
        }
      });
      dashboard.settings.newWordTarget = Math.max(5, Math.min(100, Number(targetInput.value)));
      dashboard.settings.autoSpeak = autoSpeakInput.checked;
      app.querySelector(".setting-status").textContent = "设置已保存";
    });
  }

  function filterCards(source, search) {
    const value = search.trim().toLowerCase();
    if (!value) return source;
    return source.filter((card) => {
      const contexts = card.contexts.map((context) => `${context.sentence} ${context.videoTitle}`).join(" ");
      return [card.word, card.lemma, card.translationZh, contexts]
        .some((field) => String(field || "").toLowerCase().includes(value));
    });
  }

  function exportCsv(source) {
    const header = ["word", "lemma", "phonetic", "partOfSpeech", "translationZh", "sentence", "videoTitle", "videoUrl", "timestamp", "state", "createdAt"];
    const rows = [];
    for (const card of source) {
      for (const context of card.contexts) {
        rows.push([
          card.word, card.lemma, card.phonetic, card.partOfSpeech, card.translationZh,
          context.sentence, context.videoTitle, context.videoUrl,
          String(Math.floor(context.timestamp || 0)), card.state, card.createdAt
        ].map(toCsvCell));
      }
    }
    downloadText(`bilibili-vocabulary-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${[header, ...rows].map((row) => row.join(",")).join("\n")}`);
  }

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message).then((response) => {
      if (!response?.ok) throw new Error(response?.error || "操作失败");
      return response.result;
    });
  }

  function stateLabel(state) {
    return { new: "新词", learning: "学习中", review: "复习中", mastered: "已掌握" }[state] || "新词";
  }

  function downloadText(filename, content) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toCsvCell(value) {
    return `"${String(value || "").replace(/"/g, '""')}"`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
