import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  validateExplanations,
  renderExplanation,
} from "../assets/explanations.js";

const q = {
  id: 1,
  text: "A question",
  options: { A: "one", B: "two", C: "three" },
  answer: ["A"],
};
const entry = {
  id: 1,
  summary:
    "인터넷 없이 S3에 접근해야 하므로 네트워크 경로를 제공하는 엔드포인트가 핵심이에요.",
  options: {
    A: "게이트웨이 엔드포인트는 인터넷 연결 없이 S3 경로를 제공해요.",
    B: "IAM 역할은 권한을 부여하지만 네트워크 경로를 만들지 않아요.",
    C: "CloudWatch Logs로 로그를 옮겨도 EC2에서 S3로 가는 비공개 경로는 생기지 않아요.",
  },
  references: [
    {
      title: "S3 gateway endpoints",
      url: "https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html",
    },
  ],
};
const bundle = () => ({
  version: 1,
  corpusSha256: "hash",
  language: "ko",
  entries: [structuredClone(entry)],
});

test("해설은 질문 파일 해시와 전체 ID·선택지가 일치해야 한다", () => {
  assert.equal(validateExplanations(bundle(), [q], "hash").get(1).id, 1);
  for (const edit of [
    (value) => {
      value.corpusSha256 = "old";
    },
    (value) => {
      value.entries = [];
    },
    (value) => {
      value.entries.push(structuredClone(entry));
    },
    (value) => {
      value.entries[0].id = 2;
    },
    (value) => {
      delete value.entries[0].options.B;
    },
    (value) => {
      value.entries[0].options.D = "없는 선택지";
    },
    (value) => {
      value.entries[0].summary = "";
    },
  ]) {
    const value = bundle();
    edit(value);
    assert.throws(() => validateExplanations(value, [q], "hash"));
  }
});

test("공식 HTTPS 근거만 허용하고 검토 답안은 실제 선택지만 참조한다", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://docs.aws.amazon.com.example.org/a",
    "http://docs.aws.amazon.com/a",
    "https://example.com/",
  ]) {
    const value = bundle();
    value.entries[0].references[0].url = url;
    assert.throws(() => validateExplanations(value, [q], "hash"));
  }
  const value = bundle();
  value.entries[0].suggestedAnswer = ["Z"];
  value.entries[0].reviewNote = "출처 정답 검토";
  assert.throws(() => validateExplanations(value, [q], "hash"));
});

test("선택지별 이유·공식 링크를 보여주고 입력 HTML을 이스케이프한다", () => {
  const value = {
    ...entry,
    summary: "<script>alert(1)</script>을 실행하지 않아요.",
  };
  const html = renderExplanation(q, value, ["B"]);
  assert.ok(
    html.includes("핵심 해설") &&
      html.includes(entry.options.A) &&
      html.includes(entry.options.B),
  );
  assert.ok(html.includes("내 선택") && html.includes("출처 정답"));
  assert.ok(
    html.includes('class="other-reasons"') && html.includes(entry.options.C),
  );
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
});

test("출처 정답과 해설 판단 차이를 드러내고 원본 정답·진도를 변경하지 않는다", () => {
  const before = JSON.stringify(q);
  const html = renderExplanation(
    q,
    {
      ...entry,
      reviewNote: "권한만으로 네트워크 경로가 생기지는 않아요.",
      suggestedAnswer: ["B"],
    },
    ["B"],
  );
  assert.ok(
    html.includes("출처 정답 재검토") && html.includes("해설에서 권장하는 답"),
  );
  assert.ok(html.includes("B"));
  assert.equal(JSON.stringify(q), before);
});

test("999문제 전체의 해설과 모든 선택지 이유를 현재 문제 버전에 연결", async () => {
  const corpus = await readFile(
    new URL("../data/questions.json", import.meta.url),
  );
  const questions = JSON.parse(corpus);
  const explanations = JSON.parse(
    await readFile(new URL("../data/explanations.json", import.meta.url)),
  );
  const hash = createHash("sha256").update(corpus).digest("hex");
  const result = validateExplanations(explanations, questions, hash);
  assert.equal(result.size, 999);
  for (const question of questions) {
    const explanation = result.get(question.id);
    const html = renderExplanation(question, explanation, question.answer);
    assert.ok(html.includes("핵심 해설"));
    assert.equal(
      Object.keys(explanation.options).length,
      Object.keys(question.options).length,
    );
  }
});
