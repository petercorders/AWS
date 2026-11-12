import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  grade,
  validateState,
  selectQuestions,
  submitAnswer,
  loadState,
  saveState,
  STORAGE_KEY,
} from "../assets/core.js";

const bank = [
  {
    id: 1,
    text: "S3 storage",
    options: { A: "one", B: "two", C: "three" },
    answer: ["A", "C"],
  },
  {
    id: 2,
    text: "EC2 compute",
    options: { A: "one", B: "two" },
    answer: ["B"],
  },
];

test("복수 선택은 순서에 관계없이 완전 일치만 정답", () => {
  assert.equal(grade(bank[0], ["C", "A"]), true);
  assert.equal(grade(bank[0], ["A"]), false);
  assert.equal(grade(bank[0], ["A", "B"]), false);
  assert.equal(grade(bank[0], ["A", "C", "B"]), false);
  assert.equal(grade(bank[0], ["A", "A", "C"]), false);
});

test("선택 중인 답·순서·위치·기록을 백업 왕복으로 보존", () => {
  const state = emptyState();
  state.session = {
    mode: "all",
    ids: [2, 1],
    index: 1,
    drafts: { 1: ["C"] },
    results: {},
  };
  state.bookmarks = [2];
  assert.deepEqual(
    validateState(JSON.parse(JSON.stringify(state)), bank),
    state,
  );
});

test("중복 제출을 세지 않고 재학습으로 맞힌 문제는 오답에서 제외", () => {
  const state = emptyState();
  state.session = {
    mode: "all",
    ids: [1],
    index: 0,
    drafts: { 1: ["A", "B"] },
    results: {},
  };
  submitAnswer(state, bank[0]);
  submitAnswer(state, bank[0]);
  assert.equal(state.history[1].attempts, 1);
  assert.deepEqual(
    selectQuestions(bank, state, "wrong").map((q) => q.id),
    [1],
  );
  state.session.results = {};
  state.session.drafts[1] = ["A", "C"];
  submitAnswer(state, bank[0]);
  assert.equal(state.history[1].attempts, 2);
  assert.deepEqual(selectQuestions(bank, state, "wrong"), []);
});

test("잘못된 백업·없는 문제·없는 선택지·범위 밖 값을 거절", () => {
  const invalid = [
    null,
    {},
    { ...emptyState(), version: 2 },
    { ...emptyState(), bookmarks: [999] },
    {
      ...emptyState(),
      history: { 1: { selected: ["Z"], attempts: 1, at: "now" } },
    },
    {
      ...emptyState(),
      session: { mode: "all", ids: [1, 1], index: 0, drafts: {}, results: {} },
    },
    {
      ...emptyState(),
      session: { mode: "all", ids: [1], index: 8, drafts: {}, results: {} },
    },
    {
      ...emptyState(),
      session: {
        mode: "all",
        ids: [1],
        index: 0,
        drafts: { 2: ["A"] },
        results: {},
      },
    },
  ];
  for (const value of invalid) assert.throws(() => validateState(value, bank));
});

test("손상된 기록을 자동 덮어쓰지 않고 저장 실패를 알림", () => {
  const storage = {
    getItem: () => "{broken",
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.equal(loadState(storage, bank).status, "corrupt");
  assert.equal(saveState(storage, emptyState()).ok, false);
  assert.equal(loadState({ getItem: () => null }, bank).status, "empty");
  const stored = JSON.stringify(emptyState());
  assert.equal(
    loadState(
      {
        getItem: (key) => {
          assert.equal(key, STORAGE_KEY);
          return stored;
        },
      },
      bank,
    ).status,
    "ok",
  );
});

test("검색과 필터를 함께 적용하고 원본 상태를 유지", () => {
  const state = emptyState();
  state.bookmarks = [1];
  assert.deepEqual(
    selectQuestions(bank, state, "bookmarks", "s3").map((q) => q.id),
    [1],
  );
  assert.deepEqual(selectQuestions(bank, state, "bookmarks", "EC2"), []);
  assert.deepEqual(
    selectQuestions(bank, state, "all", "#2").map((q) => q.id),
    [2],
  );
  assert.deepEqual(
    selectQuestions(bank, state, "unseen").map((q) => q.id),
    [1, 2],
  );
});
