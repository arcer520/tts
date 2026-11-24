import * as edgeTTSModule from "node-edge-tts";

const SECRET_KEY = "Arcer5202hy88vh8";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

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

// 兼容 node-edge-tts 不同版本的导出名
const EdgeTTSClass =
  edgeTTSModule.EdgeTTS ||
  edgeTTSModule.MsEdgeTTS ||
  edgeTTSModule.default;

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

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

    // node-edge-tts 的 rate 参数格式是相对百分比字符串，如 "-20%" / "+10%" / "0%"
    const rateValue =
      typeof speed === "number"
        ? `${((speed - 1) * 100).toFixed(0)}%`
        : "0%";

    if (typeof EdgeTTSClass !== "function") {
      return jsonResponse(
        {
          error: "node-edge-tts 导出异常",
          detail: `可用的导出: ${Object.keys(edgeTTSModule).join(", ")}`
        },
        500,
        corsHeaders
      );
    }

    const tts = new EdgeTTSClass({
      voice: resolvedVoice,
      lang: "zh-CN",
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
      return jsonResponse(
        { error: "合成完成但未收到音频数据" },
        502,
        corsHeaders
      );
    }

    const audioBuffer = Buffer.concat(audioChunks);
    return new Response(audioBuffer, {
      headers: { "Content-Type": "audio/mpeg", ...corsHeaders }
    });

  } catch (error) {
    console.error("TTS 合成失败:", error?.message || error);
    return jsonResponse(
      { error: "语音合成失败", detail: error?.message || String(error) },
      502,
      corsHeaders
    );
  }
}
