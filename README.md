# AI LAB — Building a Logical Model of Time Travel

A 24/7 live-stream-ready scene of two AIs (Alpha the Architect and Beta the Auditor) having an endless conversation, collaboratively inventing a logically consistent model of time travel.

Designed to be captured with OBS at 1920×1080 and streamed to YouTube.

---

## Quick Start

### Prerequisites

- **Node.js** 18 LTS or newer — https://nodejs.org
- An **OpenAI API key** with access to `gpt-5-nano`

### Install & Run

```bash
cd server
npm install
```

Copy the example env file and add your key:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

Open `.env` and paste your real API key:

```
OPENAI_API_KEY=sk-...
PORT=3001
```

Start the server:

```bash
npm run dev
```

Open **http://localhost:3001** in Chrome or Edge.

The conversation begins automatically when the first browser tab connects.

---

## OBS Setup (for YouTube streaming)

1. Add a **Window Capture** source → pick the browser window.
2. Set canvas and output resolution to **1920×1080**.
3. Resize/crop the capture to fill the canvas.
4. Make the browser window full-screen (F11) before capturing for best results.
5. Stream to YouTube as usual.

---

## Moving to a Windows VPS

1. Copy the entire `ai-lab-time-travel` folder to the VPS.
2. Install Node.js LTS on the VPS.
3. Run the same steps above (`npm install`, set `.env`, `npm run dev`).
4. Open `http://localhost:3001` in a browser on the VPS.
5. Use OBS on the VPS (or a remote desktop viewer) to capture the window.

To keep the server running after you close your RDP session, use a process manager:

```bash
npm install -g pm2
cd server
pm2 start server.js --name ai-lab
pm2 save
```

---

## How It Works

- **Server** (`server/server.js`): Node.js HTTP + WebSocket server. Alternates between Alpha and Beta, streaming each response from OpenAI in real time.
- **Conversation memory**: A rolling "Lab Notebook Summary" plus the last 8 turns. Every 20 turns the summary is refreshed and old turns are pruned, so the prompt never grows unbounded.
- **Browser UI** (`web/`): Plain HTML/CSS/JS. Connects via WebSocket, renders words one by one with a pop animation, highlights the active speaker.

### Dependencies

| Package | Purpose |
|---------|---------|
| `openai` | OpenAI API client |
| `ws` | WebSocket server |
| `dotenv` | Load `.env` variables |
