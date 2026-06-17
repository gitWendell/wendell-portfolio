import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Gemini Client ─────────────────────────────────────────
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ── Load System Prompt from file ──────────────────────────
function loadPrompt() {
  const promptPath = path.join(__dirname, "prompt.txt");
  if (!fs.existsSync(promptPath)) {
    console.warn("⚠️  prompt.txt not found — using empty system prompt.");
    return "";
  }
  return fs.readFileSync(promptPath, "utf-8").trim();
}

// ── Rate limiter ──────────────────────────────────────────
const requestCounts = new Map();
const LIMIT = 20;
const WINDOW = 60 * 1000;

function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const now = Date.now();
  const entry = requestCounts.get(ip) || { count: 0, start: now };

  if (now - entry.start > WINDOW) {
    entry.count = 0;
    entry.start = now;
  }

  entry.count++;
  requestCounts.set(ip, entry);

  if (entry.count > LIMIT) {
    return res
      .status(429)
      .json({ error: "Too many requests — slow down a bit!" });
  }
  next();
}

// ── Retry Helper with Exponential Backoff ─────────────────
async function callGeminiWithRetry(
  history,
  systemPrompt,
  lastUserMessage,
  maxRetries = 3,
) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const chat = ai.chats.create({
        model: "gemini-2.5-flash",
        config: { systemInstruction: systemPrompt },
        history,
      });

      return await chat.sendMessage({ message: lastUserMessage });
    } catch (err) {
      attempt++;
      const is503 =
        err.status === 503 || (err.message && err.message.includes("503"));

      if (is503 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, then 4s
        console.warn(
          `⚠️ Gemini 503 received. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

// ── API Route ─────────────────────────────────────────────
app.post("/api/chat", rateLimit, async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid messages format." });
  }

  try {
    const systemPrompt = loadPrompt(); // re-reads file on every request

    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const lastUserMessage = messages[messages.length - 1].content;

    // Call the API using our retry helper
    const response = await callGeminiWithRetry(
      history,
      systemPrompt,
      lastUserMessage,
    );

    res.json({ content: [{ text: response.text }] });
  } catch (err) {
    console.error("Gemini error:", err);

    const status = err.status || 500;
    const clientMessage =
      status === 503
        ? "My AI assistant is experiencing high traffic right now. Please try your question again in a moment!"
        : "Server error. Please try again.";

    res.status(status).json({ error: clientMessage });
  }
});

// ── Catch-all: serve index.html ───────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅  Wendell's portfolio running at http://localhost:${PORT}`);
  console.log(`📝  System prompt loaded from: prompt.txt`);
});
