(function () {
  "use strict";

  const EVENT_NAME = "BVA_BILIBILI_DATA";
  const PANEL_ID = "bva-lookup-panel";
  const STYLE_ID = "bva-style";
  const HOST_CLASS = "bva-panel-host";
  const STORAGE_KEY = "vocabulary";
  const HOTKEY_WINDOW_MS = 3000;
  const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
  const ENGLISH_RE = /[A-Za-z][A-Za-z'-]*/;
  const PLAYER_SELECTORS = [
    ".bpx-player-container",
    ".bilibili-player",
    "#bilibili-player",
    "#bilibili-player-wrap",
    ".video-container",
    ".player-wrap"
  ];
  const SUBTITLE_SELECTORS = [
    ".bpx-player-subtitle-panel-text",
    ".bpx-player-subtitle-item-text",
    ".bpx-player-subtitle-wrap",
    ".bilibili-player-video-subtitle",
    ".subtitle-item",
    "[class*='subtitle']",
    "[class*='caption']"
  ];
  const FALLBACK_DICTIONARY = new Map([
    ["ability", "n. 能力；才能"],
    ["accept", "v. 接受；认可"],
    ["access", "n./v. 入口；访问；获取"],
    ["achieve", "v. 实现；达到"],
    ["actually", "adv. 实际上；事实上"],
    ["adapt", "v. 适应；改编"],
    ["advantage", "n. 优势；有利条件"],
    ["affect", "v. 影响"],
    ["allow", "v. 允许；使成为可能"],
    ["although", "conj. 虽然；尽管"],
    ["analyze", "v. 分析"],
    ["approach", "n./v. 方法；接近"],
    ["available", "adj. 可获得的；有空的"],
    ["avoid", "v. 避免"],
    ["benefit", "n./v. 好处；受益"],
    ["challenge", "n./v. 挑战"],
    ["complex", "adj. 复杂的"],
    ["concept", "n. 概念；观念"],
    ["consider", "v. 考虑；认为"],
    ["context", "n. 上下文；背景"],
    ["create", "v. 创造；创建"],
    ["crucial", "adj. 关键的；至关重要的"],
    ["define", "v. 定义；明确"],
    ["describe", "v. 描述"],
    ["develop", "v. 发展；开发"],
    ["effective", "adj. 有效的"],
    ["efficient", "adj. 高效的"],
    ["environment", "n. 环境"],
    ["evidence", "n. 证据"],
    ["experience", "n./v. 经验；经历；体验"],
    ["feature", "n. 特征；功能"],
    ["focus", "n./v. 焦点；集中"],
    ["function", "n./v. 功能；运转"],
    ["generate", "v. 生成；产生"],
    ["improve", "v. 改善；提高"],
    ["include", "v. 包括；包含"],
    ["increase", "v./n. 增加"],
    ["individual", "adj./n. 个别的；个人"],
    ["influence", "n./v. 影响"],
    ["knowledge", "n. 知识"],
    ["maintain", "v. 维持；维护"],
    ["method", "n. 方法"],
    ["opportunity", "n. 机会"],
    ["particular", "adj. 特定的；特别的"],
    ["process", "n./v. 过程；处理"],
    ["provide", "v. 提供"],
    ["require", "v. 需要；要求"],
    ["research", "n./v. 研究"],
    ["resource", "n. 资源"],
    ["significant", "adj. 重要的；显著的"],
    ["specific", "adj. 具体的；特定的"],
    ["strategy", "n. 策略"],
    ["structure", "n. 结构"],
    ["support", "v./n. 支持"],
    ["technology", "n. 技术"],
    ["understand", "v. 理解"],
    ["valuable", "adj. 有价值的"]
  ]);

  const tracks = new Map();
  const bodies = new Map();
  const diagnostics = [];
  const dictionaryShards = new Map();
  let dictionaryFormsPromise = null;
  let lastSpaceAt = 0;
  let lastSnapshot = null;
  let apiLoadedForKey = "";
  let translatorPromise = null;

  injectStyles();
  window.addEventListener(EVENT_NAME, handleCapturedData);
  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("fullscreenchange", relocatePanel);
  document.addEventListener("webkitfullscreenchange", relocatePanel);
  warmApiData();

  function handleCapturedData(event) {
    try {
      const message = JSON.parse(event.detail);
      ingestPayload(message.payload, message.url, message.kind);
      if (message.kind === "resource-url" && isLikelySubtitleUrl(message.url)) {
        fetchAndIngestSubtitle(message.url, "player-resource");
      }
    } catch (error) {
      recordDiagnostic("capture-parse", error);
    }
  }

  async function handleKeydown(event) {
    if (isEditable(event.target)) return;
    if (event.code === "Space") {
      lastSpaceAt = Date.now();
      return;
    }
    if (event.key === "Escape") {
      closePanel();
      return;
    }
    if (event.key.toLowerCase() !== "v" || Date.now() - lastSpaceAt > HOTKEY_WINDOW_MS) return;

    event.preventDefault();
    event.stopPropagation();
    pauseVideo();
    showLoadingPanel("Locating Bilibili English subtitles...");

    const snapshot = await resolveCurrentEnglishSubtitle();
    if (!snapshot) {
      showFailurePanel();
      return;
    }
    lastSnapshot = snapshot;
    renderLookupPanel(snapshot);
  }

  async function resolveCurrentEnglishSubtitle() {
    await wait(180);
    await warmApiData();
    await ensureEnglishTrackBodies();

    const time = getVideoTime();
    const row = findBestTimedRow(time);
    if (row) {
      return createSnapshot(row.content, row.source, row.from, row.to, row.lan);
    }

    const domText = findVisibleEnglishSubtitle();
    if (domText) {
      return createSnapshot(domText, "dom", time, time + 2, "en");
    }
    return null;
  }

  async function warmApiData() {
    const bvid = getBvid();
    if (!bvid) return;
    const page = getPageNumber();
    const key = `${bvid}:${page}`;
    if (apiLoadedForKey === key) return;

    try {
      const view = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
      ingestPayload(view, "view-api", "view-api");
      const data = view?.data || {};
      const pages = Array.isArray(data.pages) ? data.pages : [];
      const cid = pages[page - 1]?.cid || data.cid;
      const aid = data.aid;
      if (cid) {
        await fetchPlayerEndpoints({ aid, bvid, cid });
      }
      apiLoadedForKey = key;
    } catch (error) {
      recordDiagnostic("view-api", error);
    }
  }

  async function fetchPlayerEndpoints({ aid, bvid, cid }) {
    const query = new URLSearchParams({ cid: String(cid), bvid });
    if (aid) query.set("aid", String(aid));
    for (const path of ["/x/player/v2", "/x/player/wbi/v2"]) {
      try {
        const data = await fetchJson(`https://api.bilibili.com${path}?${query}`);
        ingestPayload(data, path.includes("wbi") ? "player-wbi-v2" : "player-v2", "player-api");
      } catch (error) {
        recordDiagnostic(path, error);
      }
    }
  }

  function ingestPayload(payload, sourceUrl, sourceName, depth = 0) {
    if (!payload || typeof payload !== "object" || depth > 9) return;

    if (Array.isArray(payload.body) && payload.body.some(isSubtitleRow)) {
      registerBody(sourceUrl, payload.body, sourceName || "captured-subtitle");
    }

    const trackUrl = payload.subtitle_url || (looksLikeSubtitleTrack(payload) ? payload.url : "");
    if (trackUrl) {
      registerTrack({
        url: normalizeUrl(trackUrl),
        lan: String(payload.lan || payload.language || ""),
        name: String(payload.lan_doc || payload.language_doc || payload.name || ""),
        source: sourceName || sourceUrl || "captured-player"
      });
    }

    if (Array.isArray(payload)) {
      payload.forEach((item) => ingestPayload(item, sourceUrl, sourceName, depth + 1));
    } else {
      Object.values(payload).forEach((item) => ingestPayload(item, sourceUrl, sourceName, depth + 1));
    }
  }

  function registerTrack(track) {
    if (!track.url) return;
    const existing = tracks.get(track.url);
    tracks.set(track.url, {
      url: track.url,
      lan: track.lan || existing?.lan || "",
      name: track.name || existing?.name || "",
      source: track.source || existing?.source || "captured-player"
    });
  }

  function registerBody(url, body, source) {
    const normalizedUrl = normalizeUrl(url);
    const rows = body
      .map((item) => ({
        from: Number(item.from),
        to: Number(item.to),
        content: normalizeSentence(item.content || item.text || ""),
        source,
        lan: ""
      }))
      .filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to) && item.content);
    if (rows.length) bodies.set(normalizedUrl || `${source}:${bodies.size}`, rows);
  }

  async function ensureEnglishTrackBodies() {
    const candidates = Array.from(tracks.values()).sort((a, b) => trackScore(b) - trackScore(a));
    for (const track of candidates) {
      if (trackScore(track) < 40) continue;
      if (bodies.has(track.url)) continue;
      await fetchAndIngestSubtitle(track.url, track.source, track.lan);
    }
  }

  async function fetchAndIngestSubtitle(url, source, lan) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl || bodies.has(normalizedUrl)) return;
    try {
      const data = await fetchJson(normalizedUrl);
      const rows = Array.isArray(data?.body) ? data.body : [];
      const normalizedRows = rows
        .map((item) => ({
          from: Number(item.from),
          to: Number(item.to),
          content: normalizeSentence(item.content || item.text || ""),
          source,
          lan: lan || ""
        }))
        .filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to) && item.content);
      if (normalizedRows.length) bodies.set(normalizedUrl, normalizedRows);
    } catch (error) {
      recordDiagnostic(`subtitle:${normalizedUrl}`, error);
    }
  }

  function findBestTimedRow(time) {
    const englishBodies = [];
    for (const [url, rows] of bodies.entries()) {
      const track = tracks.get(url);
      const score = track ? trackScore(track) : bodyEnglishScore(rows);
      if (score >= 40) englishBodies.push({ rows, score });
    }
    englishBodies.sort((a, b) => b.score - a.score);

    for (const { rows } of englishBodies) {
      const exact = rows.find((row) => time >= row.from - 0.15 && time <= row.to + 0.25 && ENGLISH_RE.test(row.content));
      if (exact) return exact;
      const nearest = rows
        .filter((row) => ENGLISH_RE.test(row.content) && Math.min(Math.abs(time - row.from), Math.abs(time - row.to)) <= 1.8)
        .sort((a, b) => Math.abs(time - a.from) - Math.abs(time - b.from))[0];
      if (nearest) return nearest;
    }
    return null;
  }

  function trackScore(track) {
    const value = `${track.lan} ${track.name}`.toLowerCase();
    let score = 0;
    if (/(^|[-_])en(?:[-_]|$)/.test(track.lan.toLowerCase())) score += 100;
    if (value.includes("english")) score += 90;
    if (value.includes("英文") || value.includes("英语")) score += 90;
    if (value.includes("en-us") || value.includes("en-gb")) score += 30;
    if (value.includes("ai") || value.includes("auto") || value.includes("自动")) score += 15;
    if (value.includes("zh") || value.includes("中文")) score -= 50;
    return score;
  }

  function bodyEnglishScore(rows) {
    const sample = rows.slice(0, 30).map((row) => row.content).join(" ");
    const latin = (sample.match(/[A-Za-z]/g) || []).length;
    const cjk = (sample.match(/[\u3400-\u9fff]/g) || []).length;
    return latin > 20 && latin > cjk * 1.5 ? 50 : 0;
  }

  function findVisibleEnglishSubtitle() {
    const player = findPlayerContainer();
    const video = document.querySelector("video");
    const videoRect = video?.getBoundingClientRect();
    const candidates = new Set();

    for (const selector of SUBTITLE_SELECTORS) {
      document.querySelectorAll(selector).forEach((element) => candidates.add(element));
    }

    if (player && videoRect) {
      player.querySelectorAll("div, span, p").forEach((element) => {
        const text = normalizeSentence(element.innerText || element.textContent || "");
        if (!isProbableEnglishSubtitle(text)) return;
        const rect = element.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= videoRect.top + videoRect.height * 0.5 &&
          rect.bottom <= videoRect.bottom + 12 &&
          rect.left >= videoRect.left - 12 &&
          rect.right <= videoRect.right + 12
        ) {
          candidates.add(element);
        }
      });
    }

    return Array.from(candidates)
      .filter(isVisible)
      .map((element) => ({
        text: normalizeSentence(element.innerText || element.textContent || ""),
        rect: element.getBoundingClientRect()
      }))
      .filter((item) => isProbableEnglishSubtitle(item.text))
      .sort((a, b) => subtitleCandidateScore(b, videoRect) - subtitleCandidateScore(a, videoRect))[0]?.text || "";
  }

  function isProbableEnglishSubtitle(text) {
    const words = text.match(WORD_RE) || [];
    return words.length >= 2 && text.length >= 4 && text.length <= 260;
  }

  function subtitleCandidateScore(item, videoRect) {
    let score = (item.text.match(WORD_RE) || []).length * 4;
    if (videoRect) score += Math.max(0, 80 - Math.abs(item.rect.bottom - videoRect.bottom));
    if (item.text.length > 180) score -= 30;
    return score;
  }

  function renderLookupPanel(snapshot) {
    closePanel();
    const words = extractWords(snapshot.sentence);
    const panel = createPanel();
    panel.innerHTML = `
      <div class="bva-head">
        <div>
          <div class="bva-title">English subtitle</div>
          <div class="bva-meta">${escapeHtml(snapshot.source)} · ${formatTime(snapshot.startTime)}</div>
        </div>
        <button class="bva-close" type="button" title="Close">×</button>
      </div>
      <div class="bva-sentence">${escapeHtml(snapshot.sentence)}</div>
      <div class="bva-words">${words.map((word) => `<button class="bva-chip" type="button" data-word="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join("")}</div>
      <div class="bva-detail">Click a word to view its meaning and save it.</div>
    `;
    appendPanel(panel);
    wirePanel(panel, snapshot);
  }

  function wirePanel(panel, snapshot) {
    panel.querySelector(".bva-close").addEventListener("click", closePanel);
    panel.querySelectorAll(".bva-chip").forEach((button) => {
      button.addEventListener("click", async () => {
        panel.querySelectorAll(".bva-chip").forEach((chip) => chip.classList.remove("bva-chip-active"));
        button.classList.add("bva-chip-active");
        const translatorTask = getLocalTranslator();
        await renderWordDetail(panel, snapshot, button.dataset.word || "", translatorTask);
      });
    });
  }

  async function renderWordDetail(panel, snapshot, rawWord, translatorTask) {
    const word = normalizeWord(rawWord);
    const detail = panel.querySelector(".bva-detail");
    detail.innerHTML = `<div class="bva-lookup-loading">正在查询 ${escapeHtml(rawWord)}...</div>`;

    const dictionaryEntry = await lookupDictionary(word);
    const lemma = dictionaryEntry?.lemma || word;
    const phonetic = dictionaryEntry?.phonetic || "";
    const partOfSpeech = dictionaryEntry?.partOfSpeech || "";
    let translationZh = dictionaryEntry?.translationZh || "";
    let translationSource = dictionaryEntry ? "ECDICT" : "";
    if (!translationZh) {
      try {
        const translator = await translatorTask;
        translationZh = normalizeSentence(await translator.translate(rawWord));
        translationSource = "浏览器本地翻译";
      } catch {
        translationZh = FALLBACK_DICTIONARY.get(word) || "本地词典暂未收录，当前浏览器也无法使用本地英中翻译模型。";
        translationSource = FALLBACK_DICTIONARY.has(word) ? "内置基础词典" : "未收录";
      }
    }
    const definitionMissing = !dictionaryEntry && translationSource === "未收录";

    detail.innerHTML = `
      <div class="bva-word-row">
        <div>
          <div class="bva-word">${escapeHtml(rawWord)}</div>
          <div class="bva-word-meta">
            ${phonetic ? `<span>${escapeHtml(phonetic)}</span>` : ""}
            ${partOfSpeech ? `<span>${escapeHtml(partOfSpeech)}</span>` : ""}
            ${lemma !== word ? `<span>原形：${escapeHtml(lemma)}</span>` : ""}
            <span>${escapeHtml(translationSource)}</span>
          </div>
        </div>
        <div class="bva-actions">
          <button class="bva-speak" type="button" title="发音">▶</button>
          <button class="bva-save" type="button">收藏</button>
        </div>
      </div>
      <div class="bva-definition">${escapeHtml(translationZh)}</div>
      <div class="bva-context">${escapeHtml(snapshot.sentence)}</div>
      <div class="bva-status"></div>
    `;
    detail.querySelector(".bva-speak").addEventListener("click", () => speakWord(lemma));
    detail.querySelector(".bva-save").addEventListener("click", async () => {
      const button = detail.querySelector(".bva-save");
      const status = detail.querySelector(".bva-status");
      button.disabled = true;
      status.textContent = "正在收藏...";
      await saveVocabularyCard({
        word: rawWord,
        lemma,
        phonetic,
        partOfSpeech,
        translationZh,
        definitionMissing,
        context: {
          sentence: snapshot.sentence,
          videoTitle: snapshot.videoTitle,
          videoUrl: snapshot.videoUrl,
          timestamp: snapshot.startTime,
          subtitleSource: snapshot.source,
          surfaceForm: rawWord,
          createdAt: new Date().toISOString()
        }
      });
      button.textContent = "已收藏";
      status.textContent = "已加入词汇学习库";
    });
  }

  function showLoadingPanel(text) {
    closePanel();
    const panel = createPanel();
    panel.innerHTML = `
      <div class="bva-head">
        <div class="bva-title">English subtitle</div>
        <button class="bva-close" type="button" title="Close">×</button>
      </div>
      <div class="bva-sentence">${escapeHtml(text)}</div>
    `;
    appendPanel(panel);
    panel.querySelector(".bva-close").addEventListener("click", closePanel);
  }

  function showFailurePanel() {
    const trackNames = Array.from(tracks.values()).map((track) => `${track.lan || "?"}:${track.name || "unnamed"}`);
    closePanel();
    const panel = createPanel();
    panel.innerHTML = `
      <div class="bva-head">
        <div class="bva-title">English subtitle not found</div>
        <button class="bva-close" type="button" title="Close">×</button>
      </div>
      <div class="bva-sentence">Open Bilibili's CC menu and select the generated English subtitle once, then press Space and V again.</div>
      <div class="bva-diagnostic">Detected tracks: ${escapeHtml(trackNames.join(", ") || "none")}<br>Recent errors: ${escapeHtml(diagnostics.slice(-3).join(" | ") || "none")}</div>
    `;
    appendPanel(panel);
    panel.querySelector(".bva-close").addEventListener("click", closePanel);
  }

  function createPanel() {
    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = getFullscreenElement() ? "bva-panel bva-panel-fullscreen" : "bva-panel";
    return panel;
  }

  function appendPanel(panel) {
    const host = getPanelHost();
    if (host !== document.body) host.classList.add(HOST_CLASS);
    for (const eventName of ["pointerdown", "mousedown", "click", "dblclick"]) {
      panel.addEventListener(eventName, (event) => event.stopPropagation());
    }
    host.append(panel);
  }

  function getPanelHost() {
    return getFullscreenElement() || findPlayerContainer() || document.body;
  }

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function findPlayerContainer() {
    return PLAYER_SELECTORS.map((selector) => document.querySelector(selector)).find(Boolean) || null;
  }

  function relocatePanel() {
    if (lastSnapshot && document.getElementById(PANEL_ID)) renderLookupPanel(lastSnapshot);
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  async function saveVocabularyCard(draft) {
    const response = await chrome.runtime.sendMessage({ type: "BVA_SAVE_CARD", card: draft });
    if (!response?.ok) throw new Error(response?.error || "收藏失败");
  }

  async function lookupDictionary(word) {
    const forms = await loadDictionaryForms();
    const candidates = generateLemmaCandidates(word);
    if (forms[word] && !candidates.includes(forms[word])) candidates.unshift(forms[word]);
    for (const candidate of candidates) {
      const shard = await loadDictionaryShard(candidate[0]);
      const raw = shard[candidate];
      if (raw) return decodeDictionaryEntry(candidate, raw);
    }
    return null;
  }

  function loadDictionaryForms() {
    if (dictionaryFormsPromise) return dictionaryFormsPromise;
    dictionaryFormsPromise = fetch(chrome.runtime.getURL("dictionary/forms.json"))
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({}));
    return dictionaryFormsPromise;
  }

  async function loadDictionaryShard(letter) {
    const key = /^[a-z]$/.test(letter) ? letter : "_";
    if (dictionaryShards.has(key)) return dictionaryShards.get(key);
    try {
      const response = await fetch(chrome.runtime.getURL(`dictionary/${key}.json`));
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      dictionaryShards.set(key, data);
      return data;
    } catch {
      const empty = {};
      dictionaryShards.set(key, empty);
      return empty;
    }
  }

  function decodeDictionaryEntry(lemma, raw) {
    return {
      lemma,
      phonetic: raw[0] || "",
      partOfSpeech: raw[1] || "",
      translationZh: raw[2] || ""
    };
  }

  function generateLemmaCandidates(word) {
    const candidates = [word];
    const add = (value) => {
      if (value.length > 1 && !candidates.includes(value)) candidates.push(value);
    };
    if (word.endsWith("ies")) add(`${word.slice(0, -3)}y`);
    if (word.endsWith("ves")) {
      add(`${word.slice(0, -3)}f`);
      add(`${word.slice(0, -3)}fe`);
    }
    if (word.endsWith("ing")) {
      add(word.slice(0, -3));
      add(`${word.slice(0, -3)}e`);
      if (word.length > 5 && word.at(-4) === word.at(-5)) add(word.slice(0, -4));
    }
    if (word.endsWith("ed")) {
      add(word.slice(0, -2));
      add(`${word.slice(0, -1)}`);
      if (word.length > 4 && word.at(-3) === word.at(-4)) add(word.slice(0, -3));
    }
    if (word.endsWith("es")) add(word.slice(0, -2));
    if (word.endsWith("s")) add(word.slice(0, -1));
    if (word.endsWith("er")) add(word.slice(0, -2));
    if (word.endsWith("est")) add(word.slice(0, -3));
    return candidates;
  }

  function speakWord(word) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  }

  function getLocalTranslator() {
    if (translatorPromise) return translatorPromise;
    translatorPromise = createLocalTranslator().catch((error) => {
      translatorPromise = null;
      throw error;
    });
    return translatorPromise;
  }

  async function createLocalTranslator() {
    if (!window.Translator?.create) {
      throw new Error("Translator API unavailable");
    }
    const options = {
      sourceLanguage: "en",
      targetLanguage: "zh"
    };
    if (window.Translator.availability) {
      const availability = await window.Translator.availability(options);
      if (availability === "unavailable") throw new Error("English-Chinese model unavailable");
    }
    return window.Translator.create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const status = document.querySelector(`#${PANEL_ID} .bva-lookup-loading`);
          if (status) status.textContent = `正在下载本地翻译模型：${Math.round(event.loaded * 100)}%`;
        });
      }
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  function createSnapshot(sentence, source, startTime, endTime, lan) {
    return {
      sentence: normalizeSentence(sentence),
      source,
      startTime,
      endTime,
      lan,
      videoTitle: findVideoTitle(),
      videoUrl: location.href
    };
  }

  function isSubtitleRow(item) {
    return item && Number.isFinite(Number(item.from)) && Number.isFinite(Number(item.to)) && typeof (item.content || item.text) === "string";
  }

  function looksLikeSubtitleTrack(item) {
    return item && typeof item === "object" && (item.lan || item.language || item.lan_doc) && typeof item.url === "string";
  }

  function isLikelySubtitleUrl(url) {
    return /subtitle|aisubtitle|\.json(?:\?|$)/i.test(String(url)) && /hdslb|bilibili/i.test(String(url));
  }

  function normalizeUrl(url) {
    const value = String(url || "");
    if (value.startsWith("//")) return `https:${value}`;
    if (value.startsWith("/")) return `https://www.bilibili.com${value}`;
    return value;
  }

  function extractWords(text) {
    WORD_RE.lastIndex = 0;
    return Array.from(new Set(Array.from(text.matchAll(WORD_RE), (match) => match[0]))).slice(0, 40);
  }

  function normalizeWord(word) {
    return String(word).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase();
  }

  function normalizeSentence(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function getBvid() {
    return location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] || "";
  }

  function getPageNumber() {
    const page = Number(new URL(location.href).searchParams.get("p") || "1");
    return Number.isFinite(page) && page > 0 ? page : 1;
  }

  function getVideoTime() {
    return document.querySelector("video")?.currentTime || 0;
  }

  function pauseVideo() {
    const video = document.querySelector("video");
    if (video && !video.paused) video.pause();
  }

  function findVideoTitle() {
    return normalizeSentence(document.querySelector("h1.video-title")?.innerText || document.title).replace(/_哔哩哔哩_bilibili$/, "");
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function isEditable(target) {
    return target instanceof Element && Boolean(target.closest("input, textarea, [contenteditable='true'], [contenteditable='']"));
  }

  function recordDiagnostic(source, error) {
    diagnostics.push(`${source}:${error instanceof Error ? error.message : String(error)}`);
    if (diagnostics.length > 12) diagnostics.shift();
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${HOST_CLASS} { position: relative !important; }
      .bva-panel {
        position: fixed; right: 24px; top: 82px; z-index: 2147483647;
        width: min(480px, calc(100vw - 32px)); max-height: min(74vh, 640px); overflow: auto;
        box-sizing: border-box; padding: 14px; border: 1px solid rgba(16,24,40,.14);
        border-radius: 8px; background: #fffdf8; color: #172033;
        box-shadow: 0 20px 48px rgba(9,14,28,.24);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.45; text-align: left;
      }
      .bva-panel-fullscreen { position: absolute; top: 28px; right: 28px; width: min(500px, calc(100% - 56px)); max-height: calc(100% - 96px); }
      .bva-panel button { font: inherit; }
      .bva-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
      .bva-title { font-size: 15px; font-weight: 800; }
      .bva-meta, .bva-status, .bva-diagnostic { margin-top: 4px; color: #667085; font-size: 12px; }
      .bva-close { width: 28px; height: 28px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #344054; cursor: pointer; }
      .bva-sentence { margin-top: 12px; padding: 10px; border-radius: 8px; background: #f3f6f8; color: #243047; font-size: 15px; }
      .bva-words { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      .bva-chip { min-height: 30px; padding: 5px 9px; border: 1px solid #b7c9c1; border-radius: 999px; background: #fff; color: #1f5f4a; cursor: pointer; }
      .bva-chip:hover { background: #eef7f2; }
      .bva-chip-active { border-color: #1f7a5c; background: #dff2e8; color: #164e3d; }
      .bva-detail { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e4e7ec; color: #475467; font-size: 13px; }
      .bva-word-row { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
      .bva-word { color: #101828; font-size: 18px; font-weight: 800; }
      .bva-word-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 3px; color: #667085; font-size: 12px; }
      .bva-definition { margin-top: 5px; color: #243047; }
      .bva-context { margin-top: 10px; padding: 8px; border-radius: 6px; background: #f3f6f8; color: #475467; font-size: 12px; }
      .bva-actions { display: flex; gap: 8px; }
      .bva-speak { width: 32px; height: 32px; border: 1px solid #b7c9c1; border-radius: 6px; background: #fff; color: #1f5f4a; cursor: pointer; }
      .bva-save { min-height: 32px; padding: 0 12px; border: 0; border-radius: 6px; background: #1f7a5c; color: #fff; cursor: pointer; }
      .bva-save:disabled { opacity: .72; cursor: default; }
      .bva-diagnostic { margin-top: 12px; padding-top: 10px; border-top: 1px solid #e4e7ec; word-break: break-word; }
    `;
    document.documentElement.append(style);
  }
})();
