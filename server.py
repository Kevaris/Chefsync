import os
import asyncio
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="ChefSync AI Python Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECURITY_CODE = "kevaris 57744"

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "YOUR_GROQ_API_KEY_HERE")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY_HERE")
QWEN_API_KEY = os.getenv("QWEN_API_KEY") or os.getenv("OPENROUTER_API_KEY", "YOUR_QWEN_OR_OPENROUTER_API_KEY_HERE")
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "YOUR_SERPER_API_KEY_HERE")

class ChatPayload(BaseModel):
    code: str
    message: str
    history: Optional[List[Dict[str, Any]]] = []

async def search_web(client: httpx.AsyncClient, query: str) -> str:
    if not SERPER_API_KEY or "YOUR_" in SERPER_API_KEY:
        return ""
    try:
        res = await client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"},
            json={"q": query},
            timeout=10.0
        )
        data = res.json()
        if "organic" in data and len(data["organic"]) > 0:
            return "\n".join([f"{item.get('title')}: {item.get('snippet')}" for item in data["organic"][:3]])
    except Exception as e:
        print(f"Serper API Error: {e}")
    return ""

async def query_groq(client: httpx.AsyncClient, messages: List[Dict[str, str]], temperature: float = 0.4) -> Optional[str]:
    if not GROQ_API_KEY or "YOUR_" in GROQ_API_KEY:
        return None
    try:
        res = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": messages,
                "temperature": temperature
            },
            timeout=15.0
        )
        data = res.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"Groq API Error: {e}")
        return None

async def query_gemini(client: httpx.AsyncClient, prompt: str) -> Optional[str]:
    if not GEMINI_API_KEY or "YOUR_" in GEMINI_API_KEY:
        return None
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
        res = await client.post(
            url,
            headers={"Content-Type": "application/json"},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=15.0
        )
        data = res.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        print(f"Gemini API Error: {e}")
        return None

async def query_qwen(client: httpx.AsyncClient, messages: List[Dict[str, str]], temperature: float = 0.4) -> Optional[str]:
    if not QWEN_API_KEY or "YOUR_" in QWEN_API_KEY:
        return None
    try:
        res = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {QWEN_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/Kevaris/ChefSync",
                "X-Title": "ChefSync AI"
            },
            json={
                "model": "qwen/qwen-2.5-72b-instruct:free",
                "messages": messages,
                "temperature": temperature
            },
            timeout=20.0
        )
        data = res.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"Qwen API Error: {e}")
        return None

def build_chat_messages(system_prompt: str, history: List[Dict[str, Any]], current_msg: str) -> List[Dict[str, str]]:
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        role = "user" if msg.get("role") == "user" else "assistant"
        content = msg.get("content", "")
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": current_msg})
    return messages

@app.post("/chat")
async def chat_endpoint(payload: ChatPayload):
    if payload.code != SECURITY_CODE:
        raise HTTPException(status_code=403, detail="🔒 Unauthorized: Invalid Security Code.")

    prompt = payload.message.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Message content required.")

    if prompt.startswith("MINI_KEVARIS_HELP:"):
        query_text = prompt.replace("MINI_KEVARIS_HELP:", "").strip()
        async with httpx.AsyncClient() as client:
            mini_reply = await query_groq(client, [
                {"role": "system", "content": "You are Mini Kevaris, a helpful assistant."},
                {"role": "user", "content": query_text}
            ])
        return {"reply": mini_reply or "Mini Kevaris is currently offline."}

    # EXACT SLICE CHECK: Check the first 22 characters of the string
    user_intent = prompt[:22].lower()
    ingredients_enter_mode = (user_intent == "available ingredients:")

    async with httpx.AsyncClient() as client:
        # =====================================================================
        # MODE 1: INGREDIENTS ENTERED -> RUN MULTI-AI RECIPE COUNCIL
        # =====================================================================
        if ingredients_enter_mode:
            print("[Python Server] Mode: INGREDIENTS ENTERED -> Generating Recipe")

            clean_ingredients = prompt[22:].replace("*", "").replace("#", "").strip()
            search_context = await search_web(client, f"{clean_ingredients} quick recipe")

            groq_prompt = f"User Request:\n{prompt}\n\nSearch Context:\n{search_context}\n\nDraft a practical recipe using these ingredients."
            gemini_prompt = f"User Request:\n{prompt}\n\nProvide cooking tips, time estimates, and variations."

            groq_draft, gemini_draft = await asyncio.gather(
                query_groq(client, [{"role": "user", "content": groq_prompt}]),
                query_gemini(client, gemini_prompt)
            )

            qwen_system = "You are ChefSync AI by Kevaris. Synthesize the provided drafts into a clear, structured recipe with Title, Ingredients, Instructions, and Cooking Times."
            qwen_user = f"User Request:\n{prompt}\n\nGroq Draft:\n{groq_draft}\n\nGemini Draft:\n{gemini_draft}\n\nSearch Context:\n{search_context}"

            final_reply = await query_qwen(client, [
                {"role": "system", "content": qwen_system},
                {"role": "user", "content": qwen_user}
            ])

            if not final_reply:
                final_reply = groq_draft or gemini_draft or "⚠️ AI Council synthesis failed."

            return {"reply": final_reply}

        # =====================================================================
        # MODE 2: CHAT / FOLLOW-UPS -> FULL CONVERSATION MEMORY
        # =====================================================================
        else:
            print("[Python Server] Mode: FOLLOW-UP QUESTION -> Reading Memory")

            followup_system_prompt = (
                "You are ChefSync AI by Kevaris. Answer the user's follow-up question or message "
                "DIRECTLY using the provided conversation history.\n\n"
                "CRITICAL RULES:\n"
                "1. Answer ONLY what the user asked regarding the previous recipe (e.g., cooking times, steps, substitutions, identity).\n"
                "2. DO NOT perform web searches.\n"
                "3. NEVER generate or invent a new dish/recipe under any circumstances."
            )

            messages = build_chat_messages(followup_system_prompt, payload.history, prompt)

            chat_reply = await query_groq(client, messages)
            if not chat_reply:
                chat_reply = await query_qwen(client, messages)

            return {"reply": chat_reply or "Could you rephrase your question regarding the recipe above?"}

@app.get("/")
def read_root():
    return {"message": "🍳 ChefSync Python Backend is running!"}

# Runs Python server on port 8000 to prevent port collisions with Node.js on port 3000
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
          
