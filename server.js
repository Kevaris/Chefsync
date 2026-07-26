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
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "YOUR_YOUTUBE_API_KEY_HERE";

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

// YouTube Data API Search for Recipe Video & Thumbnail Image
async function fetchYouTubeGuide(dishName) {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY.includes("YOUR_")) return null;
    try {
        const query = encodeURIComponent(`${dishName} recipe guide`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=1&key=${YOUTUBE_API_KEY}`;
        
        const response = await fetch(url);
        const data = await response.json();
        const item = data.items?.[0];

        if (!item) return null;

        return {
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
            videoId: item.id.videoId,
            channelTitle: item.snippet.channelTitle
        };
    } catch (err) {
        console.error("YouTube API Error:", err.message);
        return null;
    }
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

        // Mode 2: Generate New Recipe (Multi-AI Council + Serper + YouTube Media)
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

            // Extract Dish Name for YouTube Media Search
            const firstLine = finalReply.split("\n")[0].replace(/[#*]/g, "").trim();
            const searchDishName = firstLine.length > 3 ? firstLine : clean_ingredients;

            const ytData = await fetchYouTubeGuide(searchDishName);
            if (ytData) {
                const mediaMarkdown = `![${searchDishName}](${ytData.thumbnail})\n*Video Tutorial: [${ytData.title} (${ytData.channelTitle})](https://www.youtube.com/watch?v=${ytData.videoId})*\n\n---`;
                finalReply = mediaMarkdown + "\n\n" + finalReply;
            }

            return res.json({ reply: finalReply });
        }

        // Mode 3: Follow-Up Questions
        if (mode === "followup_chat") {
            console.log("[server.js] Executing Memory Follow-Up Chat");
            const systemPrompt = `You are the AI chatbot of ChefSync, you come under Kevaris group of companies made by Riddhi pandit. Answer the user's follow-up question DIRECTLY using the provided conversation history.
            
RULES:
CULINARY REALISM & FLAVOR RULES:
1. FLAVOR PAIRING CHECK: Evaluate if the provided ingredients naturally pair together in real-world cuisine.
2. INCOMPATIBLE INGREDIENTS: If ingredients clash badly (e.g., sweet cake + onions, fish + chocolate):
   - DO NOT force them into a single unpalatable recipe.
   - Gently inform the user that the combination isn't culinary-compatible.
   - Pick the primary/strongest ingredient and suggest a realistic recipe for it, mentioning additional common kitchen staples they might need.
3. DISH AUTHENTICITY: Only generate recipes that are culinarily sound and palatable. Never invent fake or unappetizing dishes just to use every word provided.`;

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
