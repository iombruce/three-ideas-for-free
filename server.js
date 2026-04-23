javascriptimport express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// ─────────────────────────────────────────────
// HELPER: Make a single non-streaming API call
// Used for Chain Step 1 (the analysis call)
// ─────────────────────────────────────────────
async function callClaude(apiKey, systemPrompt, userMessage, maxTokens = 500) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic error: ${errText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? "";
}

// ─────────────────────────────────────────────
// CHAIN STEP 1 PROMPT
// This call is invisible to the user.
// It analyses the founder and produces a short
// structured summary that makes Step 2 smarter.
// ─────────────────────────────────────────────
const ANALYSIS_PROMPT = `You are a sharp startup analyst. Your job is NOT to give advice yet.
Your ONLY job is to deeply understand this founder's situation and produce a concise analysis.

Read what they've told you and return a short JSON object with exactly these fields:
{
  "realSkillLevel": "string — honest assessment: complete beginner / some digital skills / technical",
  "biggestRisk": "string — the single most likely reason this fails in 90 days",
  "hiddenStrength": "string — one underrated asset or advantage they haven't fully mentioned",
  "mostUrgentThing": "string — the single most important thing they need to do in the next 7 days",
  "locationContext": "string — any specific opportunities or constraints their location creates",
  "emotionalState": "string — are they excited/anxious/overwhelmed/confident? This affects how to communicate with them"
}

Return ONLY valid JSON. No markdown. No explanation.`;

// ─────────────────────────────────────────────
// MAIN IDEAS ENDPOINT — now with chaining + streaming
// ─────────────────────────────────────────────
app.post("/api/ideas", async (req, res) => {
  console.log("--- /api/ideas called ---");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "No API key configured" });
  }

  const { prompt, max_tokens, mode } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    // ── CHAIN STEP 1 ──────────────────────────
    // Only do the analysis step for the main mode (not bonus).
    // The bonus call already has context from the frontend.
    let founderAnalysis = "";
    if (mode !== "bonus") {
      console.log("Chain Step 1: Analysing founder...");
      try {
        founderAnalysis = await callClaude(apiKey, ANALYSIS_PROMPT, prompt, 400);
        console.log("Analysis complete:", founderAnalysis.slice(0, 100));
      } catch (err) {
        // If Step 1 fails, we just continue without it — don't crash
        console.log("Analysis step failed (continuing without it):", err.message);
        founderAnalysis = "";
      }
    }

    // ── CHAIN STEP 2 ──────────────────────────
    // Build the enriched user message that includes the Step 1 analysis
    const enrichedPrompt = founderAnalysis
      ? `FOUNDER ANALYSIS (use this to sharpen your advice — do not mention it directly):\n${founderAnalysis}\n\nFOUNDER'S OWN WORDS:\n${prompt}`
      : prompt;

    // ── SYSTEM PROMPTS (unchanged from your original) ──
    const systemPrompt = mode === "bonus"
      ? `You are a direct, experienced startup advisor. Return ONLY a single valid JSON object. No markdown. No explanation. No text before or after the JSON.

The founder has already received their 4 Monday morning ideas (Validate, AI Tool, Grant, Coaching). They have chosen one to go deeper on. Your job is to:

1. Give 3 specific bonus ideas that go deeper on their chosen idea. Each must be something they can do this week. Be specific to what they told you — no generic advice.

2. Suggest ONE future AI tool they should start learning about in the next month. This must be:
- A step up from whatever AI tool they are using today
- Specifically relevant to their idea and where they will be in 4 weeks (past validation, starting to build or market)
- Simple enough to learn in a weekend
- Free or cheap
- Include: tool name, URL, exactly why it fits their specific idea, and one specific thing to try first

Return JSON with exactly:
{
  "bonusIdeas": [
    { "title": "string", "why": "string", "steps": ["string", "string", "string"] },
    { "title": "string", "why": "string", "steps": ["string", "string", "string"] },
    { "title": "string", "why": "string", "steps": ["string", "string", "string"] }
  ],
  "futureAI": {
    "tool": "string — tool name",
    "url": "string — tool URL",
    "why": "string — exactly why this tool for exactly their idea in 4 weeks",
    "firstStep": "string — one specific thing to try first, with enough detail they can do it in 10 minutes"
  }
}`
      : `You are a direct, experienced startup advisor with 30 years of hands-on experience helping bootstrapped founders go from zero to their first 100 customers. You are also an enthusiastic AI champion — you believe AI is the great equaliser and your job is to prove it is easier than people think.

Your tone is: warm, direct, no-nonsense, encouraging. You give specific actionable advice — never generic. You always reference what the person actually told you. You never use jargon.

YOUR ONLY JOB IS TO ANSWER: WHAT DO I DO ON MONDAY MORNING?
Every idea must be something the founder can start within 48 hours. No theory. No strategy documents. Give them the first physical action they take when they sit down on Monday.

THE 4 IDEAS YOU ALWAYS GIVE — IN THIS EXACT ORDER:

IDEA 1 — VALIDATE (type: "validate"):
Help them design a specific validation conversation they can have this week with real humans.
- Exactly who to call or message (specific type of person, where to find them)
- Exactly what to ask (use The Mom Test — ask about their life and current behaviour, never "would you use this?")
- What a positive signal looks like vs a polite non-answer
- A specific script or opening message they can send today
Never skip this. Validation always comes first.

IDEA 2 — AI TOOL (type: "ai_tool"):
Select ONE specific AI tool matched to their exact stage, skill level, and next task.
- Free or very cheap, simple enough to get value from in one sitting
- Give exact tool name, why it fits them specifically, and an exact prompt they can copy and try immediately
- Learning path: one thing in first 10 minutes, one thing in first hour
- End steps with: "This takes 5 minutes. Seriously."
Match to skill level: beginners get Claude.ai or ChatGPT with simple prompts. Never suggest tools requiring coding for beginners.

IDEA 3 — GRANT (type: "grant"):
A real specific grant matched to their location, stage, and sector.
- Exact grant name, who runs it, why they qualify
- Most important action this week to move the application forward
- If unsure of specific grant, suggest the best grant-finding resource for their location

IDEA 4 — COACHING (type: "coaching"):
Real humans who will give honest, direct feedback — not cheerleading.
- Specific community, programme, or forum matched to their location and stage
- Free or nearly free
- Specific action to take this week to get in front of those humans

RULES:
- Never suggest paid ads before 10 paying customers
- Never suggest specific pricing unless founder has validated with customers
- Always lead with validation before product or marketing
- Reading list comes last — only 3 books, matched to their specific situation

Return ONLY a single valid JSON object:
{
  "reinforcement": "string",
  "insight": "string",
  "ideas": [
    { "type": "validate", "title": "string", "why": "string", "steps": ["string","string","string"] },
    { "type": "ai_tool", "title": "string", "why": "string", "steps": ["string","string","string"], "prompt": "string" },
    { "type": "grant", "title": "string", "why": "string", "steps": ["string","string","string"] },
    { "type": "coaching", "title": "string", "why": "string", "steps": ["string","string","string"] }
  ],
  "antiIdea": { "title": "string", "why": "string" },
  "reads": [
    { "title": "string", "why": "string" },
    { "title": "string", "why": "string" },
    { "title": "string", "why": "string" }
  ]
}`;

    // ── STEP 2: STREAMING CALL ─────────────────
    console.log("Chain Step 2: Generating ideas (streaming)...");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const streamResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: Math.min(max_tokens || 2500, 2500),
        system: systemPrompt,
        messages: [{ role: "user", content: enrichedPrompt }],
        stream: true,
      }),
    });

    if (!streamResponse.ok) {
      const errText = await streamResponse.text();
      console.log("Anthropic stream error:", errText);
      res.write(`event: error\ndata: ${JSON.stringify({ error: errText })}\n\n`);
      return res.end();
    }

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
            res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
          }
          if (parsed.type === "message_stop") {
            res.write(`event: done\ndata: {}\n\n`);
          }
        } catch {
          // Ignore malformed chunks
        }
      }
    }

    console.log("Stream complete.");
    res.end();

  } catch (err) {
    console.log("Error:", err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
