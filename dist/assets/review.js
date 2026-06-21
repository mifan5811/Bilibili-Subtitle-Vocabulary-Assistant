(function () {
  "use strict";

  const app = document.querySelector("#app");
  const scheduler = FSRS.fsrs();
  let queue = [];
  let currentIndex = 0;
  let currentPhase = "test";
  let startedAt = 0;
  let hintsUsed = 0;
  let revealed = false;
  let session = { correct: 0, wrong: 0, hints: 0, reviewed: 0, totalDuration: 0 };
  let settings = { newWordTarget: 30, autoSpeak: true };

  if (!app) throw new Error("Review root not found.");

  renderLoading();
  void initialize();

  async function initialize() {
    settings = await sendMessage({ type: "BVA_GET_SETTINGS" });
    await loadQueue("default", false);
  }

  async function loadQueue(mode, append) {
    renderLoading();
    const response = await sendMessage({ type: "BVA_GET_REVIEW_QUEUE", mode });
    if (append) {
      const existingIds = new Set(queue.map((item) => item.card.id));
      queue.push(...response.items.filter((item) => !existingIds.has(item.card.id)));
    } else {
      queue = response.items;
      currentIndex = 0;
      session = { correct: 0, wrong: 0, hints: 0, reviewed: 0, totalDuration: 0 };
    }
    if (!queue.length || currentIndex >= queue.length) {
      renderComplete(response.dashboard);
      return;
    }
    prepareCurrent();
  }

  function prepareCurrent() {
    const item = queue[currentIndex];
    hintsUsed = 0;
    revealed = false;
    currentPhase = item.isNew ? "intro" : "test";
    startedAt = performance.now();
    renderCurrent();
    if (settings.autoSpeak && currentPhase === "intro") speak(item.context.surfaceForm || item.card.word);
  }

  function renderCurrent() {
    const item = queue[currentIndex];
    if (!item) {
      renderComplete();
      return;
    }
    app.innerHTML = currentPhase === "intro" ? renderIntro(item) : renderTest(item);
    wireCurrentEvents(item);
    if (currentPhase === "test") {
      app.querySelector(".answer-input")?.focus();
    }
  }

  function renderShell(content) {
    return `
      <main class="review-shell">
        <header class="topbar">
          <div>
            <a class="brand" href="review.html">视频生词学习</a>
            <span>${currentIndex + 1} / ${queue.length}</span>
          </div>
          <div class="session-stats">
            <span class="correct">正确 ${session.correct}</span>
            <span class="wrong">错误 ${session.wrong}</span>
          </div>
        </header>
        <div class="progress"><span style="width:${queue.length ? currentIndex / queue.length * 100 : 0}%"></span></div>
        ${content}
      </main>
    `;
  }

  function renderIntro(item) {
    const card = item.card;
    return renderShell(`
      <section class="study">
        <div class="eyebrow">新词理解</div>
        <h1>${escapeHtml(card.lemma)}</h1>
        <div class="pronunciation">${escapeHtml([card.phonetic, card.partOfSpeech].filter(Boolean).join(" · "))}</div>
        <div class="translation">${escapeHtml(card.translationZh || "暂无中文释义")}</div>
        <div class="context">
          <div class="context-label">来自视频语境</div>
          <p>${escapeHtml(item.context.sentence || "")}</p>
          <span>${escapeHtml(item.context.videoTitle || "")}</span>
        </div>
        <div class="study-actions">
          <button class="icon-action" data-action="speak" title="播放发音">▶</button>
          <button class="primary" data-action="start-test">开始拼写</button>
        </div>
      </section>
    `);
  }

  function renderTest(item) {
    const expected = expectedAnswer(item);
    const hint = expected.slice(0, hintsUsed);
    const cloze = buildCloze(item.context.sentence, item.context.surfaceForm || item.card.word);
    return renderShell(`
      <section class="test">
        <div class="eyebrow">${item.isNew ? "即时拼写" : "到期复习"}</div>
        <div class="translation">${escapeHtml(item.card.translationZh || "回忆这个单词")}</div>
        <div class="cloze">${escapeHtml(cloze)}</div>
        <div class="answer-area">
          <div class="hint-line">
            <span>提示：${hint ? `${escapeHtml(hint)}${" _".repeat(Math.max(0, expected.length - hint.length))}` : `${expected.length} 个字符`}</span>
            <button class="text-button" data-action="hint">再提示一个字母</button>
          </div>
          <input class="answer-input" type="text" autocomplete="off" spellcheck="false" placeholder="输入完整英文单词" />
          <div class="feedback"></div>
        </div>
        <div class="test-actions">
          <button class="secondary" data-action="reveal">显示答案</button>
          <button class="primary" data-action="submit">提交</button>
        </div>
      </section>
    `);
  }

  function wireCurrentEvents(item) {
    app.querySelector("[data-action='speak']")?.addEventListener("click", () => speak(expectedAnswer(item)));
    app.querySelector("[data-action='start-test']")?.addEventListener("click", () => {
      currentPhase = "test";
      startedAt = performance.now();
      renderCurrent();
    });
    app.querySelector("[data-action='hint']")?.addEventListener("click", () => {
      hintsUsed = Math.min(expectedAnswer(item).length, hintsUsed + 1);
      session.hints += 1;
      renderCurrent();
    });
    app.querySelector("[data-action='reveal']")?.addEventListener("click", () => finishAnswer(item, false, true));
    app.querySelector("[data-action='submit']")?.addEventListener("click", () => submitAnswer(item));
    app.querySelector(".answer-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitAnswer(item);
    });
  }

  function submitAnswer(item) {
    const input = app.querySelector(".answer-input");
    const answer = input.value.trim();
    const correct = answer.toLowerCase() === expectedAnswer(item).toLowerCase();
    finishAnswer(item, correct, false, answer);
  }

  async function finishAnswer(item, correct, showAnswer, submittedAnswer = "") {
    if (revealed) return;
    revealed = true;
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const expected = expectedAnswer(item);
    const rating = calculateRating(item.card, correct, showAnswer, hintsUsed, durationMs);
    const result = scheduleCard(item.card, rating);
    const feedback = app.querySelector(".feedback");
    const input = app.querySelector(".answer-input");
    const submitButton = app.querySelector("[data-action='submit']");

    if (input) {
      input.disabled = true;
      input.classList.add(correct ? "answer-correct" : "answer-wrong");
    }
    if (submitButton) submitButton.disabled = true;
    feedback.innerHTML = correct
      ? `<strong class="correct-text">拼写正确</strong><span>${ratingLabel(rating)}</span>`
      : `<strong class="wrong-text">正确答案：${escapeHtml(expected)}</strong><span>${ratingLabel(rating)}</span>`;

    await sendMessage({
      type: "BVA_REVIEW_RESULT",
      payload: {
        cardId: item.card.id,
        contextId: item.context.id,
        answer: submittedAnswer,
        expected,
        correct,
        rating,
        durationMs,
        hintsUsed,
        attempts: 1,
        reviewedAt: new Date().toISOString(),
        fsrs: serializeFsrsCard(result.card),
        fsrsLog: serializeFsrsLog(result.log)
      }
    });

    item.card = { ...item.card, ...result.card, fsrs: serializeFsrsCard(result.card), state: stateLabel(result.card.state), reviewCount: result.card.reps };
    session.reviewed += 1;
    session.totalDuration += durationMs;
    correct ? session.correct += 1 : session.wrong += 1;

    if (!correct && (item.retryCount || 0) < 2) {
      const retry = { ...item, isNew: false, retryCount: (item.retryCount || 0) + 1 };
      queue.splice(Math.min(queue.length, currentIndex + 4), 0, retry);
    }

    const continueButton = document.createElement("button");
    continueButton.className = "primary continue-button";
    continueButton.textContent = "继续";
    continueButton.addEventListener("click", advance);
    app.querySelector(".test-actions").append(continueButton);
    continueButton.focus();
  }

  function advance() {
    currentIndex += 1;
    if (currentIndex >= queue.length) {
      renderComplete();
      return;
    }
    prepareCurrent();
  }

  function scheduleCard(card, rating) {
    const now = new Date();
    const input = card.fsrs ? hydrateFsrsCard(card.fsrs) : FSRS.createEmptyCard(new Date(card.createdAt || now));
    return scheduler.next(input, now, rating);
  }

  function calculateRating(card, correct, showAnswer, hintCount, durationMs) {
    if (!correct || showAnswer) return FSRS.Rating.Again;
    if (hintCount > 0) return FSRS.Rating.Hard;
    if ((card.reviewCount || 0) >= 3 && durationMs <= 4000) return FSRS.Rating.Easy;
    return FSRS.Rating.Good;
  }

  function renderComplete(dashboard) {
    const accuracy = session.reviewed ? Math.round(session.correct / session.reviewed * 100) : 0;
    const average = session.reviewed ? Math.round(session.totalDuration / session.reviewed / 100) / 10 : 0;
    app.innerHTML = `
      <main class="complete">
        <div class="complete-mark">✓</div>
        <h1>本轮学习完成</h1>
        <p>你可以继续加入新词，也可以先结束，让 FSRS 安排下一次复习。</p>
        <div class="summary">
          <div><strong>${session.reviewed}</strong><span>完成</span></div>
          <div><strong>${accuracy}%</strong><span>正确率</span></div>
          <div><strong>${average}s</strong><span>平均耗时</span></div>
          <div><strong>${session.hints}</strong><span>使用提示</span></div>
        </div>
        <div class="complete-actions">
          <button class="secondary" data-action="more-10">继续学习 10 个新词</button>
          <button class="secondary" data-action="all-new">学习全部待学词</button>
          <button class="primary" data-action="finish">结束本次学习</button>
        </div>
      </main>
    `;
    app.querySelector("[data-action='more-10']").addEventListener("click", () => loadQueue("more-10", false));
    app.querySelector("[data-action='all-new']").addEventListener("click", () => loadQueue("all-new", false));
    app.querySelector("[data-action='finish']").addEventListener("click", () => window.close());
  }

  function renderLoading() {
    app.innerHTML = `<main class="loading">正在生成今天的复习队列...</main>`;
  }

  function expectedAnswer(item) {
    return (item.context.surfaceForm || item.card.word || item.card.lemma).trim();
  }

  function buildCloze(sentence, surfaceForm) {
    if (!sentence) return "根据中文释义拼写单词";
    const pattern = new RegExp(`\\b${escapeRegExp(surfaceForm)}\\b`, "i");
    const blank = "＿".repeat(Math.max(3, surfaceForm.length));
    const result = sentence.replace(pattern, blank);
    return result === sentence ? `${sentence}  ${blank}` : result;
  }

  function hydrateFsrsCard(card) {
    return {
      ...card,
      due: new Date(card.due),
      last_review: card.last_review ? new Date(card.last_review) : undefined
    };
  }

  function serializeFsrsCard(card) {
    return {
      ...card,
      due: new Date(card.due).toISOString(),
      last_review: card.last_review ? new Date(card.last_review).toISOString() : null
    };
  }

  function serializeFsrsLog(log) {
    return {
      ...log,
      due: new Date(log.due).toISOString(),
      review: new Date(log.review).toISOString(),
      last_review: log.last_review ? new Date(log.last_review).toISOString() : null
    };
  }

  function stateLabel(state) {
    return state === FSRS.State.New ? "new" : state === FSRS.State.Learning || state === FSRS.State.Relearning ? "learning" : "review";
  }

  function ratingLabel(rating) {
    return {
      [FSRS.Rating.Again]: "稍后会再次出现",
      [FSRS.Rating.Hard]: "使用提示，缩短复习间隔",
      [FSRS.Rating.Good]: "正常安排下次复习",
      [FSRS.Rating.Easy]: "掌握稳定，延长复习间隔"
    }[rating] || "";
  }

  function speak(word) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    speechSynthesis.speak(utterance);
  }

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message).then((response) => {
      if (!response?.ok) throw new Error(response?.error || "操作失败");
      return response.result;
    });
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
