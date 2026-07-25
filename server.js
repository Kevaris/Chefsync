const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// =========================================================================
// 🔑 CONFIGURATION & API KEYS
// =========================================================================
const SECURITY_CODE = "kevaris 57744";

const GROQ_API_KEY   = process.env.GROQ_API_KEY   || "YOUR_GROQ_API_KEY_HERE";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";
const QWEN_API_KEY   = process.env.QWEN_API_KEY   || process.env.OPENROUTER_API_KEY || "YOUR_QWEN_OR_OPENROUTER_API_KEY_HERE";
const SERPER_API_KEY = process.env.SERPER_API_KEY || "YOUR_SERPER_API_KEY_HERE";

// Default JS server to Port 3000
const PORT = process.env.PORT || 3000;

// =========================================================================
// 🌐 API HELPER FUNCTIONS
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
            body: JSON.stringify({ q: query })
        });
        const data = await response.json();
        if (data.organic && data.organic.length > 0) {
            return data.organic.slice(0, 3).map(item => `${item.title}: ${item.snippet}`).join("\n");
        }
    } catch (err) {
        console.error("Serper API Error:", err.message);
    }
    return "";
}

async function callGroq(messages, temperature = 0.4) {
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
                messages,
                temperature
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        console.error("Groq API Error:", err.message);
        return null;
    }
}

async function callGemini(prompt) {
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

async function callQwen(messages, temperature = 0.4) {
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
                messages,
                temperature
            })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        console.error("Qwen API Error:", err.message);
        return null;
    }
}

function buildMessages(systemPrompt, history, currentMessage) {
    const messages = [{ role: "system", content: systemPrompt }];
    if (Array.isArray(history)) {
        for (const msg of history) {
            if (msg.role && msg.content) {
                messages.push({
                    role: msg.role === "user" ? "user" : "assistant",
                    content: msg.content
                });
            }
        }
    }
    messages.push({ role: "user", content: currentMessage });
    return messages;
}

// =========================================================================
// 🚀 MAIN CHAT ROUTE
// =========================================================================
app.post("/chat", async (req, res) => {
    const { code, message, history = [] } = req.body;

    if (code !== SECURITY_CODE) {
        return res.status(403).json({ error: "🔒 Unauthorized: Invalid Security Code." });
    }

    if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message content required." });
    }

    const cleanMessage = message.trim();

    // Fast Mini Kevaris Assistant Mode
    if (cleanMessage.startsWith("MINI_KEVARIS_HELP:")) {
        const query = cleanMessage.replace("MINI_KEVARIS_HELP:", "").trim();
        const miniReply = await callGroq([
            { role: "system", content: "You are Mini Kevaris, a helpful app assistant." },
            { role: "user", content: query }
        ]);
        return res.json({ reply: miniReply || "Mini Kevaris is currently offline." });
    }

    try {
        // EXACT SLICE CHECK: Check the first 22 characters of the string
        const userIntent = cleanMessage.slice(0, 22).toLowerCase();
        const isIngredientsMode = (userIntent === "available ingredients:");

        // =====================================================================
        // MODE 1: INGREDIENTS ENTERED -> RUN MULTI-AI RECIPE COUNCIL
        // =====================================================================
        if (isIngredientsMode) {
            console.log("[Node.js Server] Mode: INGREDIENTS ENTERED -> Generating Recipe");

            const cleanIngredients = cleanMessage.slice(22).replace(/[*#]/g, "").trim();
            const searchContext = await searchWeb(`${cleanIngredients} recipe easy bachelor`);

            const groqPrompt = `User Request:\n${cleanMessage}\n\nSearch Context:\n${searchContext}\n\nDraft a clear, practical recipe using these available ingredients.`;
            const geminiPrompt = `User Request:\n${cleanMessage}\n\nProvide key cooking tips and step-by-step guidance for these ingredients.`;

            const [groqDraft, geminiDraft] = await Promise.all([
                callGroq([{ role: "user", content: groqPrompt }]),
                callGemini(geminiPrompt)
            ]);

            const qwenSystemPrompt = `You are ChefSync AI by Kevaris, a master culinary director. 
Synthesize the provided drafts into a single, clean, bachelor-friendly recipe using the available ingredients. 
Format clearly with Recipe Title, Ingredients, Instructions, and Prep/Cook Time.`;

            const qwenUserPrompt = `User Prompt:\n${cleanMessage}\n\nGroq Draft:\n${groqDraft || "None"}\n\nGemini Draft:\n${geminiDraft || "None"}\n\nSearch Ideas:\n${searchContext || "None"}`;

            let finalReply = await callQwen([
                { role: "system", content: qwenSystemPrompt },
                { role: "user", content: qwenUserPrompt }
            ]);

            if (!finalReply) {
                finalReply = groqDraft || geminiDraft || "⚠️ AI Council synthesis failed.";
            }

            return res.json({ reply: finalReply });
        }

        // =====================================================================
        // MODE 2: CHAT / FOLLOW-UPS -> FULL CONVERSATION MEMORY
        // =====================================================================
        console.log("[Node.js Server] Mode: FOLLOW-UP QUESTION -> Reading Memory");

        const chatSystemPrompt = `You are ChefSync AI by Kevaris, an intelligent culinary assistant.
Answer the user's follow-up question or message DIRECTLY using the provided conversation history.

STRICT RULES:
1. Answer ONLY what the user asked regarding the previous recipe (e.g., cooking times, steps, substitutions, identity).
2. DO NOT perform web searches.
3. NEVER generate or invent a new dish/recipe under any circumstances.`;

        const fullMessages = buildMessages(chatSystemPrompt, history, cleanMessage);

        let chatReply = await callGroq(fullMessages);
        if (!chatReply) {
            chatReply = await callQwen(fullMessages);
        }

        return res.json({ 
            reply: chatReply || "I couldn't retrieve the context. Could you repeat your question?" 
        });

    } catch (error) {
        console.error("Server Pipeline Error:", error);
        return res.status(500).json({ error: "Internal Server Error in ChefSync backend." });
    }
});

app.get("/", (req, res) => {
    res.send("🍳 ChefSync Node.js Backend is running!");
});

app.listen(PORT, () => {
    console.log(`Node.js server started on port ${PORT}`);
});
