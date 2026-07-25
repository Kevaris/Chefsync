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
                temperature: 0.5
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
                temperature: 0.5
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

        // 4. Step B: Parallel Draft Inputs
        const groqPrompt = `User Message: "${message}"\nSearch Context:\n${searchContext}\n\nTask: Analyze user intent. If the user asked a direct question, clarification, or follow-up, answer ONLY that question. DO NOT create an unrelated recipe unless they explicitly provided ingredients or requested a new recipe.`;
        const geminiPrompt = `User Message: "${message}"\n\nTask: Provide direct culinary advice or answer to this query. If it's a follow-up question, answer ONLY that question without proposing a new recipe.`;

        const [groqDraft, geminiDraft] = await Promise.all([
            queryGroq(groqPrompt),
            queryGemini(geminiPrompt)
        ]);

        // 5. Step C: Council Synthesis via Qwen
        const qwenSystemPrompt = `You are ChefSync AI by Kevaris.

STRICT BEHAVIOR RULES:
1. FOLLOW-UP QUESTIONS & DIRECT QUESTIONS:
   - If the user asks a question (e.g. "how long to preheat?", "can I use butter instead?", "who are you?"), answer ONLY that question directly and concisely.
   - NEVER tack on an unrequested recipe (like a Grilled Chicken Sandwich) to a direct question.

2. INGREDIENT & RECIPE PROMPTS:
   - ONLY format a full recipe (with ingredients and step-by-step instructions) if the user explicitly asks for a recipe, provides pantry ingredients, or asks "what can I cook?".

3. NO UNRELATED DISHES:
   - Do not combine a direct answer with a completely unrelated recipe.`;

        const qwenUserPrompt = `User Message: "${message}"

Model Insight 1 (Groq):
${groqDraft || "N/A"}

Model Insight 2 (Gemini):
${geminiDraft || "N/A"}

Search Context:
${searchContext || "N/A"}

Synthesize a single, direct, accurate response for the user based on the STRICT BEHAVIOR RULES.`;

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
