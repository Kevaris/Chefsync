import os
import re
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
NODE_ENGINE_URL = os.getenv("NODE_ENGINE_URL", "http://localhost:3000/generate")

class FrontendPayload(BaseModel):
    code: str
    message: str
    history: Optional[List[Dict[str, Any]]] = []

async def get_alternative_dishes(client: httpx.AsyncClient, clean_ingredients: str) -> List[str]:
    """Helper function: Queries server.js for 4 quick dish names if Qwen missed them."""
    alt_payload = {
        "mode": "followup_chat",
        "user_query": f"Based on these ingredients: '{clean_ingredients}', list 4 alternative dish names that can be made. Output ONLY 4 dish names, one per line, with no extra text or numbering.",
        "history": []
    }
    try:
        res = await client.post(NODE_ENGINE_URL, json=alt_payload, timeout=15.0)
        if res.status_code == 200:
            raw_text = res.json().get("reply", "")
            lines = [line.strip("- *1234567890.↳").strip() for line in raw_text.split("\n") if line.strip()]
            valid_lines = [l for l in lines if len(l) > 2 and not l.lower().startswith("here")]
            if len(valid_lines) >= 3:
                return valid_lines[:4]
    except Exception as e:
        print(f"[server.py Warning] Fallback triggered for alternative dishes: {e}")
    
    # Safe backup dishes in case of network timeout
    return ["Quick Omelette", "Crispy Stir-Fry", "Spiced Scramble", "Savory Snack Bowl"]

def sanitize_user_message(raw_message: str) -> str:
    """Strips HTML tags like <br> and extra leaked options from option-clicks."""
    # Isolate only the first clicked dish text before any <br> or ↳ tags
    clean = re.split(r'<br\s*/?>|↳|\n', raw_message, flags=re.IGNORECASE)[0].strip()
    
    # Reframe option clicks cleanly
    if clean.lower().startswith("how to create a "):
        dish_name = clean[16:].strip()
        return f"How to create a simple {dish_name}?"
    elif clean.lower().startswith("how to create "):
        dish_name = clean[14:].strip()
        return f"How to create a simple {dish_name}?"
    
    return clean

@app.post("/chat")
async def route_user_request(payload: FrontendPayload):
    # 1. Security Authorization
    if payload.code != SECURITY_CODE:
        raise HTTPException(status_code=403, detail="🔒 Unauthorized Security Code.")

    # Sanitize incoming prompt (removes leaked HTML tags or trailing options)
    prompt = sanitize_user_message(payload.message)
    if not prompt:
        raise HTTPException(status_code=400, detail="Message content required.")

    # 2. Check Mini Kevaris Fast Assistant Mode
    is_mini_help = prompt.startswith("MINI_KEVARIS_HELP:")
    user_intent = prompt[:22].lower()
    ingredients_enter_mode = (user_intent == "available ingredients:")

    if is_mini_help:
        node_payload = {
            "mode": "mini_kevaris",
            "query": prompt.replace("MINI_KEVARIS_HELP:", "").strip()
        }
    elif ingredients_enter_mode:
        print("[server.py] Intent: NEW RECIPE -> Building generation prompt for server.js")
        clean_ingredients = prompt[22:].replace("*", "").replace("#", "").strip()
        node_payload = {
            "mode": "generate_recipe",
            "clean_ingredients": clean_ingredients,
            "raw_prompt": prompt
        }
    else:
        print(f"[server.py] Intent: FOLLOW-UP QUESTION ({prompt}) -> Building memory prompt for server.js")
        clean_ingredients = ""
        node_payload = {
            "mode": "followup_chat",
            "user_query": prompt,
            "history": payload.history
        }

    # 3. Forward constructed prompt to server.js (Engine)
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(NODE_ENGINE_URL, json=node_payload, timeout=60.0)
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="Error from server.js engine.")
            
            engine_data = response.json()
            reply = engine_data.get("reply", "No response generated.")

            # 4. POST-PROCESSING: Guarantee the suggestion block exists for new recipes
            if ingredients_enter_mode and "↳" not in reply:
                print("[server.py] Intercepted missing suggestion block. Fetching and appending automatically...")
                dishes = await get_alternative_dishes(client, clean_ingredients)
                
                suggestion_block = "\n\n---\nYou can also make these recipes:\n"
                for dish in dishes:
                    suggestion_block += f"↳ {dish}\n"
                
                reply += suggestion_block

            return {"reply": reply}

        except httpx.RequestError as exc:
            print(f"[server.py Error] Could not connect to server.js engine: {exc}")
            raise HTTPException(
                status_code=503, 
                detail="Backend Engine (server.js) is not running on port 3000."
            )

@app.get("/")
def root():
    return {"status": "server.py (Backend Router) is running on port 8000!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
        
