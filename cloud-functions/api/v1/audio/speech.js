import WebSocket from "ws";

const SECRET_KEY = "Arcer5202hy88vh8";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D6837491F6";
const SEC_MS_GEC_VERSION = "1-143.0.3650.75";

// 微软新端点：WebSocket 协议
const SYNTHESIS_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
// 获取 STS Token 的 HTTP 端点
const TOKEN_URL = "https://api.msedgeservices.com/tts/cognitiveservices/v1";

const SUPPORTED_VOICES = [
  "zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", "zh-CN-YunjianNeural",
  "zh-CN-XiaoyiNeural", "zh-CN-YunyangNeural", "zh-CN-XiaoshuangNeural",
  "zh-CN-liaoning-XiaobeiNeural", "zh-CN-shaanxi-XiaoniNeural",
  "zh-CN-XiaoxiaoDialectsNeural",
  "zh-TW-HsiaoChenNeural", "zh-TW-YunJheNeural", "zh-TW-HsiaoYuNeural",
  "zh-HK-HiuMaanNeural", "zh-HK-WanLungNeural", "zh-HK-HiuGaaiNeural",
  "en-US-AriaNeural", "en-US-GuyNeural", "en-US-JennyNeural",
  "en-US-DavisNeural", "en-US-JaneNeural", "en-US-JasonNeural",
  "en-US-NancyNeural", "en-US-SaraNeural", "en-US-TonyNeural",
  "en-GB-SoniaNeural", "en-GB-RyanNeural",
  "ja-JP-NanamiNeural", "ja-JP-KeitaNeural",
  "ko-KR-SunHiNeural", "ko-KR-InJoonNeural"
];
const COMPAT_MODELS = ["tts-1", "tts-1-hd"];

// ---------- 工具函数 ----------
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function generateSecMsGec() {
  const WIN_EPOCH_OFFSET = 11644473600;
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH_OFFSET;
  ticks -= ticks % 300;
  ticks *= 10000000;
  const str = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function getStsToken(secMsGec) {
  const url = `${TOKEN_URL}?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Sec-MS-GEC": secMsGec,
      "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION
    },
    body: JSON.stringify({})
  });
  const token = resp.headers.get("X-STS-Token");
  if (!token) {
    let detail = "";
    try { detail = await resp.text(); } catch (e) {}
    throw new Error(`STS_TOKEN_FAILED: status=${resp.status}, detail=${detail.slice(0, 300)}`);
  }
  return token;
}

// ---------- WebSocket 合成核心 ----------
function synthesizeViaWebSocket(token, ssml, secMsGec) {
  return new Promise((resolve, reject) => {
    const url = `${SYNTHESIS_URL}?token=${token}`;

    const ws = new WebSocket(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        "Sec-MS-GEC": secMsGec,
        "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION
      }
    });

    const audioChunks = [];
    let settled = false;

    const cleanup = () => {
      if (!settled) {
        settled = true;
        try { ws.terminate(); } catch (e) {}
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket 合成超时（30秒）"));
    }, 30000);

    ws.on("open", () => {
      // 1. 发送 speech.config
      const config = {
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
              outputFormat: "audio-24khz-48kbitrate-mono-mp3"
            }
          }
        }
      };
      ws.send(JSON.stringify(config));

      // 2. 发送 SSML（带文本头）
      const ssmlMessage = `Path: ssml\r\nX-RequestId: ${crypto.randomUUID().replace(/-/g, "")}\r\nX-Timestamp: ${new Date().toISOString()}\r\nContent-Type: application/ssml+xml\r\n\r\n${ssml}`;
      ws.send(ssmlMessage);
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(data);
        if (buf.length > 2) {
          const headerLength = buf.readUInt16BE(0);
          const audioStart = 2 + headerLength;
          if (buf.length > audioStart) {
            audioChunks.push(buf.subarray(audioStart));
          }
        }
      } else {
        const text = data.toString();
        if (text.includes("Path:turn.end")) {
          clearTimeout(timeout);
          cleanup();
          if (audioChunks.length === 0) {
            reject(new Error("WebSocket 合成完成但未收到音频数据"));
          } else {
            resolve(Buffer.concat(audioChunks));
          }
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`WebSocket 连接失败: ${err.message}`));
    });

    ws.on("close", (code, reason) => {
      if (!settled) {
        clearTimeout(timeout);
        settled = true;
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error(`WebSocket 意外关闭: code=${code}, reason=${reason.toString()}`));
        }
      }
    });
  });
}

// ---------- 主入口 ----------
export default function onRequest(context) {
  const { request } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${SECRET_KEY}`) {
    return jsonResponse({ error: "key错误" }, 401, corsHeaders);
  }

  return handleSpeech(request, corsHeaders);
}

async function handleSpeech(request, corsHeaders) {
  try {
    const body = await request.json();
    const { input, model, voice, speed = 1.0 } = body;
    if (!input) {
      return jsonResponse({ error: "缺少input文本" }, 400, corsHeaders);
    }

    let resolvedVoice = voice;
    if (model) {
      if (!SUPPORTED_VOICES.includes(model) && !COMPAT_MODELS.includes(model)) {
        return jsonResponse({ error: `模型 ${model} 不存在` }, 404, corsHeaders);
      }
      if (SUPPORTED_VOICES.includes(model) && !voice) resolvedVoice = model;
    }
    if (!resolvedVoice) resolvedVoice = DEFAULT_VOICE;
    if (!SUPPORTED_VOICES.includes(resolvedVoice)) {
      return jsonResponse({ error: `音色 ${resolvedVoice} 不存在` }, 400, corsHeaders);
    }

    const rateStr =
      typeof speed === "number" ? `${Math.round(speed * 100)}%` : String(speed);

    const secMsGec = await generateSecMsGec();

    let token;
    try {
      token = await getStsToken(secMsGec);
    } catch (err) {
      return jsonResponse(
        { error: "获取STS token失败", detail: err.message },
        502,
        corsHeaders
      );
    }

    const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice name='${resolvedVoice}'><prosody rate='${rateStr}'>${escapeXml(
      input
    )}</prosody></voice></speak>`;

    let audioBuffer;
    try {
      audioBuffer = await synthesizeViaWebSocket(token, ssml, secMsGec);
    } catch (err) {
      return jsonResponse(
        { error: "WebSocket 合成失败", detail: err.message },
        502,
        corsHeaders
      );
    }

    return new Response(audioBuffer, {
      headers: { "Content-Type": "audio/mpeg", ...corsHeaders }
    });
  } catch (error) {
    console.error("TTS 云函数执行失败:", error?.message || error);
    return jsonResponse(
      { error: "语音合成服务暂时不可用，请稍后重试" },
      503,
      corsHeaders
    );
  }
}
