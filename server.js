const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// API Keys
const GROQ_API_KEY   = process.env.GROQ_API_KEY   || "YOUR_GROQ_API_KEY_HERE";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";
const QWEN_API_KEY   = process.env.QWEN_API_KEY   || process.env.OPENROUTER_API_KEY || "YOUR_QWEN_OR_OPENROUTER_API_KEY_HERE";
const SERPER_API_KEY = process.env.SERPER_API_KEY || "YOUR_SERPER_API_KEY_HERE";

const PORT = 3000;

// Helper APIs
async function searchWeb(query) {
    if (!SERPER_API_KEY || SERPER_API_KEY.includes("YOUR_")) return "";
    try {
        const response = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
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
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        console.error("Groq Error:", err.message);
        return null;
    }
}

async function callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("YOUR_")) return null;
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (err) {
        console.error("Gemini Error:", err.message);
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
            body: JSON.stringify({ model: "qwen/qwen-2.5-72b-instruct:free", messages, temperature })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        console.error("Qwen Error:", err.message);
        return null;
    }
}

// Route called strictly by server.py
app.post("/generate", async (req, res) => {
    const { mode, clean_ingredients, raw_prompt, user_query, history = [], query } = req.body;

    try {
        // Mode 1: Mini Kevaris
        if (mode === "mini_kevaris") {
            const reply = await callGroq([
                { role: "system", content: "You are Mini Kevaris, a helpful assistant." },
                { role: "user", content: query }
            ]);
            return res.json({ reply: reply || "Mini Kevaris offline." });
        }

        // Mode 2: Generate New Recipe (Multi-AI Council + Serper)
        if (mode === "generate_recipe") {
            console.log("[server.js] Executing Multi-AI Recipe Council");
            const searchContext = await searchWeb(`${clean_ingredients} quick recipe`);

            const groqPrompt = `User Request:\n${raw_prompt}\n\nSearch Ideas:\n${searchContext}\n\nDraft a clean recipe using these ingredients.`;
            const geminiPrompt = `User Request:\n${raw_prompt}\n\nProvide cooking tips and preparation instructions.`;

            const [groqDraft, geminiDraft] = await Promise.all([
                callGroq([{ role: "user", content: groqPrompt }]),
                callGemini(geminiPrompt)
            ]);

            const qwenSystemPrompt = `You are ChefSync AI by Kevaris. Synthesize the provided drafts into a single, clean recipe formatted with Title, Ingredients, Instructions, and Cook Time.`;
            const qwenUserPrompt = `Raw Prompt:\n${raw_prompt}\n\nGroq Draft:\n${groqDraft}\n\nGemini Draft:\n${geminiDraft}\n\nSearch Context:\n${searchContext}`;

            let finalReply = await callQwen([
                { role: "system", content: qwenSystemPrompt },
                { role: "user", content: qwenUserPrompt }
            ]);

            if (!finalReply) finalReply = groqDraft || geminiDraft || "AI synthesis failed.";
            return res.json({ reply: finalReply });
        }

        // Mode 3: Follow-Up Questions (Using History, No Web Search, No New Recipes)
        if (mode === "followup_chat") {
            console.log("[server.js] Executing Memory Follow-Up Chat");
            const systemPrompt = `You are the AI chatbot of ChefSync, you come under Kevaris group of companies made by Riddhi pandit. Answer the user's follow-up question DIRECTLY using the provided conversation history.
            
RULES:
1. Answer ONLY what the user asked regarding the previous recipe (e.g. cook time, steps, substitutions).
2. DO NOT perform web search.
3. DO NOT output or invent a new recipe.`;

            const messages = [{ role: "system", content: systemPrompt }];
            for (const msg of history) {
                if (msg.role && msg.content) {
                    messages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
                }
            }
            messages.push({ role: "user", content: user_query });

            let chatReply = await callGroq(messages);
            if (!chatReply) chatReply = await callQwen(messages);

            return res.json({ reply: chatReply || "Could you repeat your follow-up question?" });
        }

    } catch (err) {
        console.error("Execution Engine Error:", err);
        return res.status(500).json({ error: "Failed inside server.js engine." });
    }
});

app.listen(PORT, () => console.log(`server.js (Backend II Engine) running on port ${PORT}`));
