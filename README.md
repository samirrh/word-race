# Wordle Race

Real-time Wordle game built with FastAPI (Python) and React.  
Players join the same room and race to solve the same Wordle word with spectators

## Features
- Two players per room; additional users join as spectators
- Real-time typing indicators (shows input progress, not letters)
- Wordle feedback colors (green, yellow, gray)
- Live opponent and spectator status
- Room reset for rematches

## Requirements
- Python 3.10+
- Node.js 18+

## Running the Server
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:asgi_app --reload --port 8000

## Video Demo
https://github.com/user-attachments/assets/acb2fadf-828b-4027-b3e6-ad7f1f15bd71
very limited video demo with core functionality, adding better demo with deployment


