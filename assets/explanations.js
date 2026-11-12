const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const requireValid = (condition) => {
  if (!condition) throw new Error("현재 문제와 해설 자료가 일치하지 않아요.");
};
const hasKorean = (value) =>
  typeof value === "string" && value.length >= 8 && /[가-힣]/.test(value);
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

export async function sha256Text(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function validateExplanations(raw, bank, corpusHash) {
  requireValid(
    isObject(raw) &&
      raw.version === 1 &&
      raw.language === "ko" &&
      raw.corpusSha256 === corpusHash,
  );
  requireValid(
    Array.isArray(raw.entries) && raw.entries.length === bank.length,
  );
  const questions = new Map(bank.map((q) => [q.id, q]));
  const entries = new Map();
  for (const entry of raw.entries) {
    requireValid(
      isObject(entry) && questions.has(entry.id) && !entries.has(entry.id),
    );
    const q = questions.get(entry.id);
    requireValid(hasKorean(entry.summary) && isObject(entry.options));
    requireValid(
      Object.keys(entry.options).length === Object.keys(q.options).length,
    );
    requireValid(
      Object.keys(q.options).every((key) => hasKorean(entry.options[key])),
    );
    requireValid(
      Array.isArray(entry.references) &&
        entry.references.length > 0 &&
        entry.references.length <= 8,
    );
    for (const reference of entry.references) {
      requireValid(
        isObject(reference) &&
          typeof reference.title === "string" &&
          reference.title.trim().length > 0,
      );
      const url = new URL(reference.url);
      requireValid(
        url.protocol === "https:" &&
          ["docs.aws.amazon.com", "aws.amazon.com"].includes(url.hostname) &&
          !url.username &&
          !url.password,
      );
    }
    if (entry.reviewNote !== undefined)
      requireValid(hasKorean(entry.reviewNote));
    if (entry.suggestedAnswer !== undefined) {
      requireValid(
        hasKorean(entry.reviewNote) &&
          Array.isArray(entry.suggestedAnswer) &&
          entry.suggestedAnswer.length > 0,
      );
      requireValid(
        new Set(entry.suggestedAnswer).size === entry.suggestedAnswer.length &&
          entry.suggestedAnswer.every((key) => Object.hasOwn(q.options, key)),
      );
    }
    entries.set(entry.id, entry);
  }
  return entries;
}

export function renderExplanation(question, entry, selected) {
  const esc = escapeHtml;
  const learningAnswer = entry.suggestedAnswer || question.answer;
  const review = entry.reviewNote
    ? `<aside class="answer-review"><h4>출처 정답 재검토</h4><p>${esc(entry.reviewNote)}</p>${entry.suggestedAnswer ? `<p>해설에서 권장하는 답: <strong>${entry.suggestedAnswer.map(esc).join(", ")}</strong></p>` : ""}<p class="review-foot">자동 채점은 출처 정답 기준이에요. 해설의 판단과 함께 비교해 주세요.</p></aside>`
    : "";
  const choice = (key) =>
    `<div class="choice-reason ${learningAnswer.includes(key) ? "recommended" : ""}"><div class="choice-reason-label"><span class="reason-letter">${esc(key)}</span>${question.answer.includes(key) ? '<span class="reason-tag">출처 정답</span>' : ""}${entry.suggestedAnswer?.includes(key) ? '<span class="reason-tag">해설 권장</span>' : ""}${selected.includes(key) ? '<span class="reason-tag selected">내 선택</span>' : ""}</div><p>${esc(entry.options[key])}</p></div>`;
  const important = Object.keys(question.options).filter(
    (key) =>
      selected.includes(key) ||
      learningAnswer.includes(key) ||
      question.answer.includes(key),
  );
  const others = Object.keys(question.options).filter(
    (key) => !important.includes(key),
  );
  return `<section class="explanation" aria-label="한국어 학습 해설" lang="ko">${review}<div class="explanation-heading"><h3>핵심 해설</h3><span>한국어 학습 해설</span></div><p class="explanation-summary">${esc(entry.summary)}</p><h4 class="reason-heading">정답과 내 선택의 이유</h4><div class="choice-reasons">${important.map(choice).join("")}</div>${others.length ? `<details class="other-reasons"><summary>다른 선택지의 이유 (${others.length}개)</summary><div class="choice-reasons">${others.map(choice).join("")}</div></details>` : ""}<div class="explanation-references"><h4>관련 AWS 공식 문서</h4><ul>${entry.references.map((reference) => `<li><a href="${esc(reference.url)}" target="_blank" rel="noopener noreferrer">${esc(reference.title)} ↗</a></li>`).join("")}</ul><p>공식 문서를 참고해 작성한 학습용 설명이에요. AWS 공식 시험 해설은 아니에요.</p></div></section>`;
}
