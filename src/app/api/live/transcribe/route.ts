type QwenAsrResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: { message?: string };
  message?: string;
};

const MAX_AUDIO_DATA_LENGTH = 8_000_000;
const MAX_CONTEXT_LENGTH = 4_000;

/**
 * Terms the recogniser would otherwise guess at. Qwen3-ASR takes this as a
 * system message and biases decoding toward these spellings.
 */
const BASE_VOCABULARY = [
  "PAI", "Live", "ProspectIQ", "find businesses", "territory", "prioritize",
  "skip", "brief", "call list", "radius", "zip code", "Google Maps", "FCC",
  "broadband", "fiber", "coax", "prospect", "outreach", "research",
  "availability", "hours", "phone", "website", "Spectrum", "Charter",
].join(", ");

/**
 * ASR output arrives as a bare utterance. Strip wrappers the model
 * occasionally adds so the text can drop straight into a chat message.
 */
function cleanTranscript(raw: string): string {
  let text = raw.trim();

  text = text.replace(/^```(?:json|text)?\s*/i, "").replace(/\s*```$/, "").trim();
  const tagged = text.match(/^<\|[^|]*\|>\s*([\s\S]*)$/);
  if (tagged) text = tagged[1]!.trim();
  if (/^["'“”]/.test(text) && /["'“”]$/.test(text)) {
    text = text.slice(1, -1).trim();
  }

  text = text
    .replace(/[。．]/g, ".")
    .replace(/[，]/g, ",")
    .replace(/[？]/g, "?")
    .replace(/[！]/g, "!")
    .replace(/[、]/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();

  if (/^(?:uh|um|hmm|mm|hm|ah|eh|mhm|uh huh|you|thank you|thanks|bye|okay|ok)[.!?]?$/i.test(text)) {
    return "";
  }

  if (text && /^[a-z]/.test(text)) {
    text = text[0]!.toUpperCase() + text.slice(1);
  }
  return text;
}

const tokenize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * Given non-speech audio, the recogniser tends to read the context glossary
 * back instead of returning nothing. Anything mostly made of context terms
 * is treated as empty.
 */
function isContextEcho(transcript: string, context: string): boolean {
  if (!context) return false;
  const words = tokenize(transcript);
  if (words.length < 4) return false;

  const flat = words.join(" ");
  if (tokenize(context).join(" ").includes(flat)) return true;

  const vocabulary = new Set(tokenize(context));
  const matched = words.filter((word) => vocabulary.has(word)).length;
  return matched / words.length >= 0.85;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "Voice transcription is not connected." }, { status: 503 });
  }

  let audio = "";
  let callerContext = "";
  try {
    const body = (await request.json()) as { audio?: unknown; context?: unknown };
    audio = typeof body.audio === "string" ? body.audio.trim() : "";
    callerContext =
      typeof body.context === "string" ? body.context.trim().slice(0, MAX_CONTEXT_LENGTH) : "";
  } catch {
    return Response.json({ error: "That recording could not be read." }, { status: 400 });
  }

  if (!/^data:audio\/[a-z0-9.+-]+(?:;[^,]*)?;base64,/i.test(audio) || audio.length > MAX_AUDIO_DATA_LENGTH) {
    return Response.json({ error: "That recording is empty or too large." }, { status: 400 });
  }

  const baseUrl = (
    process.env.DASHSCOPE_BASE_URL?.trim() || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
  ).replace(/\/$/, "");
  const model =
    process.env.QWEN_ASR_MODEL?.trim() ||
    (/(?:^|[.-])us(?:[.-]|$)/i.test(baseUrl) ? "qwen3-asr-flash-us" : "qwen3-asr-flash");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  const audioMessage = {
    role: "user",
    content: [
      {
        type: "input_audio",
        input_audio: { data: audio },
      },
    ],
  };
  const contextText = [BASE_VOCABULARY, callerContext].filter(Boolean).join("\n");

  const callModel = (withContext: boolean) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: withContext
          ? [{ role: "system", content: [{ text: contextText }] }, audioMessage]
          : [audioMessage],
        stream: false,
        asr_options: {
          language: "en",
          enable_itn: true,
        },
      }),
      signal: controller.signal,
    });

  try {
    let response = await callModel(true);
    // Context enhancement is model-version dependent; drop it rather than fail.
    if (!response.ok && response.status === 400) {
      response = await callModel(false);
    }

    const payload = (await response.json()) as QwenAsrResponse;
    if (!response.ok) {
      console.error(
        "Live transcription failed",
        response.status,
        payload.error?.message ?? payload.message ?? "Unknown transcription error",
      );
      return Response.json({ error: "I could not transcribe that recording." }, { status: 502 });
    }

    const transcript = cleanTranscript(payload.choices?.[0]?.message?.content ?? "");
    if (!transcript || isContextEcho(transcript, contextText)) {
      return Response.json({ error: "I did not hear any speech in that recording." }, { status: 422 });
    }

    return Response.json({ transcript });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Voice transcription timed out."
        : "Voice transcription could not connect.";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
