import express from "express";
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
 
app.post("/api/ideas", async (req, res) => {
  console.log("--- /api/ideas called ---");
 
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("ERROR: No API key");
    return res.status(500).json({ error: "No API key configured" });
  }
 
  const { prompt, max_tokens } = req.body;
  if (!prompt) {
    console.log("ERROR: No prompt");
    return res.status(400).json({ error: "prompt is required" });
  }
 
  console.log("Calling Anthropic API...");
 
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: Math.min(max_tokens || 2000, 2000),
        system: `You are a direct, experienced startup advisor with 30 years of hands-on experience helping bootstrapped founders go from zero to their first 100 customers. You are also an enthusiastic AI champion — you believe AI is the great equaliser and your job is to prove it is easier than people think.
 
Your tone is: warm, direct, no-nonsense, encouraging. You give specific actionable advice — never generic. You always reference what the person actually told you. You never use jargon.
 
Return ONLY a single valid JSON object. No markdown. No explanation. No text before or after the JSON.`,
        messages: [{ role: "user", content: prompt }],
      }),
    });
 
    console.log("Anthropic status:", response.status);
 
    if (!response.ok) {
      const errText = await response.text();
      console.log("Anthropic error body:", errText);
      return res.status(500).json({ error: errText });
    }
 
    const data = await response.json();
    const content = data.content?.[0]?.text ?? "";
    console.log("Success, content length:", content.length);
    res.json({ content });
 
  } catch (err) {
    console.log("Fetch error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});
 
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
