const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// =========================================================================
// 🔑 CONFIGURATION & SECURITY
// =========================================================================
const SECURITY_CODE = "kevaris 57744";

const GROQ_API_KEY   = process.env.GROQ_API_KEY   || "YOUR_GROQ_API_KEY_HERE";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";
const QWEN_API_KEY   = process.env.QWEN_API_KEY   || process.env.OPENROUTER_API_KEY || "YOUR_QWEN_OR_OPENROUTER_API_KEY_HERE";
const SERPER_API_KEY = process.env.SERPER_API_KEY || "YOUR_SERPER_API_KEY_HERE";

const PORT = process.env.PORT || 3000;

// =========================================================================
// 🌐 CLIENT API HELPERS
// =========================================================================

// Serper Search - Only executed when explicitly required by router
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

// Groq Completion API (OpenAI Compatible)
async function callGroq(messages, temperature = 0.3) {
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

// Gemini API
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

// Qwen API (via OpenRouter)
async function callQwen(messages, temperature = 0.3) {
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

// Helper to sanitize chat history for LLM message arrays
function formatMessageHistory(systemPrompt, history, currentMessage) {
    const messages = [{ role: "system", content: systemPrompt }];
    if (Array.isArray(history)) {
        for (const msg of history.slice(-6)) {
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
// 🚦 STAGE 1: LLM-BASED INTENT ROUTER
// =========================================================================
async function classifyIntent(message, history) {
    const lastContext = Array.isArray(history) && history.length > 0 
        ? history.slice(-2).map(m => `${m.role}: ${m.content}`).join(" | ")
        : "None";

    const routerPrompt = `You are the intent classifier for ChefSync AI. Analyze the user's message and history to output ONLY a JSON object.

Categories:
1. "CONVERSATIONAL": Greetings ("hi", "hello"), identity questions ("who are you?", "what can you do?"), meta conversation, or general chit-chat.
2. "FOLLOW_UP": Clarification questions, questions about cook time, ingredient substitutions, or steps regarding an EXISTING recipe in context.
3. "RECIPE_REQUEST": Explicit requests to make a dish, food ideas based on ingredients, or asking "what can I cook?".

User Message: "${message}"
Recent Context: "${lastContext}"

Output JSON format ONLY (no markdown code blocks, no prose):
{"type": "CONVERSATIONAL" | "FOLLOW_UP" | "RECIPE_REQUEST", "search_needed": true | false, "search_query": "string or null"}`;

    const rawResult = await callGroq([{ role: "user", content: routerPrompt }], 0.0);
    
    try {
        if (rawResult) {
            const cleanJson = rawResult.replace(/```json|```/g, "").trim();
            return JSON.parse(cleanJson);
        }
    } catch (e) {
        console.warn("Router JSON parse failed, falling back to heuristic parsing.");
    }

    // Default fallback routing if JSON parsing fails
    return { type: "RECIPE_REQUEST", search_needed: true, search_query: message };
}

// =========================================================================
// 🚀 MAIN CHAT ROUTE
// =========================================================================
app.post("/chat", async (req, res) => {
    const { code, message, history = [] } = req.body;

    // 1. Authorization check
    if (code !== SECURITY_CODE) {
        return res.status(403).json({ error: "🔒 Unauthorized: Invalid Security Code." });
    }

    if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message content required." });
    }

    // 2. Fast Assistant Mode (Mini Kevaris)
    if (message.startsWith("MINI_KEVARIS_HELP:")) {
        const query = message.replace("MINI_KEVARIS_HELP:", "").trim();
        const miniReply = await callGroq([
            { role: "system", content: "You are Mini Kevaris, a fast web app assistant. Answer concisely." },
            { role: "user", content: query }
        ]);
        return res.json({ reply: miniReply || "Mini Kevaris is currently offline." });
    }

    try {
        // 3. Stage 1: Classify Intent via Router
        const intent = await classifyIntent(message, history);
        console.log(`[Router Decision] Message: "${message}" => Intent: ${intent.type}`);

        // ---------------------------------------------------------------------
        // HANDLER A: CONVERSATIONAL (Greetings / Meta Questions)
        // ---------------------------------------------------------------------
        if (intent.type === "CONVERSATIONAL") {
            const systemPrompt = `You are ChefSync AI created by Kevaris, an intelligent culinary companion. 
Answer conversationally, politely, and concisely. 
STRICT RULE: Do NOT output any recipe, ingredients list, or cooking steps unless explicitly requested.`;

            const messages = formatMessageHistory(systemPrompt, history, message);
            let reply = await callGroq(messages);
            if (!reply) reply = await callQwen(messages);

            return res.json({ reply: reply || "Hello! I am ChefSync AI by Kevaris. How can I help you in the kitchen today?" });
        }

        // ---------------------------------------------------------------------
        // HANDLER B: FOLLOW_UP (Questions about an existing dish/recipe)
        // ---------------------------------------------------------------------
        if (intent.type === "FOLLOW_UP") {
            const systemPrompt = `You are ChefSync AI by Kevaris. Answer the user's specific follow-up question directly using the conversation history context.
STRICT RULE: Answer ONLY the user's question (e.g., cooking time, substitution, pan size). DO NOT generate a new dish or append an unrequested recipe.`;

            const messages = formatMessageHistory(systemPrompt, history, message);
            let reply = await callGroq(messages);
            if (!reply) reply = await callQwen(messages);

            return res.json({ reply: reply || "Could you clarify which recipe or step you're asking about?" });
        }

        // ---------------------------------------------------------------------
        // HANDLER C: RECIPE_REQUEST (Generating New Recipes / Multi-AI Council)
        // ---------------------------------------------------------------------
        let searchContext = "";
        if (intent.search_needed && intent.search_query) {
            searchContext = await searchWeb(intent.search_query);
        }

        // Parallel Draft Generation
        const groqPrompt = `User Request: "${message}"\nSearch Context:\n${searchContext}\nDraft a clear, practical recipe with exact ingredients and simple steps.`;
        const geminiPrompt = `User Request: "${message}"\nProvide key cooking tips, time estimates, and helpful variations for this request.`;

        const [groqDraft, geminiDraft] = await Promise.all([
            callGroq([{ role: "user", content: groqPrompt }]),
            callGemini(geminiPrompt)
        ]);

        // Qwen Synthesis
        const qwenSystemPrompt = `You are ChefSync AI by Kevaris, a master culinary director. 
Synthesize the provided model ideas into one single, beautifully formatted, easy-to-read bachelor-friendly recipe. Include recipe title, ingredients, step-by-step instructions, prep time, and cook time.`;

        const qwenUserPrompt = `User Input: "${message}"
Groq Draft:\n${groqDraft || "None"}
Gemini Draft:\n${geminiDraft || "None"}
Search Context:\n${searchContext || "None"}

Generate the final synthesis:`;

        let finalReply = await callQwen(
            [{ role: "system", content: qwenSystemPrompt }, { role: "user", content: qwenUserPrompt }]
        );

        if (!finalReply) {
            finalReply = groqDraft || geminiDraft || "⚠️ AI Council synthesis failed to respond. Please try again.";
        }

        return res.json({ reply: finalReply });

    } catch (error) {
        console.error("Server Pipeline Error:", error);
        return res.status(500).json({ error: "Internal Server Error in ChefSync AI Pipeline." });
    }
});

app.get("/", (req, res) => {
    res.send("🍳 ChefSync Intelligent AI Pipeline is live!");
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
    
