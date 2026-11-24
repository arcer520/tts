// models.js
const ALLOW_ORIGIN = "*";
const CACHE_TTL = 60 * 60 * 1000;

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

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

export default function onRequest(context) {
  const { request } = context;
  const corsHeaders = getCorsHeaders();

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({
      error: { message: "Method not allowed", type: "invalid_request_error" }
    }), { status: 405, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders } });
  }

  return handleModels(corsHeaders);
}

async function handleModels(corsHeaders) {
  const voices = await getVoiceList();
  const baseModels = ["tts-1", "tts-1-hd"];
  const allIds = [...baseModels, ...voices];

  const created = Math.floor(Date.now() / 1000);
  const data = allIds.map(id => ({
    id,
    object: "model",
    created,
    owned_by: "arcer-tts"
  }));

  return new Response(JSON.stringify({
    object: "list",
    data
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}
