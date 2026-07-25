import os
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

app = FastAPI(title="ChefSync Pipeline Router")

# Enable CORS for index.html frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECURITY_CODE = "kevaris 57744"
NODE_ENGINE_URL = "http://localhost:3000/generate"

class FrontendPayload(BaseModel):
    code: str
    message: str
    history: Optional[List[Dict[str, Any]]] = []

@app.post("/chat")
async def route_user_request(payload: FrontendPayload):
    # 1. Security Authorization
    if payload.code != SECURITY_CODE:
        raise HTTPException(status_code=403, detail="🔒 Unauthorized Security Code.")

    prompt = payload.message.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Message content required.")

    # 2. Check Mini Kevaris Fast Assistant Mode
    if prompt.startswith("MINI_KEVARIS_HELP:"):
        node_payload = {
            "mode": "mini_kevaris",
            "query": prompt.replace("MINI_KEVARIS_HELP:", "").strip()
        }
    else:
        # 3. Intent Detection Logic (Exact 22-character slice)
        user_intent = prompt[:22].lower()
        ingredients_enter_mode = (user_intent == "available ingredients:")

        if ingredients_enter_mode:
            print("[server.py] Intent: NEW RECIPE -> Building generation prompt for server.js")
            clean_ingredients = prompt[22:].replace("*", "").replace("#", "").strip()
            node_payload = {
                "mode": "generate_recipe",
                "clean_ingredients": clean_ingredients,
                "raw_prompt": prompt
            }
        else:
            print("[server.py] Intent: FOLLOW-UP QUESTION -> Building memory prompt for server.js")
            node_payload = {
                "mode": "followup_chat",
                "user_query": prompt,
                "history": payload.history
            }

    # 4. Forward constructed prompt to server.js (Engine)
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(NODE_ENGINE_URL, json=node_payload, timeout=60.0)
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Error from server.js engine.")
            
            engine_data = response.json()
            return {"reply": engine_data.get("reply", "No response generated.")}

        except httpx.RequestError as exc:
            print(f"[server.py Error] Could not connect to server.js engine: {exc}")
            raise HTTPException(
                status_code=503, 
                detail="Backend Engine (server.js) is not running on port 3000."
            )

@app.get("/")
def root():
    return {"status": "server.py (Backend I Router) is running on port 8000!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
