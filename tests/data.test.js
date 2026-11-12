import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { emptyState, validateState } from "../assets/core.js";

test("문제 전체의 ID·본문·선택지·정답 및 출처 검증", async () => {
  const bank = JSON.parse(
    await readFile(new URL("../data/questions.json", import.meta.url)),
  );
  const source = JSON.parse(
    await readFile(new URL("../data/source.json", import.meta.url)),
  );
  assert.equal(bank.length, source.count);
  assert.ok(bank.length >= 900);
  assert.ok(bank.length + source.excluded.length >= 1000);
  assert.equal(new Set(bank.map((q) => q.id)).size, bank.length);
  for (const q of bank) {
    assert.ok(Number.isSafeInteger(q.id) && q.id > 0);
    assert.ok(q.text.length > 10);
    assert.ok(
      Object.values(q.options).every((v) => typeof v === "string" && v.length),
    );
    assert.ok(
      q.answer.length > 0 && q.answer.every((k) => Object.hasOwn(q.options, k)),
    );
    const state = emptyState();
    state.session = {
      mode: "all",
      ids: [q.id],
      index: 0,
      drafts: { [q.id]: q.answer },
      results: { [q.id]: q.answer },
    };
    assert.deepEqual(validateState(state, bank), state);
  }
  assert.match(source.commit, /^[a-f0-9]{40}$/);
});
