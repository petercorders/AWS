export const STORAGE_KEY = "aws-saa-study:v1";
export const MODES = {
  all: "전체 문제",
  unseen: "아직 안 푼 문제",
  wrong: "오답 다시 풀기",
  bookmarks: "북마크",
  random: "랜덤 20문제",
};
export const emptyState = () => ({
  version: 1,
  history: {},
  bookmarks: [],
  session: null,
});
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ensure = (condition) => {
  if (!condition)
    throw new Error(
      "학습 기록 형식이 올바르지 않아요. 이 사이트에서 내보낸 백업인지 확인해 주세요.",
    );
};

export function grade(question, selected) {
  return (
    Array.isArray(selected) &&
    new Set(selected).size === selected.length &&
    selected.length === question.answer.length &&
    question.answer.every((key) => selected.includes(key))
  );
}

export function validateState(raw, bank) {
  ensure(
    object(raw) &&
      raw.version === 1 &&
      object(raw.history) &&
      Array.isArray(raw.bookmarks),
  );
  const byId = new Map(bank.map((q) => [q.id, q]));
  const idValid = (id) => Number.isSafeInteger(id) && byId.has(id);
  const selection = (id, values, required = false) => {
    ensure(
      Array.isArray(values) &&
        values.length <= byId.get(id).answer.length &&
        (!required || values.length === byId.get(id).answer.length),
    );
    ensure(
      new Set(values).size === values.length &&
        values.every((k) => Object.hasOwn(byId.get(id).options, k)),
    );
    return [...values];
  };
  const state = emptyState();
  ensure(
    raw.bookmarks.length <= bank.length &&
      new Set(raw.bookmarks).size === raw.bookmarks.length,
  );
  ensure(raw.bookmarks.every(idValid));
  state.bookmarks = [...raw.bookmarks];
  ensure(Object.keys(raw.history).length <= bank.length);
  for (const [key, record] of Object.entries(raw.history)) {
    const id = Number(key);
    ensure(String(id) === key && idValid(id) && object(record));
    ensure(
      Number.isSafeInteger(record.attempts) &&
        record.attempts > 0 &&
        record.attempts < 1e9,
    );
    ensure(
      typeof record.at === "string" &&
        record.at.length <= 32 &&
        Number.isFinite(Date.parse(record.at)),
    );
    state.history[id] = {
      selected: selection(id, record.selected, true),
      attempts: record.attempts,
      at: record.at,
    };
  }
  if (raw.session !== null) {
    const s = raw.session;
    ensure(object(s) && Object.hasOwn(MODES, s.mode) && Array.isArray(s.ids));
    ensure(
      s.ids.length > 0 &&
        s.ids.length <= bank.length &&
        s.ids.every(idValid) &&
        new Set(s.ids).size === s.ids.length,
    );
    ensure(
      Number.isInteger(s.index) &&
        s.index >= 0 &&
        s.index < s.ids.length &&
        object(s.drafts) &&
        object(s.results),
    );
    const session = {
      mode: s.mode,
      ids: [...s.ids],
      index: s.index,
      drafts: {},
      results: {},
    };
    for (const field of ["drafts", "results"]) {
      ensure(Object.keys(s[field]).length <= s.ids.length);
      for (const [key, values] of Object.entries(s[field])) {
        const id = Number(key);
        ensure(String(id) === key && s.ids.includes(id));
        session[field][id] = selection(id, values, field === "results");
      }
    }
    state.session = session;
  }
  return state;
}

export function selectQuestions(bank, state, mode = "all", query = "") {
  const term = query.trim().toLowerCase();
  return bank.filter((q) => {
    if (mode === "unseen" && state.history[q.id]) return false;
    if (
      mode === "wrong" &&
      (!state.history[q.id] || grade(q, state.history[q.id].selected))
    )
      return false;
    if (mode === "bookmarks" && !state.bookmarks.includes(q.id)) return false;
    return (
      !term ||
      `#${q.id}` === term ||
      `${q.id} ${q.text} ${Object.values(q.options).join(" ")}`
        .toLowerCase()
        .includes(term)
    );
  });
}

export function submitAnswer(state, question) {
  const s = state.session;
  if (
    !s ||
    s.ids[s.index] !== question.id ||
    Object.hasOwn(s.results, question.id)
  )
    return false;
  const selected = s.drafts[question.id] || [];
  if (selected.length !== question.answer.length) return false;
  s.results[question.id] = [...selected];
  state.history[question.id] = {
    selected: [...selected],
    attempts: (state.history[question.id]?.attempts || 0) + 1,
    at: new Date().toISOString(),
  };
  return true;
}

export function loadState(storage, bank) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { status: "unavailable", state: emptyState() };
  }
  if (raw === null) return { status: "empty", state: emptyState() };
  try {
    return { status: "ok", state: validateState(JSON.parse(raw), bank) };
  } catch {
    return { status: "corrupt", state: emptyState(), raw };
  }
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
