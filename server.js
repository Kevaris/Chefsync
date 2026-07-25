const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// =========================================================================
// 🔑 CONFIGURATION & API KEY PLACEHOLDERS
// =========================================================================
const SECURITY_CODE = "kevaris 57744";

const GROQ_API_KEY   = process.env.GROQ_API_KEY   || "YOUR_GROQ_API_KEY_HERE";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";
const QWEN_API_KEY   = process.env.QWEN_API_KEY   || process.env.OPENROUTER_API_KEY || "YOUR_QWEN_OR_OPENROUTER_API_KEY_HERE";
const SERPER_API_KEY = process.env.SERPER_API_KEY || "YOUR_SERPER_API_KEY_HERE";

const PORT = process.env.PORT || 3000;

// =========================================================================
// 🔍 HELPER 1: Serper Web Search API
// =========================================================================
async function searchWeb(query) {
    if (!SERPER_API_KEY || SERPER_API_KEY.includes("YOUR_")) return "";
    try {
        const response = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
                "X-API-KEY": SERPER_API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ q: query + " easy recipe bachelor" })
        });
        const data = await response.json();
        if (data.organic && data.organic.length > 0) {
            return data.organic.slice(0, 3).map(item => `${item.title}: ${item.snippet}`).join("\n");
        }
    } catch (err) {
        console.error("Serper API error:", err.message);
    }
    return "";
}

// =========================================================================
// ⚡ HELPER 2: Groq Engine (Llama 3 / Fast Draft)
// =========================================================================
async function queryGroq(prompt, systemPrompt = "You are an assistant for ChefSync.") {
    if (!GROQ_API_KEY || GROQ_API_KEY.includes("YOUR_")) return null;
    try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt }
                ],
                temperature: 0.6
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        console.error("Groq API Error:", err.message);
        return null;
    }
}

// =========================================================================
// ♊ HELPER 3: Gemini Engine (Multimodal & Optimization)
// =========================================================================
async function queryGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("YOUR_")) return null;
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (err) {
        console.error("Gemini API Error:", err.message);
        return null;
    }
}

// =========================================================================
// 🧠 HELPER 4: Qwen Engine (Chief AI Director)
// =========================================================================
async function queryQwen(systemPrompt, userPrompt) {
    if (!QWEN_API_KEY || QWEN_API_KEY.includes("YOUR_")) return null;
    try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${QWEN_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/Kevaris/ChefSync",
                "X-Title": "ChefSync AI"
            },
            body: JSON.stringify({
                model: "qwen/qwen-2.5-72b-instruct:free",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.6
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        console.error("Qwen API Error:", err.message);
        return null;
    }
}

// =========================================================================
// 🚀 MAIN CHAT ENDPOINT: /chat
// =========================================================================
app.post("/chat", async (req, res) => {
    const { code, message } = req.body;

    // 1. Hardware Code Authorization
    if (code !== SECURITY_CODE) {
        return res.status(403).json({ error: "🔒 Unauthorized: Invalid Security Code." });
    }

    if (!message) {
        return res.status(400).json({ error: "Message content required." });
    }

    // 2. Mini Kevaris Fast Assistant Mode
    if (message.startsWith("MINI_KEVARIS_HELP:")) {
        const query = message.replace("MINI_KEVARIS_HELP:", "").trim();
        const miniReply = await queryGroq(
            query, 
            "You are Mini Kevaris, a helpful assistant for the ChefSync web app. Give quick, concise guidance."
        );
        return res.json({ reply: miniReply || "Mini Kevaris is currently offline. Please try again later." });
    }

    try {
        // 3. Step A: Web Context Search
        const searchContext = await searchWeb(message);

        // 4. Step B: Parallel Initial Drafts
        const groqPrompt = `User Query: "${message}"\nSearch Context:\n${searchContext}\n\nIf this is a recipe or ingredient query, draft a bachelor-friendly recipe idea. If it is a general question (e.g. who you are, greetings, questions about how ChefSync works), answer it directly.`;
        const geminiPrompt = `User Query: "${message}"\n\nIf this is a recipe query, provide practical cooking tips or substitutions. If it is a general question, answer it directly.`;

        const [groqDraft, geminiDraft] = await Promise.all([
            queryGroq(groqPrompt),
            queryGemini(geminiPrompt)
        ]);

        // 5. Step C: Council Synthesis via Qwen
        const qwenSystemPrompt = `You are the official AI Engine of ChefSync, developed by Kevaris.
Your system runs on a multi-AI council architecture powered by Groq (Llama 3.3), Gemini 2.0, Qwen 2.5, and Serper Web Search.

Instructions:
- IF THE USER ASKS A GENERAL QUESTION (e.g., "Who are you?", "What AIs are working?", greetings, or general help): Answer directly and helpfully in a conversational manner. Explain that you are ChefSync AI by Kevaris, powered by a multi-model council. Do NOT output a recipe unless requested.
- IF THE USER PROVIDES INGREDIENTS OR ASKS FOR RECIPES: Synthesize the council drafts into a clean, bachelor-friendly recipe with bold headings and clear steps.`;

        const qwenUserPrompt = `User Request: "${message}"

Model Draft 1 (Groq):
${groqDraft || "N/A"}

Model Draft 2 (Gemini):
${geminiDraft || "N/A"}

Search Context:
${searchContext || "N/A"}

Provide the final response according to your instructions.`;

        let finalReply = await queryQwen(qwenSystemPrompt, qwenUserPrompt);

        // Fallback Strategy
        if (!finalReply) {
            finalReply = groqDraft || geminiDraft || "⚠️ AI Council synthesization failed. Please check backend API configuration.";
        }

        return res.json({ reply: finalReply });

    } catch (error) {
        console.error("Server Pipeline Error:", error);
        return res.status(500).json({ error: "Internal Server Error in Multi-AI Council Pipeline." });
    }
});

app.get("/", (req, res) => {
    res.send("🍳 ChefSync Multi-AI Council Backend is running!");
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
