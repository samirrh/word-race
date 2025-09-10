import os
import random
from typing import Dict, List, Optional

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
import socketio

from words import WORDLE_WORDS

# --- Socket.IO server (ASGI) ---
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

asgi_app = socketio.ASGIApp(sio, other_asgi_app=app)

# --- In‑memory room state ---
class Player:
    def __init__(self, sid: str):
        self.sid = sid
        self.guesses: List[str] = []
        self.solved: bool = False
        self.done: bool = False  # solved or out of guesses

class Room:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.solution = random.choice(WORDLE_WORDS)
        self.players: Dict[str, Player] = {}   # sid -> Player (max 2)
        self.spectators: set[str] = set()      # <— add this
        self.typing: Dict[str, bool] = {}
        self.winner_sid: Optional[str] = None
        self.started: bool = False

rooms: Dict[str, Room] = {}

WORD_LEN = 5
MAX_GUESSES = 6

def roster_payload(r: Room):
    return {
        "roomId": r.room_id,
        "players": list(r.players.keys()),
        "numPlayers": len(r.players),
        "numSpectators": len(r.spectators),
    }

def score_guess(guess: str, solution: str) -> List[str]:
    """Return per‑letter feedback: 'g' (green), 'y' (yellow), 'b' (black)."""
    res = ["b"] * WORD_LEN
    sol_counts = {}
    print(solution)
    for i, ch in enumerate(solution):
        if guess[i] == ch:
            res[i] = "g"
        else:
            sol_counts[ch] = sol_counts.get(ch, 0) + 1
    for i, ch in enumerate(guess):
        if res[i] == "g":
            continue
        if sol_counts.get(ch, 0) > 0:
            res[i] = "y"
            sol_counts[ch] -= 1
    return res


def room_public_state(r: Room):
    return {
        "roomId": r.room_id,
        "players": len(r.players),
        "winnerSid": r.winner_sid,
        "started": r.started,
    }

# --- HTTP health ---
@app.get("/health")
async def health():
    return {"ok": True}

# --- Socket.IO events ---
@sio.event
async def connect(sid, environ):
    print("connect", sid)

@sio.event
async def disconnect(sid):
    print("disconnect", sid)
    for r in rooms.values():
        changed = False
        if sid in r.players:
            del r.players[sid]
            changed = True
        if sid in r.spectators:
            r.spectators.remove(sid)
            changed = True
        r.typing.pop(sid, None)
        if changed:
            await sio.emit("room:roster", roster_payload(r), room=r.room_id)
            break

@sio.event
async def room_join(sid, data):
    room_id = str(data.get("roomId", "")).strip() or "lobby"
    r = rooms.get(room_id)
    if not r:
        r = rooms[room_id] = Room(room_id)

    await sio.save_session(sid, {"room": room_id})
    await sio.enter_room(sid, room_id)

    role = "spectator"
    if len(r.players) < 2:
        r.players[sid] = Player(sid)
        role = "player"
        # If this is the second player, notify the existing player someone joined
        if len(r.players) == 2:
            await sio.emit("room:opponent_joined", {"sid": sid}, room=room_id, skip_sid=sid)
    else:
        r.spectators.add(sid)

    # hello to the new connection
    await sio.emit("room:hello", {"youArePlayer": role == "player", "maxGuesses": MAX_GUESSES}, to=sid)
    # broadcast roster to everyone
    await sio.emit("room:roster", roster_payload(r), room=room_id)

@sio.event
async def typing(sid, data):
    session = await sio.get_session(sid)
    room_id = session.get("room")
    if not room_id:
        return
    r = rooms.get(room_id)
    if not r or sid not in r.players:
        return

    length = int(data.get("length", 0))
    r.typing[sid] = length  # store how many letters they're typing

    await sio.emit("typing:update", {"sid": sid, "length": length}, room=room_id, skip_sid=sid)

@sio.event
async def guess(sid, data):
    guess = str(data.get("guess", "")).lower()
    session = await sio.get_session(sid)
    room_id = session.get("room")
    if not room_id or len(guess) != WORD_LEN:
        return
    r = rooms.get(room_id)
    if not r or sid not in r.players:
        return

    p = r.players[sid]
    if p.done or len(p.guesses) >= MAX_GUESSES:
        return
    if guess not in WORDLE_WORDS:
        await sio.emit("guess:rejected", {"reason": "Not in word list"}, to=sid)
        return

    fb = score_guess(guess, r.solution)
    p.guesses.append(guess)

    if guess == r.solution:
        p.solved = True
        p.done = True
        if not r.winner_sid:
            r.winner_sid = sid
    elif len(p.guesses) >= MAX_GUESSES:
        p.done = True

    # Share feedback to everyone (only reveal feedback & row number, not letters typed live)
    payload = {
        "sid": sid,
        "row": len(p.guesses) - 1,
        "guess": guess,  # the guess is visible post‑submit
        "feedback": fb,
        "solved": p.solved,
        "done": p.done,
        "winnerSid": r.winner_sid,
    }
    await sio.emit("guess:result", payload, room=room_id)

    # If both done, also reveal solution and allow reset
    if all(pl.done for pl in r.players.values()) and r.players:
        await sio.emit("room:finished", {"solution": r.solution, "winnerSid": r.winner_sid}, room=room_id)

@sio.event
async def reset_room(sid):
    session = await sio.get_session(sid)
    room_id = session.get("room")
    if not room_id:
        return
    r = rooms.get(room_id)
    if not r:
        return
    r.solution = random.choice(WORDLE_WORDS)
    r.winner_sid = None
    for p in r.players.values():
        p.guesses.clear()
        p.solved = False
        p.done = False
    await sio.emit("room:reset", {"msg": "reset"}, room=room_id)

# Entry point for Uvicorn: uvicorn server.main:asgi_app --reload --port 8000