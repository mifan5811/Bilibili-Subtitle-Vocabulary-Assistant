const DB_NAME = "bilibili-vocab-learning";
const DB_VERSION = 1;
const LEGACY_STORAGE_KEY = "vocabulary";

chrome.runtime.onInstalled.addListener(() => {
  void initializeDatabase();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeDatabase();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

async function handleMessage(message, sender) {
  await initializeDatabase();
  switch (message?.type) {
    case "BVA_SAVE_CARD":
      return saveVocabularyCard(message.card);
    case "BVA_DASHBOARD":
      return getDashboard();
    case "BVA_LIST_CARDS":
      return listCardsWithContexts();
    case "BVA_DELETE_CARD":
      return deleteCard(message.cardId);
    case "BVA_SET_CARD_STATE":
      return setCardState(message.cardId, message.state);
    case "BVA_GET_REVIEW_QUEUE":
      return buildReviewQueue(message.mode || "default");
    case "BVA_REVIEW_RESULT":
      return saveReviewResult(message.payload);
    case "BVA_GET_SETTINGS":
      return getSettings();
    case "BVA_SET_SETTINGS":
      return setSettings(message.settings || {});
    case "BVA_CAPTURE_VISIBLE_TAB":
      return captureVisibleTab(sender.tab?.windowId);
    default:
      throw new Error("Unknown message type.");
  }
}

let databasePromise;
let initializationPromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      const cards = db.createObjectStore("cards", { keyPath: "id" });
      cards.createIndex("lemma", "lemma", { unique: true });
      cards.createIndex("due", "due");
      cards.createIndex("state", "state");
      cards.createIndex("updatedAt", "updatedAt");

      const contexts = db.createObjectStore("contexts", { keyPath: "id" });
      contexts.createIndex("cardId", "cardId");
      contexts.createIndex("createdAt", "createdAt");

      const logs = db.createObjectStore("reviewLogs", { keyPath: "id", autoIncrement: true });
      logs.createIndex("cardId", "cardId");
      logs.createIndex("reviewedAt", "reviewedAt");

      db.createObjectStore("settings", { keyPath: "key" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

function initializeDatabase() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    await openDatabase();
    await ensureDefaultSettings();
    await migrateLegacyStorage();
  })().catch((error) => {
    initializationPromise = null;
    throw error;
  });
  return initializationPromise;
}

async function ensureDefaultSettings() {
  const settings = await getRecord("settings", "learning");
  if (settings) return;
  await putRecord("settings", {
    key: "learning",
    newWordTarget: 30,
    autoSpeak: true,
    showTranslation: true
  });
}

async function migrateLegacyStorage() {
  const marker = await getRecord("meta", "legacyMigrationV1");
  if (marker) return;

  const data = await chrome.storage.local.get({ [LEGACY_STORAGE_KEY]: [] });
  for (const raw of data[LEGACY_STORAGE_KEY] || []) {
    const card = normalizeLegacyCard(raw);
    const contexts = Array.isArray(raw.contexts) && raw.contexts.length
      ? raw.contexts
      : [{
          sentence: raw.sentence || "",
          videoTitle: raw.videoTitle || "",
          videoUrl: raw.videoUrl || "",
          timestamp: Number(raw.timestamp) || 0,
          subtitleSource: raw.subtitleSource || "legacy",
          surfaceForm: raw.word || card.word,
          createdAt: raw.createdAt || new Date().toISOString()
        }];
    await saveVocabularyCard({ ...card, contexts });
  }

  await putRecord("meta", {
    key: "legacyMigrationV1",
    migratedAt: new Date().toISOString(),
    sourceCount: (data[LEGACY_STORAGE_KEY] || []).length
  });
}

function normalizeLegacyCard(raw) {
  const now = raw.createdAt || new Date().toISOString();
  return {
    word: raw.word || raw.normalizedWord || "",
    lemma: raw.lemma || raw.normalizedWord || normalizeWord(raw.word || ""),
    phonetic: raw.phonetic || "",
    partOfSpeech: raw.partOfSpeech || "",
    translationZh: raw.translationZh || raw.definition || "",
    definitionMissing: Boolean(raw.definitionMissing ?? raw.definition_missing),
    state: raw.state || "new",
    due: raw.due || now,
    stability: Number(raw.stability) || 0,
    difficulty: Number(raw.difficulty) || 0,
    reviewCount: Number(raw.reviewCount) || 0,
    createdAt: now,
    updatedAt: raw.updatedAt || now,
    fsrs: raw.fsrs || null
  };
}

async function saveVocabularyCard(input) {
  const now = new Date().toISOString();
  const existing = await getByIndex("cards", "lemma", input.lemma);
  const card = existing || {
    id: crypto.randomUUID(),
    word: input.word,
    lemma: input.lemma,
    state: "new",
    due: now,
    stability: 0,
    difficulty: 0,
    reviewCount: 0,
    contextCursor: 0,
    createdAt: now,
    fsrs: null
  };

  Object.assign(card, {
    word: card.word || input.word,
    phonetic: input.phonetic || card.phonetic || "",
    partOfSpeech: input.partOfSpeech || card.partOfSpeech || "",
    translationZh: input.translationZh || card.translationZh || "",
    definitionMissing: Boolean(input.definitionMissing),
    updatedAt: now
  });
  await putRecord("cards", card);

  const contexts = input.contexts || (input.context ? [input.context] : []);
  const existingContexts = await getAllByIndex("contexts", "cardId", card.id);
  for (const context of contexts) {
    const duplicate = existingContexts.some(
      (item) =>
        item.videoUrl === context.videoUrl &&
        Math.floor(item.timestamp || 0) === Math.floor(context.timestamp || 0) &&
        normalizeWord(item.surfaceForm || "") === normalizeWord(context.surfaceForm || input.word)
    );
    if (duplicate) continue;
    await putRecord("contexts", {
      id: crypto.randomUUID(),
      cardId: card.id,
      sentence: context.sentence || "",
      videoTitle: context.videoTitle || "",
      videoUrl: context.videoUrl || "",
      timestamp: Number(context.timestamp) || 0,
      subtitleSource: context.subtitleSource || "bilibili",
      surfaceForm: context.surfaceForm || input.word || card.lemma,
      createdAt: context.createdAt || now
    });
  }

  return { cardId: card.id };
}

async function getDashboard() {
  const [cards, contexts, logs, settings] = await Promise.all([
    getAllRecords("cards"),
    getAllRecords("contexts"),
    getAllRecords("reviewLogs"),
    getSettings()
  ]);
  const now = Date.now();
  const due = cards.filter((card) => card.state !== "new" && card.state !== "mastered" && new Date(card.due).getTime() <= now);
  const newCards = cards.filter((card) => card.state === "new");
  const recommendation = calculateNewRecommendation(settings.newWordTarget, due.length, logs);
  const today = localDateKey(new Date());
  const studiedToday = logs.filter((log) => localDateKey(new Date(log.reviewedAt)) === today);
  const learnedNewToday = studiedToday.filter((log) => log.wasNew).length;
  const remainingRecommended = Math.max(0, recommendation - learnedNewToday);

  return {
    totalCards: cards.length,
    totalContexts: contexts.length,
    dueCount: due.length,
    newCount: newCards.length,
    newRecommendation: recommendation,
    remainingRecommended: Math.min(remainingRecommended, newCards.length),
    reviewedToday: studiedToday.length,
    streak: calculateStreak(logs),
    estimatedMinutes: Math.max(1, Math.ceil((due.length + Math.min(remainingRecommended, newCards.length)) * 12 / 60)),
    settings
  };
}

function calculateNewRecommendation(target, dueCount, logs) {
  let value = target;
  if (dueCount > 160) value -= 25;
  else if (dueCount > 100) value -= 20;
  else if (dueCount > 60) value -= 10;
  else if (dueCount > 30) value -= 5;

  const recent = [...logs].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)).slice(0, 50);
  if (recent.length >= 10) {
    const failureRate = recent.filter((log) => log.rating === 1).length / recent.length;
    if (failureRate > 0.4) value -= 10;
    else if (failureRate > 0.25) value -= 5;
  }
  return Math.max(5, Math.min(target, value));
}

async function buildReviewQueue(mode) {
  const [cards, contexts, dashboard] = await Promise.all([
    getAllRecords("cards"),
    getAllRecords("contexts"),
    getDashboard()
  ]);
  const contextMap = groupBy(contexts, "cardId");
  const now = Date.now();
  const dueCards = cards
    .filter((card) => card.state !== "new" && card.state !== "mastered" && new Date(card.due).getTime() <= now)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  const newCards = cards
    .filter((card) => card.state === "new")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let selectedNew = [];
  if (mode === "all-new") selectedNew = newCards;
  else if (mode === "more-10") selectedNew = newCards.slice(0, 10);
  else selectedNew = newCards.slice(0, dashboard.remainingRecommended);

  const selected = mode === "default" ? [...dueCards, ...selectedNew] : selectedNew;
  return {
    items: selected.map((card) => {
      const cardContexts = contextMap.get(card.id) || [];
      const index = cardContexts.length ? (card.contextCursor || card.reviewCount || 0) % cardContexts.length : 0;
      return {
        card,
        context: cardContexts[index] || {
          id: "",
          cardId: card.id,
          sentence: "",
          surfaceForm: card.word || card.lemma,
          videoTitle: "",
          videoUrl: "",
          timestamp: 0
        },
        isNew: card.state === "new"
      };
    }),
    dashboard
  };
}

async function saveReviewResult(payload) {
  const card = await getRecord("cards", payload.cardId);
  if (!card) throw new Error("Card not found.");
  const wasNew = card.state === "new";
  const now = payload.reviewedAt || new Date().toISOString();
  const fsrs = payload.fsrs;
  const state = fsrsStateLabel(fsrs?.state);

  Object.assign(card, {
    state,
    due: fsrs?.due || now,
    stability: Number(fsrs?.stability) || 0,
    difficulty: Number(fsrs?.difficulty) || 0,
    reviewCount: Number(fsrs?.reps) || card.reviewCount + 1,
    contextCursor: (card.contextCursor || 0) + 1,
    fsrs,
    updatedAt: now
  });
  await putRecord("cards", card);
  await addRecord("reviewLogs", {
    cardId: card.id,
    contextId: payload.contextId || "",
    answer: payload.answer || "",
    expected: payload.expected || "",
    correct: Boolean(payload.correct),
    rating: Number(payload.rating),
    durationMs: Number(payload.durationMs) || 0,
    hintsUsed: Number(payload.hintsUsed) || 0,
    attempts: Number(payload.attempts) || 1,
    wasNew,
    reviewedAt: now,
    fsrsLog: payload.fsrsLog || null
  });
  return { card };
}

async function listCardsWithContexts() {
  const [cards, contexts] = await Promise.all([getAllRecords("cards"), getAllRecords("contexts")]);
  const contextMap = groupBy(contexts, "cardId");
  return cards
    .map((card) => ({ ...card, contexts: contextMap.get(card.id) || [] }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function deleteCard(cardId) {
  const db = await openDatabase();
  const tx = db.transaction(["cards", "contexts", "reviewLogs"], "readwrite");
  tx.objectStore("cards").delete(cardId);
  await deleteByIndex(tx.objectStore("contexts").index("cardId"), cardId);
  await deleteByIndex(tx.objectStore("reviewLogs").index("cardId"), cardId);
  await transactionDone(tx);
}

async function setCardState(cardId, state) {
  const card = await getRecord("cards", cardId);
  if (!card) throw new Error("Card not found.");
  const now = new Date().toISOString();
  if (state === "mastered") {
    card.state = "mastered";
  } else if (state === "new") {
    card.state = "new";
    card.due = now;
    card.stability = 0;
    card.difficulty = 0;
    card.reviewCount = 0;
    card.fsrs = null;
  } else {
    throw new Error("Unsupported card state.");
  }
  card.updatedAt = now;
  await putRecord("cards", card);
  return card;
}

async function getSettings() {
  const record = await getRecord("settings", "learning");
  return record || { key: "learning", newWordTarget: 30, autoSpeak: true, showTranslation: true };
}

async function setSettings(input) {
  const current = await getSettings();
  const next = {
    ...current,
    newWordTarget: Math.max(5, Math.min(100, Number(input.newWordTarget ?? current.newWordTarget))),
    autoSpeak: input.autoSpeak ?? current.autoSpeak,
    showTranslation: input.showTranslation ?? current.showTranslation
  };
  await putRecord("settings", next);
  return next;
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message || "Screenshot failed.")) : resolve({ dataUrl });
    });
  });
}

function fsrsStateLabel(state) {
  if (state === 0 || state === "New") return "new";
  if (state === 1 || state === "Learning") return "learning";
  if (state === 2 || state === "Review") return "review";
  if (state === 3 || state === "Relearning") return "learning";
  return "review";
}

function calculateStreak(logs) {
  const days = new Set(logs.map((log) => localDateKey(new Date(log.reviewedAt))));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeWord(word) {
  return String(word).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase();
}

function groupBy(items, key) {
  const result = new Map();
  for (const item of items) {
    const value = item[key];
    if (!result.has(value)) result.set(value, []);
    result.get(value).push(item);
  }
  return result;
}

async function getRecord(storeName, key) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName).objectStore(storeName).get(key));
}

async function getByIndex(storeName, indexName, key) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName).objectStore(storeName).index(indexName).get(key));
}

async function getAllByIndex(storeName, indexName, key) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName).objectStore(storeName).index(indexName).getAll(key));
}

async function getAllRecords(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName).objectStore(storeName).getAll());
}

async function putRecord(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
}

async function addRecord(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).add(value);
  await transactionDone(tx);
}

function deleteByIndex(index, key) {
  return new Promise((resolve, reject) => {
    const request = index.openKeyCursor(IDBKeyRange.only(key));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted."));
  });
}
