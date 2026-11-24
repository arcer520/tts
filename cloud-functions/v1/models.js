import * as edgeTTSModule from "node-edge-tts";

// 与 speech.js 保持一致的导出兼容逻辑
const EdgeTTSClass =
  edgeTTSModule.EdgeTTS ||
  edgeTTSModule.MsEdgeTTS ||
  edgeTTSModule.default;

// 缓存配置：1 小时（单位：毫秒）
const CACHE_TTL = 60 * 60 * 1000;
let voiceCache = null;
let cacheTimestamp = 0;

async function fetchVoicesFromMicrosoft() {
  if (typeof EdgeTTSClass !== "function") {
    throw new Error("node-edge-tts 导出异常，无法获取音色列表");
  }

  // 社区用法：const voices = await edgeTTS.getVoices()
  // 如果 EdgeTTSClass 是类，可能需要实例化；部分版本是静态方法
  const tts = typeof EdgeTTSClass.getVoices === "function"
    ? EdgeTTSClass
    : new EdgeTTSClass();

  const voices = await tts.getVoices();

  // 统一转换为 OpenAI /v1/models 格式
  return voices.map((v) => ({
    id: v.ShortName || v.shortName || v.id || v.name,
    object: "model",
    created: 1686935002,
    owned_by: "arcer-tts"
  }));
}

export default async function onRequest(context) {
  const { request } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const now = Date.now();
    let modelList;

    if (voiceCache && (now - cacheTimestamp) < CACHE_TTL) {
      // 命中缓存
      modelList = voiceCache;
    } else {
      // 缓存过期或首次请求，从微软拉取
      modelList = await fetchVoicesFromMicrosoft();
      voiceCache = modelList;
      cacheTimestamp = now;
    }

    return new Response(JSON.stringify({ object: "list", data: modelList }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
    });
  } catch (error) {
    console.error("获取微软音色列表失败:", error?.message || error);
    return new Response(
      JSON.stringify({ error: "获取音色列表失败", detail: error?.message || String(error) }),
      {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
      }
    );
  }
}
