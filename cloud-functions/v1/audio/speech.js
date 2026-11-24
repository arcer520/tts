import * as edgeTTSModule from "node-edge-tts";

// 配置区
const SECRET_KEY = "Arcer5202hy88vh8";
const ALLOW_ORIGIN = "*";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const CACHE_TTL = 60 * 60 * 1000;
const COMPAT_MODELS = ["tts-1", "tts-1-hd"];

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

// 从 voiceId 自动解析 lang，例如 en-US-AriaNeural → en-US
function getLangFromVoiceId(voiceId) {
  const match = voiceId.match(/^([a-z]{2}-[A-Z]{2})-/);
  return match ? match[1] : "zh-CN";
}

const EdgeTTSClass =
  edgeTTSModule.EdgeTTS ||
  edgeTTSModule.MsEdgeTTS ||
  edgeTTSModule.default;

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
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
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders
    });
  }

  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${SECRET_KEY}`) {
    return jsonResponse({ error: "key错误" }, 401, corsHeaders);
  }

  return handleSpeech(request, corsHeaders);
}

async function handleSpeech(request, corsHeaders) {
  try {
    const voices = await getVoiceList();
    const body = await request.json();
    const { input, model, voice, speed = 1.0 } = body;

    if (!input || typeof input !== "string" || input.trim() === "") {
      return jsonResponse({ error: "缺少有效的 input 文本" }, 400, corsHeaders);
    }

    let resolvedVoice = voice;
    if (model) {
      if (!voices.includes(model) && !COMPAT_MODELS.includes(model)) {
        return jsonResponse({ error: `模型 ${model} 不存在` }, 404, corsHeaders);
      }
      if (voices.includes(model) && !voice) {
        resolvedVoice = model;
      }
    }

    if (!resolvedVoice) {
      resolvedVoice = DEFAULT_VOICE;
    }
    if (!voices.includes(resolvedVoice)) {
      return jsonResponse({ error: `音色 ${resolvedVoice} 不存在`, available: voices }, 400, corsHeaders);
    }

    const rateValue = typeof speed === "number"
      ? `${((speed - 1) * 100).toFixed(0)}%`
      : "0%";

    const lang = getLangFromVoiceId(resolvedVoice);

    if (typeof EdgeTTSClass !== "function") {
      return jsonResponse(
        {
          error: "node-edge-tts 导出异常",
          detail: `模块导出键: ${Object.keys(edgeTTSModule).join(", ")}`
        },
        500,
        corsHeaders
      );
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
      return jsonResponse({ error: "合成完成但未收到音频数据" }, 502, corsHeaders);
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
    return jsonResponse(
      {
        error: "语音合成失败",
        detail: error?.message || String(error)
      },
      502,
      corsHeaders
    );
  }
}
