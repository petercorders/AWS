import {
  STORAGE_KEY,
  MODES,
  emptyState,
  grade,
  validateState,
  selectQuestions,
  submitAnswer,
  loadState,
  saveState,
} from "./core.js";
import {
  sha256Text,
  validateExplanations,
  renderExplanation,
} from "./explanations.js";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const main = $("#main");
let bank = [],
  byId,
  source,
  state,
  storage,
  corruptRaw = null,
  dirty = false,
  storageBlocked = false;
let view = "home",
  filter = "all",
  query = "",
  page = 0,
  pendingAction = null,
  importSequence = 0;
const PAGE_SIZE = 15;
let explanations = new Map(),
  explanationPhase = "loading",
  explanationRequest = false,
  corpusHash = "",
  corpusText = "";

async function loadExplanations() {
  if (explanationRequest) return;
  explanationRequest = true;
  explanationPhase = "loading";
  updateExplanationPanel();
  try {
    if (!corpusHash) corpusHash = await sha256Text(corpusText);
    const response = await fetch("data/explanations.json", {
      cache: "no-cache",
    });
    if (!response.ok) throw new Error("해설 파일을 받지 못했어요.");
    explanations = validateExplanations(
      await response.json(),
      bank,
      corpusHash,
    );
    explanationPhase = "ready";
  } catch {
    explanations = new Map();
    explanationPhase = "error";
  } finally {
    explanationRequest = false;
    updateExplanationPanel();
    if (view === "home" && document.querySelector("#bank-results"))
      renderRows();
  }
}
function updateExplanationPanel() {
  const panel = document.querySelector("#explanation-content");
  if (!panel || !state?.session) return;
  const q = byId.get(state.session.ids[state.session.index]);
  const selected = state.session.results[q.id];
  if (selected) {
    panel.innerHTML = explanationContent(q, selected);
    const heading = document.querySelector(".answer-panel h3");
    if (heading && explanations.get(q.id)?.reviewNote)
      heading.textContent = grade(q, selected)
        ? "✓ 출처 기준 정답이에요."
        : "출처 정답과 다른 답을 골랐어요.";
  }
}
function explanationContent(q, selected) {
  const entry = explanations.get(q.id);
  if (entry) return renderExplanation(q, entry, selected);
  return `<section class="explanation explanation-unavailable" aria-label="해설 불러오기" aria-busy="${explanationPhase === "loading"}"><h3>한국어 해설</h3><p>${explanationPhase === "loading" ? "해설을 불러오고 있어요. 풀이 기록은 그대로 유지돼요." : "해설을 불러오지 못했어요. 문제는 계속 풀 수 있고, 다시 시도해도 풀이 기록은 유지돼요."}</p><button class="button secondary" data-action="retry-explanations" ${explanationPhase === "loading" ? "disabled" : ""}>${explanationPhase === "loading" ? "불러오는 중" : "해설 다시 불러오기"}</button></section>`;
}

function notify(message, actions = []) {
  const notice = $("#notice");
  notice.replaceChildren();
  const text = document.createElement("p");
  text.textContent = message;
  notice.append(text);
  for (const [label, handler] of actions) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", handler);
    notice.append(button);
  }
  notice.hidden = false;
}
function dismissNotice() {
  $("#notice").hidden = true;
}
function download(value, name) {
  const blob = new Blob(
    [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function confirmAction(title, description, action, label = "적용하기") {
  pendingAction = action;
  $("#dialog-title").textContent = title;
  $("#dialog-description").textContent = description;
  $("#dialog-apply").textContent = label;
  $("#confirm-dialog").returnValue = "";
  $("#confirm-dialog").showModal();
}
$("#confirm-dialog").addEventListener("close", () => {
  const action = pendingAction;
  pendingAction = null;
  if ($("#confirm-dialog").returnValue === "apply") action?.();
});
function persist() {
  dirty = true;
  if (storageBlocked || !saveState(storage, state).ok) {
    $("#save-status").textContent = "저장되지 않음";
    $("#save-status").classList.add("error");
    if (storageBlocked) {
      notify(
        "기존 기록을 읽을 수 없어 덮어쓰기를 멈췄어요. 기존 파일을 백업하거나, 새 기록 저장을 허용해 주세요.",
        [
          [
            "기존 파일 백업",
            () => download(corruptRaw ?? "{}", "aws-unreadable-backup.json"),
          ],
          [
            "새 기록 저장 허용",
            () =>
              confirmAction(
                "기존 기록을 교체할까요?",
                "읽을 수 없는 기존 기록을 현재 화면의 학습 기록으로 교체해요. 필요하면 먼저 기존 파일을 백업해 주세요.",
                () => {
                  storageBlocked = false;
                  persist();
                  render();
                },
                "현재 기록 저장",
              ),
          ],
        ],
      );
    } else
      notify(
        "브라우저에 저장하지 못했어요. 지금 기록은 이 화면에 남아 있어요. 창을 닫기 전에 백업해 주세요.",
        [
          ["다시 저장", persist],
          ["기록 내보내기", exportBackup],
        ],
      );
    return;
  }
  dirty = false;
  dismissNotice();
  $("#save-status").textContent = "이 브라우저에 저장됨";
  $("#save-status").classList.remove("error");
}
function exportBackup() {
  download(
    { app: "aws-saa-study", exportedAt: new Date().toISOString(), state },
    `aws-study-${new Date().toISOString().slice(0, 10)}.json`,
  );
}
$("#export-button").addEventListener("click", () => {
  if (state) exportBackup();
});
$("#import-button").addEventListener("click", () => {
  if (state) $("#import-file").click();
});
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0],
    sequence = ++importSequence;
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024)
      throw new Error(
        "백업 파일이 너무 커요. 4MB 이하의 학습 기록을 선택해 주세요.",
      );
    const raw = JSON.parse(await file.text());
    if (sequence !== importSequence) return;
    if (raw.app !== "aws-saa-study")
      throw new Error("이 사이트에서 내보낸 학습 백업 파일을 선택해 주세요.");
    const imported = validateState(raw.state, bank);
    confirmAction(
      "백업 기록을 가져올까요?",
      `푼 문제 ${Object.keys(imported.history).length}개 · 북마크 ${imported.bookmarks.length}개\n현재 기록을 이 파일의 내용으로 교체해요. 취소하면 현재 기록이 유지돼요.`,
      () => {
        state = imported;
        storageBlocked = false;
        corruptRaw = null;
        view = "home";
        persist();
        render();
      },
      "기록 가져오기",
    );
  } catch (error) {
    if (sequence === importSequence)
      notify(error.message, [["닫기", dismissNotice]]);
  }
});
$("#home-button").addEventListener("click", () => {
  if (state) {
    view = "home";
    render();
  }
});
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  if (state) {
    view = "home";
    render();
  }
});

const answered = () => bank.filter((q) => state.history[q.id]);
const mastered = () =>
  answered().filter((q) => grade(q, state.history[q.id].selected));
function footer() {
  return `<footer class="footer"><span>A little every day. 오늘의 한 문제부터.</span><span>영어 원문 · <a href="${esc(source.repository)}" target="_blank" rel="noopener noreferrer">문제 출처</a> · <a href="data/UPSTREAM-LICENSE.txt" target="_blank" rel="noopener noreferrer">라이선스</a> · <button class="button ghost" data-action="about">이용 안내</button></span></footer>`;
}
function stat(label, value, unit, foot, color = "") {
  return `<div class="stat ${color}"><div class="stat-label">${label}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-foot">${foot}</div></div>`;
}
function render() {
  if (view === "study" && state.session) renderStudy();
  else if (view === "summary" && state.session) renderSummary();
  else renderHome();
}
function renderHome() {
  const done = answered().length,
    correct = mastered().length,
    wrong = done - correct;
  const session = state.session,
    resume = Boolean(session);
  main.innerHTML = `<div class="heading"><div><span class="eyebrow">YOUR LEARNING JOURNEY</span><h1>조금씩 풀고, 확실하게.</h1><p>AWS SAA-C03, 한국어 해설로 정답의 이유까지.</p></div><span class="pill">SAA-C03 · ${bank.length.toLocaleString()}문제</span></div>
    <section class="hero" aria-label="학습 시작"><div><span class="eyebrow">${resume ? "PICK UP WHERE YOU LEFT OFF" : "READY WHEN YOU ARE"}</span><h2>${resume ? "지난 공부, 이어서 해볼까요?" : "첫 문제부터 가볍게 시작해요."}</h2><p>${resume ? `${MODES[session.mode]} · ${session.index + 1} / ${session.ids.length}번째 문제에서 기다리고 있어요.` : "문제를 풀고 정답을 확인해 보세요. 공부한 만큼 기록이 쌓여요."}</p></div><span class="hero-decoration" aria-hidden="true"></span><button class="button" data-action="${resume ? "resume" : "begin"}">${resume ? "이어서 풀기" : "문제 풀기"} <span aria-hidden="true">↗</span></button></section>
    <section class="stats" aria-label="학습 현황">${stat("풀어본 문제", done.toLocaleString(), `/ ${bank.length.toLocaleString()}`, `전체의 ${Math.round((done / bank.length) * 100)}%를 풀었어요`)}${stat("최근 답안 정답률", done ? Math.round((correct / done) * 100) : "—", "%", "문제마다 마지막으로 제출한 답 기준", "green")}${stat("다시 볼 오답", wrong, "문제", "다시 맞히면 오답에서 빠져요", "red")}${stat("나의 북마크", state.bookmarks.length, "문제", "기억해 두고 싶은 문제를 모아요")}</section>
    <section aria-label="문제 은행"><div class="section-heading"><div><h2>문제 둘러보기</h2><p>순서대로 차근차근, 또는 필요한 문제만 골라서.</p></div><button class="button secondary" data-action="random">⤨ 랜덤 20문제</button></div><div class="bank"><div class="bank-tools"><div class="filters" aria-label="문제 필터">${["all", "unseen", "wrong", "bookmarks"].map((mode) => `<button class="filter ${filter === mode ? "active" : ""}" aria-pressed="${filter === mode}" data-filter="${mode}">${{ all: "전체", unseen: "미풀이", wrong: "오답", bookmarks: "북마크" }[mode]}</button>`).join("")}</div><label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">문제 번호 또는 영어 키워드 검색</span><input id="search" type="search" placeholder="문제 번호 또는 영어 키워드" value="${esc(query)}" autocomplete="off"></label></div><div id="bank-results"></div></div></section>${footer()}`;
  renderRows();
  $("#search").addEventListener("input", (event) => {
    query = event.target.value;
    page = 0;
    renderRows();
  });
}
function renderRows() {
  const list = selectQuestions(bank, state, filter, query),
    pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  page = Math.min(page, pages - 1);
  const labels = {
    unseen: [
      "아직 안 푼 문제가 없어요",
      "모든 문제를 한 번씩 풀었어요. 오답 복습을 해볼까요?",
    ],
    wrong: [
      "다시 볼 오답이 없어요",
      "문제를 틀리면 이곳에 모여요. 다시 맞히면 목록에서 빠져요.",
    ],
    bookmarks: [
      "북마크한 문제가 없어요",
      "문제 옆 별을 누르면 이곳에 모아볼 수 있어요.",
    ],
  };
  const empty = query
    ? ["검색 결과가 없어요", "다른 키워드나 문제 번호를 입력해 주세요."]
    : labels[filter] || ["문제가 없어요", "다른 필터를 선택해 주세요."];
  $("#bank-results").innerHTML =
    `<div class="bank-head"><span>번호</span><span>문제</span><span>최근 결과</span><span class="sr-only">북마크</span></div>${
      list.length
        ? list
            .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            .map((q) => {
              const record = state.history[q.id],
                result = record
                  ? grade(q, record.selected)
                    ? "correct"
                    : "wrong"
                  : "";
              return `<div class="question-row"><span class="row-id">${String(q.id).padStart(3, "0")}</span><button class="row-open" data-open="${q.id}"><span class="row-title">${esc(q.text)}</span><span class="row-meta">${q.answer.length === 1 ? "단일 선택" : `${q.answer.length}개 선택`} · ${record ? `최근 ${result === "correct" ? "정답" : "오답"} · ${record.attempts}회 풀이` : "아직 풀지 않았어요"}${explanations.get(q.id)?.reviewNote ? '<span class="review-row"> · 출처 정답 재검토</span>' : ""}</span></button><span class="status-chip ${result}">${record ? (result === "correct" ? "정답" : "오답") : "미풀이"}</span>${star(q.id)}</div>`;
            })
            .join("")
        : `<div class="empty"><h3>${empty[0]}</h3><p>${empty[1]}</p></div>`
    }<div class="bank-bottom"><span>${list.length.toLocaleString()}문제${query ? " 검색됨" : ""}</span><div class="pager"><button data-page="-1" aria-label="이전 페이지" ${page === 0 ? "disabled" : ""}>‹</button><span>${page + 1} / ${pages}</span><button data-page="1" aria-label="다음 페이지" ${page === pages - 1 ? "disabled" : ""}>›</button></div>${list.length ? '<button class="button ghost" data-action="filtered">이 목록 풀기 ↗</button>' : ""}</div>`;
}
function star(id) {
  const selected = state.bookmarks.includes(id);
  return `<button class="star ${selected ? "selected" : ""}" data-star="${id}" aria-label="${id}번 문제 북마크 ${selected ? "해제" : "추가"}" aria-pressed="${selected}">${selected ? "★" : "☆"}</button>`;
}
function start(mode, ids, index = 0) {
  if (!ids.length) return;
  const next = { mode, ids: [...ids], index, drafts: {}, results: {} };
  const apply = () => {
    state.session = next;
    view = "study";
    persist();
    render();
    focusQuestion();
  };
  const old = state.session;
  if (
    old &&
    Object.keys(old.results).length < old.ids.length &&
    (Object.keys(old.drafts).length || Object.keys(old.results).length)
  ) {
    confirmAction(
      "새 문제 묶음으로 시작할까요?",
      "제출한 답과 북마크는 남아요. 현재 묶음의 순서와 아직 제출하지 않은 선택은 새 묶음으로 교체돼요.",
      apply,
      "새로 시작하기",
    );
  } else apply();
}
function focusQuestion() {
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}
function renderStudy() {
  const s = state.session,
    q = byId.get(s.ids[s.index]),
    result = s.results[q.id],
    selected = result || s.drafts[q.id] || [];
  const complete = Object.keys(s.results).length;
  main.innerHTML = `<div class="study-top"><div><span class="eyebrow">ONE QUESTION AT A TIME</span><h1>${MODES[s.mode]}</h1><p>${s.index + 1} / ${s.ids.length}번째 문제 · 차근차근 풀어보세요.</p></div><button class="button secondary" data-action="home">학습 홈</button></div><div class="study-grid"><section class="question-card" aria-label="현재 문제"><div class="question-heading"><span class="question-number">QUESTION ${String(q.id).padStart(3, "0")}</span>${star(q.id)}</div><h2 class="question-text" id="question-text" lang="en">${esc(q.text)}</h2><p class="selection-help" id="selection-help">${q.answer.length === 1 ? "정답을 하나 선택해 주세요." : `정답을 ${q.answer.length}개 선택해 주세요. 모두 맞혀야 정답이에요.`} <span id="selected-count">(${selected.length}/${q.answer.length})</span></p><div class="options" role="group" aria-labelledby="question-text" aria-describedby="selection-help">${Object.entries(
    q.options,
  )
    .map(
      ([key, text]) =>
        `<label class="option ${result && q.answer.includes(key) ? "is-correct" : result?.includes(key) && !q.answer.includes(key) ? "is-wrong" : ""}"><input type="${q.answer.length === 1 ? "radio" : "checkbox"}" name="answer" value="${key}" ${selected.includes(key) ? "checked" : ""} ${result ? "disabled" : ""}><span class="option-letter" aria-hidden="true">${key}</span><span class="option-text" lang="en"><span class="sr-only">${key}. </span>${esc(text)}${result && q.answer.includes(key) ? '<br><span class="option-tag" lang="ko">✓ 출처 정답</span>' : result?.includes(key) && !q.answer.includes(key) ? '<br><span class="option-tag" lang="ko">내가 고른 답</span>' : ""}</span></label>`,
    )
    .join(
      "",
    )}</div>${result ? answerPanel(q, result) : ""}<div class="study-actions"><button class="button secondary" data-action="prev" ${s.index === 0 ? "disabled" : ""}>← 이전</button><div>${!result ? `<button class="button primary" id="submit-answer" data-action="submit" ${selected.length !== q.answer.length ? "disabled" : ""}>정답 확인</button>` : ""}<button class="button ${result ? "primary" : "ghost"}" data-action="next">${s.index === s.ids.length - 1 ? "풀이 마치기" : result ? "다음 문제 →" : "건너뛰기 →"}</button></div></div></section><aside><div class="study-map"><h3>이번 학습</h3><p>${complete} / ${s.ids.length}문제 제출</p><div class="progress-track" role="progressbar" aria-label="제출한 문제 비율" aria-valuemin="0" aria-valuemax="${s.ids.length}" aria-valuenow="${complete}"><div class="progress-fill" style="width:${(complete / s.ids.length) * 100}%"></div></div><div class="map-grid">${s.ids
    .map((id, index) => {
      const answer = s.results[id],
        status = answer
          ? grade(byId.get(id), answer)
            ? "correct"
            : "wrong"
          : "";
      return `<button class="map-button ${status} ${index === s.index ? "current" : ""}" data-index="${index}" aria-label="${id}번 문제${status ? (status === "correct" ? ", 정답" : ", 오답") : ", 미제출"}" ${index === s.index ? 'aria-current="step"' : ""}>${id}</button>`;
    })
    .join(
      "",
    )}</div><div class="map-legend">초록: 정답 · 주황: 오답<br>번호를 누르면 해당 문제로 이동해요.</div></div><p class="study-note">선택한 답과 현재 위치가 자동 저장돼요.<br>잠깐 쉬었다가 돌아와도 괜찮아요.</p></aside></div>${footer()}`;
}
function answerPanel(q, selected) {
  const correct = grade(q, selected),
    votes = Object.entries(q.votes || {}).sort(
      (a, b) => parseInt(b[1]) - parseInt(a[1]),
    );
  const differs =
    votes.length && [...votes[0][0]].sort().join("") !== q.answer.join("");
  const underReview = Boolean(explanations.get(q.id)?.reviewNote);
  return `<section class="answer-panel ${correct ? "" : "wrong"}" aria-label="채점 결과" role="status"><h3>${underReview ? (correct ? "✓ 출처 기준 정답이에요." : "출처 정답과 다른 답을 골랐어요.") : correct ? "✓ 정답이에요. 잘했어요!" : "다시 한 번 살펴볼까요?"}</h3><p>출처 정답 <strong>${q.answer.join(", ")}</strong> · 내가 고른 답 ${selected.join(", ")}</p>${votes.length ? `<details ${differs ? "open" : ""}><summary>커뮤니티 투표${differs ? " · 출처 정답과 의견이 달라요" : ""}</summary><div class="vote-list">${votes.map(([key, value]) => `<span>${esc(key)} ${esc(value)}</span>`).join("")}</div></details>` : ""}</section><div id="explanation-content">${explanationContent(q, selected)}</div>`;
}
function renderSummary() {
  const s = state.session,
    done = Object.keys(s.results).length,
    correct = s.ids.filter(
      (id) => s.results[id] && grade(byId.get(id), s.results[id]),
    ).length;
  main.innerHTML = `<section class="summary"><span class="eyebrow">A STEP FORWARD</span><span class="summary-icon" aria-hidden="true">✧</span><h1>오늘도 한 걸음 나아갔어요.</h1><p>모든 답안은 학습 기록에 반영됐어요.<br>틀린 문제는 오답에서 다시 만날 수 있어요.</p><div class="stats">${stat("제출", done, "문제", `전체 ${s.ids.length}문제`)}${stat("정답", correct, "문제", done ? `정답률 ${Math.round((correct / done) * 100)}%` : "아직 제출한 답이 없어요", "green")}${stat("미제출", s.ids.length - done, "문제", "채점에 포함하지 않아요")}</div><div class="summary-actions"><button class="button secondary" data-action="resume">이 묶음 다시 보기</button><button class="button primary" data-action="home">학습 홈으로</button></div></section>${footer()}`;
}
main.addEventListener("change", (event) => {
  if (!event.target.matches('input[name="answer"]')) return;
  const s = state.session,
    q = byId.get(s.ids[s.index]);
  if (s.results[q.id]) return;
  let values = [...main.querySelectorAll('input[name="answer"]:checked')].map(
    (input) => input.value,
  );
  if (values.length > q.answer.length) {
    event.target.checked = false;
    return;
  }
  s.drafts[q.id] = values;
  persist();
  $("#selected-count").textContent = `(${values.length}/${q.answer.length})`;
  $("#submit-answer").disabled = values.length !== q.answer.length;
});
main.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (button.dataset.star) {
    const id = Number(button.dataset.star);
    state.bookmarks = state.bookmarks.includes(id)
      ? state.bookmarks.filter((value) => value !== id)
      : [...state.bookmarks, id];
    persist();
    render();
    return;
  }
  if (button.dataset.filter) {
    filter = button.dataset.filter;
    page = 0;
    renderHome();
    return;
  }
  if (button.dataset.page) {
    page += Number(button.dataset.page);
    renderRows();
    return;
  }
  if (button.dataset.open) {
    const ids = selectQuestions(bank, state, filter, query).map((q) => q.id);
    start(filter, ids, ids.indexOf(Number(button.dataset.open)));
    return;
  }
  if (button.dataset.index !== undefined) {
    state.session.index = Number(button.dataset.index);
    persist();
    render();
    focusQuestion();
    return;
  }
  switch (button.dataset.action) {
    case "begin":
      start(
        "all",
        bank.map((q) => q.id),
      );
      break;
    case "resume":
      view = "study";
      render();
      focusQuestion();
      break;
    case "home":
      view = "home";
      render();
      focusQuestion();
      break;
    case "filtered":
      start(
        filter,
        selectQuestions(bank, state, filter, query).map((q) => q.id),
      );
      break;
    case "random": {
      const ids = bank.map((q) => q.id);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      start("random", ids.slice(0, 20));
      break;
    }
    case "submit":
      submitAnswer(state, byId.get(state.session.ids[state.session.index]));
      persist();
      render();
      break;
    case "retry-explanations":
      loadExplanations();
      break;
    case "prev":
      state.session.index--;
      persist();
      render();
      focusQuestion();
      break;
    case "next":
      if (state.session.index < state.session.ids.length - 1)
        state.session.index++;
      else view = "summary";
      persist();
      render();
      focusQuestion();
      break;
    case "about":
      confirmAction(
        "공부 기록과 문제에 대해",
        `같은 브라우저와 같은 사이트 주소에서 이어서 풀 수 있어요. 브라우저 데이터 삭제나 시크릿 창 종료 시 기록이 사라질 수 있어요. 다른 기기에는 내보내기·가져오기로 옮겨 주세요.\n\n공개 커뮤니티 자료 ${bank.length}문항이에요. 원본 ${bank.length + source.excluded.length}문항 중 선택지가 비어 있는 ${source.excluded.length}개를 제외했어요. 한국어 해설은 AWS 문서를 참고해 작성한 학습 자료이며 공식 시험 해설이 아니에요. 출처 정답이 의심스러운 문항은 해설에서 별도로 표시해요.`,
        () => {},
        "확인",
      );
      break;
  }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  if (dirty || storageBlocked) {
    notify(
      "다른 탭에서 학습 기록이 바뀌었어요. 지금 기록을 먼저 내보낸 뒤 새로고침해 주세요.",
      [["기록 내보내기", exportBackup]],
    );
    return;
  }
  const loaded = loadState(storage, bank);
  if (loaded.status === "corrupt" || loaded.status === "unavailable") {
    storageBlocked = true;
    corruptRaw = loaded.raw;
    persist();
    return;
  }
  state = loaded.state;
  if (!state.session) view = "home";
  render();
  notify("다른 탭에서 저장한 최신 기록을 불러왔어요.", [
    ["닫기", dismissNotice],
  ]);
});

async function init() {
  try {
    const responses = await Promise.all([
      fetch("data/questions.json"),
      fetch("data/source.json"),
    ]);
    if (responses.some((response) => !response.ok))
      throw new Error("문제 파일을 불러오지 못했어요.");
    const [questionText, sourceData] = await Promise.all([
      responses[0].text(),
      responses[1].json(),
    ]);
    bank = JSON.parse(questionText);
    source = sourceData;
    corpusText = questionText;
    corpusHash = "";
    byId = new Map(bank.map((q) => [q.id, q]));
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const loaded = loadState(storage, bank);
    state = loaded.state;
    storageBlocked = loaded.status === "corrupt";
    corruptRaw = loaded.raw;
    render();
    loadExplanations();
    if (storageBlocked || loaded.status === "unavailable") persist();
    else
      $("#save-status").textContent =
        loaded.status === "ok" ? "이 브라우저에 저장됨" : "자동 저장 준비됨";
  } catch (error) {
    main.innerHTML = `<div class="loading"><span class="eyebrow">잠시만요</span><h1>문제를 불러오지 못했어요.</h1><p>${esc(error.message)} 잠시 후 다시 시도해 주세요.</p><p><button class="button primary" id="retry-load">다시 불러오기</button></p></div>`;
    $("#retry-load").addEventListener("click", init);
    $("#save-status").textContent = "연결 확인 필요";
  }
}
init();
