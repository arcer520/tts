import * as edgeTTSModule from "node-edge-tts";

// 配置区
const SECRET_KEY = "Arcer5202hy88vh8";
const ALLOW_ORIGIN = "*";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const CACHE_TTL = 60 * 60 * 1000;

// OpenAI 标准模型别名
const OPENAI_TTS_MODELS = ["tts-1", "tts-1-hd"];
// OpenAI 原生 voice 名称映射（可选，智能体有可能传 alloy / echo 这类，映射到微软音色）
const OPENAI_VOICE_MAP = {
  "alloy": "en-US-AriaNeural",
  "echo": "en-US-GuyNeural",
  "fable": "en-GB-SoniaNeural",
  "onyx": "en-US-TonyNeural",
  "nova": "en-US-JennyNeural",
  "shimmer": "en-US-SaraNeural"
};

// 兜底备用音色
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
    const url = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D683791F6";
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`fetch voice list http ${resp.status}`);
    const raw = await resp.json();
    return raw.map(item => item.ShortName).filter(Boolean);
  } catch (e) {
    console.error("拉取微软音色列表失败，使用兜底列表：", e.message);
    return FALLBACK_VOICES;
  }
}

async function getVoiceList() {
  const now = Date.now();
  if (voiceCache && now - cacheTs < CACHE_TTL) {
    return voiceCache;
  }
  voiceCache = await fetchVoiceList();
  cacheTs = now;
  return voiceCache;
}

function getLangFromVoiceId(voiceId) {
  const match = voiceId.match(/^([a-z]{2}-[A-Z]{2})-/);
  return match ? match[1] : "zh-CN";
}

const EdgeTTSClass =
  edgeTTSModule.EdgeTTS ||
  edgeTTSModule.MsEdgeTTS ||
  edgeTTSModule.default;

// OpenAI 风格错误返回
function openaiErrorResponse(message, type = "invalid_request_error", status = 400, extraHeaders = {}) {
  return new Response(JSON.stringify({
    error: {
      message,
      type
    }
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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

export default function onRequest(context) {
  const { request } = context;
  const corsHeaders = getCorsHeaders();

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return openaiErrorResponse("Method not allowed", "invalid_request_error", 405, corsHeaders);
  }

  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return openaiErrorResponse("Authentication failed", "authentication_error", 401, corsHeaders);
  }
  const bearerToken = auth.replace("Bearer ", "").trim();
  if (bearerToken !== SECRET_KEY) {
    return openaiErrorResponse("Incorrect API key provided", "authentication_error", 401, corsHeaders);
  }

  return handleSpeech(request, corsHeaders);
}

async function handleSpeech(request, corsHeaders) {
  try {
    const voices = await getVoiceList();
    const body = await request.json().catch(() => null);
    if (!body) {
      return openaiErrorResponse("Invalid JSON body", "invalid_request_error", 400, corsHeaders);
    }

    // OpenAI 标准字段
    const {
      model = "tts-1",
      input,
      voice,
      response_format = "mp3",
      speed = 1.0
    } = body;

    if (!input || typeof input !== "string" || input.trim() === "") {
      return openaiErrorResponse("Input text is required", "invalid_request_error", 400, corsHeaders);
    }

    // 1. 解析 voice：优先映射 OpenAI 标准 voice 名称
    let resolvedVoice;
    if (voice && OPENAI_VOICE_MAP[voice]) {
      resolvedVoice = OPENAI_VOICE_MAP[voice];
    } else if (voice) {
      resolvedVoice = voice;
    }

    // 2. 如果 model 本身是微软音色 id，且没有指定 voice，则使用 model 作为音色（旧兼容）
    if (!resolvedVoice && voices.includes(model)) {
      resolvedVoice = model;
    }

    // 3. 如果 model 是 tts-1 / tts-1-hd，并且 voice 也没给，使用默认音色
    if (!resolvedVoice && OPENAI_TTS_MODELS.includes(model)) {
      resolvedVoice = DEFAULT_VOICE;
    }

    if (!resolvedVoice || !voices.includes(resolvedVoice)) {
      return openaiErrorResponse(`Voice ${resolvedVoice ?? voice} is not supported`, "invalid_request_error", 400, corsHeaders);
    }

    // 校验输出格式，当前只稳定支持 mp3
    if (response_format !== "mp3") {
      return openaiErrorResponse(`response_format '${response_format}' is not supported, only mp3`, "invalid_request_error", 400, corsHeaders);
    }

    // speed 校验：OpenAI 范围 0.25 ~ 4.0
    const speedNum = Number(speed);
    if (!Number.isFinite(speedNum) || speedNum < 0.25 || speedNum > 4.0) {
      return openaiErrorResponse("speed must be between 0.25 and 4.0", "invalid_request_error", 400, corsHeaders);
    }

    const rateValue = `${((speedNum - 1) * 100).toFixed(0)}%`;
    const lang = getLangFromVoiceId(resolvedVoice);

    if (typeof EdgeTTSClass !== "function") {
      return openaiErrorResponse("TTS module load error", "server_error", 500, corsHeaders);
    }

    const tts = new EdgeTTSClass({
      voice: resolvedVoice,
      lang,
      rate: rateValue,
      timeout: 30000
    });

    const audioChunks = [];
    for await (const chunk of tts.streamAudio(input)) {
      if (Buffer.isBuffer(chunk)) {
        audioChunks.push(chunk);
      }
    }

    if (audioChunks.length === 0) {
      return openaiErrorResponse("No audio data generated", "server_error", 502, corsHeaders);
    }

    const audioBuffer = Buffer.concat(audioChunks);
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length,
        ...corsHeaders
      }
    });

  } catch (error) {
    console.error("TTS 合成失败:", error?.message || error);
    return openaiErrorResponse("The server encountered an error", "server_error", 502, corsHeaders);
  }
}
