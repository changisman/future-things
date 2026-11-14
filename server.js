import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStorage } from "./storage.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = path.join(here, "이미지");
const GALLERY_DIR = path.join(here, "작품");
const PORT = process.env.PORT || 3000;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite";

// 챗봇 제공자: CHAT_PROVIDER 로 지정, 없으면 Gemini 키만 있을 때 gemini, 아니면 claude
function chatProvider() {
  const chosen = (process.env.CHAT_PROVIDER || "").toLowerCase();
  if (chosen === "gemini" || chosen === "claude") return chosen;
  if (process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) return "gemini";
  return "claude";
}

let client;
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "public")));
app.use("/images", express.static(IMAGE_DIR));

const storage = await createStorage({ galleryDir: GALLERY_DIR });

app.get("/gallery-images/:file", async (req, res) => {
  const img = await storage.getImage(req.params.file).catch(() => null);
  if (!img) return res.sendStatus(404);
  res.setHeader("Content-Type", img.mime);
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(img.data);
});

// 반 비밀번호: CLASS_PASSWORD 가 있으면 /api 요청마다 확인
const CLASS_PASSWORD = process.env.CLASS_PASSWORD || "";

app.get("/api/config", (_req, res) => {
  res.json({ needPassword: Boolean(CLASS_PASSWORD) });
});

app.use("/api", (req, res, next) => {
  let given = "";
  try {
    given = decodeURIComponent(req.get("x-class-password") || "");
  } catch {}
  if (!CLASS_PASSWORD || given === CLASS_PASSWORD) return next();
  res.status(401).json({ error: "반 비밀번호가 틀렸어요." });
});

// ---------- Claude ----------

async function askLLM(opts) {
  return chatProvider() === "gemini" ? askGemini(opts) : askClaude(opts);
}

// 혼잡하거나 느린 모델은 건너뛰고 다음 모델로 시도
// 챗봇: 빠른 lite 모델 위주 / 그림(SVG): 더 똑똑한 flash 모델 위주
const GEMINI_CHAT_MODELS = [...new Set([GEMINI_CHAT_MODEL, "gemini-3.1-flash-lite", "gemini-flash-lite-latest"])];
const GEMINI_DRAW_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.5-flash"];

async function askGemini({ system, messages, maxTokens = 1024, timeoutMs = 15000, models = GEMINI_CHAT_MODELS }) {
  let lastError;
  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: { maxOutputTokens: maxTokens + 4096 }, // 생각(thinking) 토큰 여유분
          }),
        }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error?.message || "HTTP " + r.status);
      const text = (data.candidates?.[0]?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || "")
        .join("")
        .trim();
      if (!text) throw new Error("빈 응답");
      return text;
    } catch (err) {
      lastError = err;
      console.warn(`Gemini ${model} 실패: ${err.message}`);
    }
  }
  throw new Error("Gemini: " + lastError.message);
}

async function askClaude({ system, messages, maxTokens = 1024 }) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system,
    messages,
  });
  if (response.stop_reason === "refusal") {
    throw new Error("refusal");
  }
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// 받침에 따라 은/는 고르기
function eunNeun(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return "은(는)";
  return code % 28 ? "은" : "는";
}

function chatSystemPrompt(name, object) {
  const topic = object + eunNeun(object);
  return `너는 초등학교 3학년 학생과 이야기하는 다정한 "미래 탐험 로봇"이야.
학생 이름은 "${name}"이고, 오늘 함께 살펴볼 물건은 "${object}"야. 화면에 그 물건 사진이 보여.
너는 이미 첫 질문으로 "${topic} 무엇을 할 때 쓰는 물건일까?"라고 물었어.

너의 역할은 딱 하나야: 학생이 이 물건의 "꼭 필요한 쓰임새"와 "미래에 바뀌면 좋을 점"을 스스로 생각해 내도록 돕는 것.
아래 단계를 순서대로, 한 단계에 1~2번 주고받으며 진행해. 학생 대답이 충분하면 다음 단계로 넘어가.

[1단계] 쓰임새: 무엇을 할 때 쓰는지, 누가·언제·어디서 쓰는지
[2단계] 꼭 지켜야 할 쓰임새: "만약 ${object}에서 ○○하는 기능이 없어지면 그래도 ${object}일까?"처럼 물어서, 미래에도 바뀌면 안 되는 핵심 쓰임새를 찾게 해.
[3단계] 불편한 점: 직접 쓰거나 가족이 쓰는 걸 보면서 불편했던 점
[4단계] 바뀌면 좋을 점: 3단계의 불편함을 미래에는 어떻게 해결할 수 있을지 자유롭게 상상하게 해. 엉뚱한 상상도 칭찬해 줘.
[5단계] 정리 안내: 학생이 말한 내용을 짧게 정리해 주고 "이제 아래 칸에 '바뀌지 않아야 할 쓰임새'와 '바뀌면 좋을 점'을 써 볼까?"라고 안내해. 대신 써 주지는 마.

말하는 방법:
- 초등 3학년이 바로 이해할 쉬운 낱말, 친근한 반말. 한 번에 2~3문장만.
- 질문은 한 번에 딱 하나만 해. 답장 하나에 물음표(?)는 한 개만 써. 대답하기 쉬운 구체적인 질문으로 해(예: "집에서는 누가 써?", "쓰다가 귀찮았던 적 있어?").
- 정답을 먼저 알려주지 마. 학생 말을 먼저 칭찬하거나 받아 주고, 다음 질문을 해.
- 학생이 "몰라", "음..."처럼 막히면 고를 수 있는 보기를 2~3개 줘(예: "무거워서? 시끄러워서? 아니면 다른 거?").

주제에서 벗어날 때:
- 학생이 물건과 상관없는 이야기(게임, 친구, 장난, 다른 질문 등)를 하면, 한 문장으로만 가볍게 받아 주고 바로 지금 단계의 질문으로 돌아와.
  예: "하하, 재미있는 생각이다! 그런데 우리 ${object} 탐험이 아직 남았어. ○○?"
- 같은 학생이 계속 벗어나도 혼내지 말고, 짧고 다정하게 같은 방식으로 돌아와.
- 위험하거나 무섭거나 나쁜 말이 나오면 그 내용에는 대답하지 말고 "그 얘기는 선생님께 여쭤보자. 우리는 ${object} 이야기를 계속해 볼까?"처럼 돌아와.
- ${object}와 상관없는 숙제 풀이, 다른 물건 이야기, 너 자신에 대한 긴 이야기는 하지 마.

이모지는 가끔 하나 정도만 써.`;
}

app.get("/api/objects", async (_req, res) => {
  const files = await fs.readdir(IMAGE_DIR);
  const objects = files
    .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
    .map((f) => ({ name: path.parse(f).name.normalize("NFC"), url:"/images/" + encodeURIComponent(f) }));
  res.json(objects);
});

app.post("/api/chat", async (req, res) => {
  const { name, object, messages } = req.body || {};
  if (!name || !object || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "잘못된 요청이에요." });
  }
  const clean = messages
    .slice(-30)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
  try {
    const reply = await askLLM({ system: chatSystemPrompt(name, object), messages: clean });
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err.message);
    res.status(500).json({ error: "로봇 친구가 잠깐 쉬고 있어요. 다시 말해 볼래?" });
  }
});

// ---------- 이미지 생성 ----------

async function buildImagePrompt({ object, keep, improve }) {
  const text = await askLLM({
    maxTokens: 600,
    system: `You turn an elementary school student's ideas (written in Korean) into one English prompt for an image generator.
The image shows the imagined FUTURE version of an everyday object, in a bright, friendly, colorful children's picture-book illustration style.
- Keep the object's core purpose recognizable.
- Clearly show the student's improvement ideas.
- Child-safe: no scary, violent, or inappropriate content. If an idea is inappropriate, quietly replace it with a harmless, fun one.
- No text, letters, or words in the image.
Reply with the prompt only, under 120 words.`,
    messages: [
      {
        role: "user",
        content: `물건: ${object}\n바뀌지 않아야 할 쓰임새: ${keep}\n바뀌면 좋을 점: ${improve}`,
      },
    ],
  });
  return text;
}

async function generateWithOpenAI(idea) {
  const prompt = await buildImagePrompt(idea);
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt,
      size: "1024x1024",
      n: 1,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error("OpenAI: " + (data.error?.message || r.status));
  return { data: Buffer.from(data.data[0].b64_json, "base64"), ext: "png" };
}

async function generateWithGemini(idea) {
  const prompt = await buildImagePrompt(idea);
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const data = await r.json();
  if (!r.ok) throw new Error("Gemini: " + (data.error?.message || r.status));
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  const b64 = part?.inlineData?.data || part?.inline_data?.data;
  if (!b64) throw new Error("Gemini: 이미지가 돌아오지 않았어요.");
  return { data: Buffer.from(b64, "base64"), ext: "png" };
}

// 무료 방법: 챗봇 모델이 SVG(도형으로 그린 그림) 코드를 직접 그림
async function generateWithSvg({ object, keep, improve }) {
  const text = await askLLM({
    maxTokens: 12000,
    timeoutMs: 90000,
    models: GEMINI_DRAW_MODELS,
    system: `너는 초등학생의 상상을 귀여운 그림으로 그려 주는 일러스트레이터야. 그림은 SVG 코드로 그려.
학생이 상상한 "미래의 ${object}"를 그려 줘.

그림 규칙:
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"> 로 시작해서 </svg> 로 끝나는 SVG 코드 하나만 답해. 설명, 마크다운, 코드블록 표시는 쓰지 마.
- 밝고 알록달록한 그림책 느낌. 배경(방, 거리, 하늘 등)을 그려서 장면처럼 만들어 줘.
- 가운데에 미래의 ${object}를 크게 그려. 원래 ${object}의 모양과 쓰임새를 알아볼 수 있어야 해.
- 학생이 말한 "바뀌면 좋을 점"이 그림에서 눈에 잘 보이게 표현해(움직임 선, 빛, 작은 로봇 팔, 화면 등).
- 새로운 기능마다 짧은 한글 이름표(2~6글자)를 말풍선이나 화살표로 붙여 줘. 이름표는 3개까지. font-family="sans-serif". 이름표와 그림 속 글자에는 이모지나 특수기호를 쓰지 말고 한글만 써.
- 사람이 나오면 웃는 얼굴의 단순한 캐릭터로.
- <script>, <foreignObject>, <image>, 외부 링크, 애니메이션은 쓰지 마.
- 무섭거나 위험하거나 어린이에게 맞지 않는 내용이 있으면 조용히 재미있고 안전한 내용으로 바꿔서 그려.`,
    messages: [
      {
        role: "user",
        content: `물건: ${object}\n바뀌지 않아야 할 쓰임새: ${keep}\n바뀌면 좋을 점: ${improve}`,
      },
    ],
  });
  const match = text.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) throw new Error("SVG 그림이 돌아오지 않았어요.");
  return { data: Buffer.from(sanitizeSvg(match[0]), "utf8"), ext: "svg" };
}

// 혹시 모를 위험한 코드 제거
function sanitizeSvg(svg) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(href\s*=\s*["'])\s*(?!#)[^"']*/gi, "$1#");
}

function imageProvider() {
  const chosen = (process.env.IMAGE_PROVIDER || "").toLowerCase();
  if (chosen === "gemini" && process.env.GEMINI_API_KEY) return generateWithGemini;
  if (chosen === "openai" && process.env.OPENAI_API_KEY) return generateWithOpenAI;
  if (chosen === "svg") return generateWithSvg;
  if (process.env.OPENAI_API_KEY) return generateWithOpenAI;
  // 유료 그림 키가 없으면 무료 SVG 그림
  if (process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY) return generateWithSvg;
  return null;
}

app.post("/api/generate", async (req, res) => {
  const { name, object, keep, improve } = req.body || {};
  if (!name || !object || !keep?.trim() || !improve?.trim()) {
    return res.status(400).json({ error: "두 칸을 모두 채워 주세요." });
  }
  const generate = imageProvider();
  if (!generate) {
    return res.status(500).json({ error: "이미지 API 키가 설정되지 않았어요. 선생님께 알려 주세요." });
  }
  try {
    const { data, ext } = await generate({ object, keep: keep.slice(0, 500), improve: improve.slice(0, 500) });
    const id = Date.now() + "-" + crypto.randomBytes(3).toString("hex");
    const item = {
      id,
      name: String(name).slice(0, 20),
      object,
      keep: keep.slice(0, 500),
      improve: improve.slice(0, 500),
      image: `/gallery-images/${id}.${ext}`,
      createdAt: new Date().toISOString(),
    };
    await storage.save(item, data, ext);
    res.json(item);
  } catch (err) {
    console.error("generate error:", err.message);
    res.status(500).json({ error: "그림을 그리다가 문제가 생겼어요. 한 번 더 눌러 볼래?" });
  }
});

app.get("/api/gallery", async (_req, res) => {
  try {
    res.json(await storage.list());
  } catch (err) {
    console.error("gallery error:", err.message);
    res.status(500).json({ error: "작품을 불러오지 못했어요." });
  }
});

app.listen(PORT, () => {
  console.log(`미래 물건 상상 놀이터: http://localhost:${PORT}`);
  console.log(`챗봇: ${chatProvider() === "gemini" ? GEMINI_CHAT_MODEL : CLAUDE_MODEL}`);
  console.log(`그림: ${imageProvider()?.name.replace("generateWith", "") || "없음"}`);
  console.log(`작품 저장: ${storage.kind}`);
  console.log(`반 비밀번호: ${CLASS_PASSWORD ? "사용" : "없음"}`);
  if (!imageProvider()) console.warn("⚠️  API 키가 없어 그림 만들기가 동작하지 않아요.");
});
