import { EdgeTTS } from "node-edge-tts";

// 配置区
const SECRET_KEY = "Arcer5202hy88vh8";
const ALLOW_ORIGIN = "*";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const CACHE_TTL = 60 * 60 * 1000;

// OpenAI 标准模型标识
const OPENAI_TTS_MODELS = ["tts-1", "tts-1-hd"];
// OpenAI voice 别名 -> 微软音色映射
const OPENAI_VOICE_MAP = {
  "alloy": "en-US-AriaNeural",
  "echo": "en-US-GuyNeural",
  "fable": "en-GB-SoniaNeural",
  "onyx": "en-US-TonyNeural",
  "nova": "en-US-JennyNeural",
  "shimmer": "en-US-SaraNeural"
};

// 兜底音色列表（微软接口挂掉时备用）
const FALLBACK_VOICES = [
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

let voiceCache = null;
let cacheTs = 0;

async function fetchVoiceList() {
  try {
    const url = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A0572DC-6AD4-4869-A51C-EC3C03056CD0";
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`fetch voice list http ${resp.status}`);
    const raw = await resp.json();
    return raw.map(item => item.ShortName).filter(Boolean);
  } catch (err) {
    console.error("获取微软音色列表失败，使用兜底列表：", err.message);
    return FALLBACK_VOICES;
  }
}

async function getVoiceList() {
  const now = Date.now();
  if (voiceCache && now - cacheTs < CACHE_TTL) return voiceCache;
  voiceCache = await fetchVoiceList();
  cacheTs = now;
  return voiceCache;
}

// 从音色 ID 自动解析语言
function getLangFromVoiceId(voiceId) {
  const m = voiceId.match(/^([a-z]{2}-[A-Z]{2})-/);
  return m ? m[1] : "zh-CN";
}

// OpenAI 格式错误响应
function openaiError(message, type = "invalid_request_error", status = 400, extraHeaders = {}) {
  return new Response(JSON.stringify({
    error: { message, type }
  }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

export default function onRequest(context) {
  const { request } = context;
  const cors = getCorsHeaders();

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (request.method !== "POST") {
    return openaiError("Method not allowed", "invalid_request_error", 405, cors);
  }

  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return openaiError("Authentication failed", "authentication_error", 401, cors);
  }
  const token = auth.replace("Bearer ", "").trim();
  if (token !== SECRET_KEY) {
    return openaiError("Incorrect API key provided", "authentication_error", 401, cors);
  }

  return handleSpeech(request, cors);
}

async function handleSpeech(request, corsHeaders) {
  try {
    const voices = await getVoiceList();
    let body;
    try {
      body = await request.json();
    } catch {
      return openaiError("Invalid JSON body", "invalid_request_error", 400, corsHeaders);
    }

    // 打印日志，排查收到的输入文本
    console.log("收到请求 body.input =", JSON.stringify(body.input));

    const {
      model = "tts-1",
      input,
      voice,
      response_format = "mp3",
      speed = 1.0
    } = body;

    if (!input || typeof input !== "string" || input.trim() === "") {
      return openaiError("Input text is required", "invalid_request_error", 400, corsHeaders);
    }

    // 解析目标音色
    let resolvedVoice;
    if (voice && OPENAI_VOICE_MAP[voice]) {
      resolvedVoice = OPENAI_VOICE_MAP[voice];
    } else if (voice) {
      resolvedVoice = voice;
    }
    // 兼容：model 本身是音色 ID 时直接使用
    if (!resolvedVoice && voices.includes(model)) {
      resolvedVoice = model;
    }
    // 标准 tts-1 / tts-1-hd 且没指定 voice，使用默认音色
    if (!resolvedVoice && OPENAI_TTS_MODELS.includes(model)) {
      resolvedVoice = DEFAULT_VOICE;
    }

    if (!resolvedVoice || !voices.includes(resolvedVoice)) {
      return openaiError(`Voice ${resolvedVoice ?? voice} is not supported`, "invalid_request_error", 400, corsHeaders);
    }

    if (response_format !== "mp3") {
      return openaiError(`Only mp3 response_format supported`, "invalid_request_error", 400, corsHeaders);
    }

    const speedNum = Number(speed);
    if (!Number.isFinite(speedNum) || speedNum < 0.25 || speedNum > 4.0) {
      return openaiError("speed must be between 0.25 and 4.0", "invalid_request_error", 400, corsHeaders);
    }
    const ratePercent = `${((speedNum - 1) * 100).toFixed(0)}%`;
    const lang = getLangFromVoiceId(resolvedVoice);

    const tts = new EdgeTTS({
      voice: resolvedVoice,
      lang,
      rate: ratePercent,
      timeout: 30000
    });

    const audioChunks = [];
    // 重点：只收集 Buffer（音频），跳过字幕、文本元数据对象
    for await (const chunk of tts.streamAudio(input)) {
      if (Buffer.isBuffer(chunk)) {
        audioChunks.push(chunk);
      }
    }

    if (audioChunks.length === 0) {
      return openaiError("No audio generated", "server_error", 502, corsHeaders);
    }
    const audioBuf = Buffer.concat(audioChunks);

    return new Response(audioBuf, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuf.length,
        "Cache-Control": "no-store",
        ...corsHeaders
      }
    });

  } catch (err) {
    console.error("TTS 合成异常：", err);
    return openaiError("Server error", "server_error", 500, corsHeaders);
  }
}
