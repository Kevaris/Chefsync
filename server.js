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
// 🔍 HELPER 1: Serper Web Search API (Fixed Query String)
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
            body: JSON.stringify({ q: query }) // Fixed: Removed forced string concatenation
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
// ⚡ HELPER 2: Groq Engine
// =========================================================================
async function queryGroq(prompt, systemPrompt = "You are ChefSync AI by Kevaris.") {
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
                temperature: 0.3
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
// ♊ HELPER 3: Gemini Engine
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
// 🧠 HELPER 4: Qwen Engine
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
                temperature: 0.3
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
// 🚀 MAIN CHAT ENDPOINT
// =========================================================================
app.post("/chat", async (req, res) => {
    const { code, message, history = [] } = req.body;

    // Authorization
    if (code !== SECURITY_CODE) {
        return res.status(403).json({ error: "🔒 Unauthorized: Invalid Security Code." });
    }

    if (!message) {
        return res.status(400).json({ error: "Message content required." });
    }

    // Mini Kevaris Fast Assistant Mode
    if (message.startsWith("MINI_KEVARIS_HELP:")) {
        const query = message.replace("MINI_KEVARIS_HELP:", "").trim();
        const miniReply = await queryGroq(
            query, 
            "You are Mini Kevaris, a helpful assistant for the ChefSync web app. Give quick, concise guidance."
        );
        return res.json({ reply: miniReply || "Mini Kevaris is currently offline. Please try again later." });
    }

    try {
        const lowerMsg = message.trim().toLowerCase();

        // ---------------------------------------------------------------------
        // INTENT 1: Greetings & Meta Questions (Bypasses Search & Recipe Generator)
        // ---------------------------------------------------------------------
        const isGreeting = /^(hi|hello|hey|who are you|what are you|who built you|help)$/i.test(lowerMsg);
        if (isGreeting) {
            const metaReply = await queryGroq(
                `The user said: "${message}". Respond politely as ChefSync AI by Kevaris. State that you are an AI culinary assistant powered by a multi-model council (Groq, Gemini, Qwen). Ask how you can help them with cooking or recipes today. DO NOT output any recipe.`,
                "You are ChefSync AI by Kevaris."
            );
            return res.json({ reply: metaReply });
        }

        // Context string from recent chat history if provided by frontend
        const formattedHistory = Array.isArray(history) && history.length > 0 
            ? history.slice(-4).map(h => `${h.role}: ${h.content}`).join("\n")
            : "No previous context.";

        // ---------------------------------------------------------------------
        // INTENT 2: Follow-up Questions about an existing recipe
        // ---------------------------------------------------------------------
        const isFollowUp = /time|how long|preheat|substitute|replace|instead|calories|pot|pan|step/i.test(lowerMsg);

        if (isFollowUp && formattedHistory !== "No previous context.") {
            const followUpPrompt = `Recent Chat Context:\n${formattedHistory}\n\nUser Question: "${message}"\n\nAnswer the user's question directly based on the context above. DO NOT generate a new recipe or suggest a different dish.`;
            const answer = await queryGroq(followUpPrompt, "You are a concise culinary assistant answering a follow-up question.");
            return res.json({ reply: answer });
        }

        // ---------------------------------------------------------------------
        // INTENT 3: Recipe Request / Ingredient Synthesis
        // ---------------------------------------------------------------------
        const searchContext = await searchWeb(message + " recipe");

        const groqPrompt = `User Input: "${message}"\nSearch Context:\n${searchContext}\nDraft a clean recipe addressing the user's input.`;
        const geminiPrompt = `User Input: "${message}"\nProvide cooking tips or ingredient substitutions for this request.`;

        const [groqDraft, geminiDraft] = await Promise.all([
            queryGroq(groqPrompt),
            queryGemini(geminiPrompt)
        ]);

        const qwenSystemPrompt = `You are ChefSync AI by Kevaris. 
Synthesize the provided drafts into a single clear, structured, bachelor-friendly recipe response with bold headings and clear steps.`;

        const qwenUserPrompt = `User Input: "${message}"\nGroq Draft:\n${groqDraft}\nGemini Draft:\n${geminiDraft}\nSearch Context:\n${searchContext}`;

        let finalReply = await queryQwen(qwenSystemPrompt, qwenUserPrompt);

        if (!finalReply) {
            finalReply = groqDraft || geminiDraft || "⚠️ AI Council synthesis failed.";
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
