import { EdgeTTS } from "node-edge-tts";
import { Readable } from "stream";

const SECRET_KEY = "Arcer5202hy88vh8";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

const SUPPORTED_VOICES = [ /* 音色列表保持不变，此处省略以节省篇幅，请沿用你原来的列表 */ ];
const COMPAT_MODELS = ["tts-1", "tts-1-hd"];

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

export default function onRequest(context) {
  const { request } = context;
  const corsHeaders = { /* 同之前 */ };
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${SECRET_KEY}`) return jsonResponse({ error: "key错误" }, 401, corsHeaders);
  return handleSpeech(request, corsHeaders);
}

async function handleSpeech(request, corsHeaders) {
  try {
    const body = await request.json();
    const { input, model, voice, speed = 1.0 } = body;
    if (!input) return jsonResponse({ error: "缺少input文本" }, 400, corsHeaders);

    let resolvedVoice = voice;
    if (model) {
      if (!SUPPORTED_VOICES.includes(model) && !COMPAT_MODELS.includes(model)) return jsonResponse({ error: `模型 ${model} 不存在` }, 404, corsHeaders);
      if (SUPPORTED_VOICES.includes(model) && !voice) resolvedVoice = model;
    }
    if (!resolvedVoice) resolvedVoice = DEFAULT_VOICE;
    if (!SUPPORTED_VOICES.includes(resolvedVoice)) return jsonResponse({ error: `音色 ${resolvedVoice} 不存在` }, 400, corsHeaders);

    const rateValue = typeof speed === "number" ? `${((speed - 1) * 100).toFixed(0)}%` : "0%";

    // 使用 node-edge-tts，它内部已经处理了 v2 令牌生成和 WebSocket 协议
    const tts = new EdgeTTS({
      voice: resolvedVoice,
      lang: "zh-CN",
      rate: rateValue,
      timeout: 30000,
    });

    // streamAudio 返回 AsyncGenerator<Buffer | subtitleObject>
    // 我们只收集 Buffer（音频块），忽略字幕对象
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
