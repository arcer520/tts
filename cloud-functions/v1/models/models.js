export default function onRequest(context) {
  const { request } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

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
  const created = 1686935002;
  return new Response(JSON.stringify({
    object: "list",
    data: SUPPORTED_VOICES.map(id => ({ id, object: "model", created, owned_by: "arcer-tts" }))
  }), {
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
  });
}
