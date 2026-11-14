const $ = (id) => document.getElementById(id);

const state = {
  name: "",
  password: "",
  objects: [],
  current: null,
  messages: [], // Claude에 보내는 대화 (user/assistant)
};

// ---------- 화면 전환 ----------
function show(view) {
  for (const v of ["name", "play", "gallery"]) $("view-" + v).hidden = v !== view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  if (view === "gallery") loadGallery();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));

// 모든 서버 요청에 반 비밀번호를 함께 보냄
function api(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "x-class-password": encodeURIComponent(state.password) },
  });
}

// ---------- 1. 이름 (+ 반 비밀번호) ----------
$("name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  state.name = $("name-input").value.trim();
  state.password = $("password-input").value.trim();
  if (!state.name) return;
  await start();
});

async function start() {
  const res = await api("/api/objects");
  if (res.status === 401) {
    $("view-name").hidden = false;
    $("name-error").textContent = "반 비밀번호가 틀렸어요. 선생님께 다시 물어보세요.";
    return;
  }
  try {
    sessionStorage.setItem("name", state.name);
    sessionStorage.setItem("password", state.password);
  } catch {}
  $("name-error").textContent = "";
  state.objects = await res.json();
  $("hello").textContent = `${state.name}의 상상 공간`;
  $("nav").hidden = false;
  pickObject();
  show("play");
}

// ---------- 2 & 6. 물건 보여주기 / 바꾸기 ----------
function pickObject() {
  const choices = state.objects.filter((o) => o.name !== state.current?.name);
  state.current = choices[Math.floor(Math.random() * choices.length)];
  $("object-name").textContent = state.current.name;
  $("object-img").src = state.current.url;
  $("object-img").alt = state.current.name;
  resetChat();
  $("keep").value = "";
  $("improve").value = "";
  $("result").hidden = true;
  $("status").textContent = "";
}

$("change-btn").addEventListener("click", () => {
  if (state.messages.length && !confirmChange()) return;
  pickObject();
});

// confirm()을 쓰지 않고 버튼 글자로 한 번 더 확인
let changeArmed = false;
function confirmChange() {
  if (changeArmed) { changeArmed = false; $("change-btn").textContent = "🔄 너무 어려워요! 다른 물건으로 바꿀래요"; return true; }
  changeArmed = true;
  $("change-btn").textContent = "정말 바꿀까요? 한 번 더 누르면 바뀌어요";
  setTimeout(() => {
    changeArmed = false;
    $("change-btn").textContent = "🔄 너무 어려워요! 다른 물건으로 바꿀래요";
  }, 4000);
  return false;
}

// ---------- 3. 챗봇 대화 ----------
function addMsg(text, who) {
  const div = document.createElement("div");
  div.className = "msg " + who;
  div.textContent = text;
  $("chat-log").appendChild(div);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
  return div;
}

// 받침에 따라 은/는 고르기
function eunNeun(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return "은(는)";
  return code % 28 ? "은" : "는";
}

function resetChat() {
  state.messages = [];
  $("chat-log").innerHTML = "";
  const obj = state.current.name;
  addMsg(
    `안녕, ${state.name}! 나는 미래 탐험 로봇이야. 오늘은 ${obj}에 대해 같이 생각해 보자!\n\n` +
      `먼저 쉬운 질문! ${obj}${eunNeun(obj)} 무엇을 할 때 쓰는 물건일까?`,
    "bot"
  );
}

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("chat-input").value.trim();
  if (!text) return;
  $("chat-input").value = "";
  addMsg(text, "me");
  state.messages.push({ role: "user", content: text });

  const btn = e.submitter || $("chat-form").querySelector("button");
  btn.disabled = true;
  const typing = addMsg("생각하는 중...", "bot typing");
  try {
    const res = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: state.name, object: state.current.name, messages: state.messages }),
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok) throw new Error(data.error);
    addMsg(data.reply, "bot");
    state.messages.push({ role: "assistant", content: data.reply });
  } catch (err) {
    typing.remove();
    addMsg(err.message || "앗, 다시 한 번 말해 줄래?", "bot");
    state.messages.pop(); // 실패한 질문은 다시 보낼 수 있게 제거
  } finally {
    btn.disabled = false;
    $("chat-input").focus();
  }
});

// ---------- 4 & 5. 정리하고 그림 만들기 ----------
$("generate-btn").addEventListener("click", async () => {
  const keep = $("keep").value.trim();
  const improve = $("improve").value.trim();
  if (!keep || !improve) {
    $("status").textContent = "두 칸을 모두 채워 주세요 😊";
    return;
  }
  $("generate-btn").disabled = true;
  $("status").textContent = "🎨 미래 물건을 그리고 있어요... (1분 정도 걸려요)";
  $("result").hidden = true;
  try {
    const res = await api("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: state.name, object: state.current.name, keep, improve }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("result-title").textContent = `${state.name}이(가) 상상한 미래의 ${data.object}`;
    $("result-img").src = data.image;
    $("result").hidden = false;
    $("status").textContent = "완성! 친구들 작품 구경 탭에서도 볼 수 있어요.";
  } catch (err) {
    $("status").textContent = err.message || "문제가 생겼어요. 다시 눌러 볼래?";
  } finally {
    $("generate-btn").disabled = false;
  }
});

// ---------- 7. 갤러리 ----------
async function loadGallery() {
  const res = await api("/api/gallery");
  const items = await res.json();
  const box = $("gallery");
  box.innerHTML = "";
  if (!items.length) {
    box.innerHTML = '<p class="empty">아직 작품이 없어요. 첫 번째 주인공이 되어 볼까요?</p>';
    return;
  }
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "gallery-item";
    const img = document.createElement("img");
    img.src = it.image;
    img.alt = it.object;
    img.loading = "lazy";
    const p = document.createElement("p");
    p.innerHTML = "<b></b><br><small></small>";
    p.querySelector("b").textContent = `미래의 ${it.object}`;
    p.querySelector("small").textContent = `${it.name} 작품`;
    card.append(img, p);
    card.addEventListener("click", () => openDetail(it));
    box.appendChild(card);
  }
}
$("refresh-btn").addEventListener("click", loadGallery);

function openDetail(it) {
  $("detail-img").src = it.image;
  $("detail-title").textContent = `${it.name}의 미래 ${it.object}`;
  $("detail-keep").textContent = it.keep;
  $("detail-improve").textContent = it.improve;
  $("detail").showModal();
}

// 비밀번호 칸 표시 여부, 새로고침해도 이름 유지
(async () => {
  const config = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  $("password-input").hidden = !config.needPassword;
  $("password-input").required = Boolean(config.needPassword);
  try {
    const saved = sessionStorage.getItem("name");
    if (saved) {
      state.name = saved;
      state.password = sessionStorage.getItem("password") || "";
      start();
    }
  } catch {}
})();
