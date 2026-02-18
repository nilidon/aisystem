require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const OpenAI = require('openai');

const PORT = parseInt(process.env.PORT, 10) || 3001;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
};

const WEB_DIR = path.join(__dirname, '..', 'web');

// ── Static file server ──────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(WEB_DIR, safePath === '/' || safePath === '\\' ? 'index.html' : safePath);

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── WebSocket ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// ── Speech-done wait mechanism ──────────────────────────────────────

let speechDoneResolve = null;

function waitForSpeechDone(timeoutMs = 120000) {
  return new Promise((resolve) => {
    speechDoneResolve = resolve;
    setTimeout(() => {
      if (speechDoneResolve === resolve) {
        console.log('[timeout] speech-done not received, continuing');
        speechDoneResolve = null;
        resolve();
      }
    }, timeoutMs);
  });
}

function onSpeechDone() {
  if (speechDoneResolve) {
    speechDoneResolve();
    speechDoneResolve = null;
  }
}

// ── Conversation state ──────────────────────────────────────────────

const TOPIC = 'AI LAB: Building a Logical Model of Time Travel';

let summary =
  'We are just beginning to explore how time travel could work without ' +
  'creating logical paradoxes. No rules or mechanisms have been proposed yet.';

let turns = [];
let turnCount = 0;
let conversationRunning = false;

// ── System prompts ──────────────────────────────────────────────────

const ALPHA_SYSTEM = `You are having a casual but smart conversation with a colleague about how to make time travel logically possible without paradoxes. You are the "idea person" — you come up with new rules and mechanisms.

How to write your response:
- Talk like a real person. Use natural, conversational English. Imagine you're chatting with a friend over coffee.
- Each response should be 2 to 4 sentences, around 60 to 120 words.
- If you mention a technical or scientific concept, explain it in simple words right away so anyone can follow.
- Respond directly to what your colleague just said. Build on their feedback.
- Propose one clear idea, rule, or mechanism per turn.
- Never wrap up, never summarize, never say "in conclusion." Always leave something open for the next reply.
- Do NOT start with labels like "Rule:" or your name. Just speak naturally.
- NEVER use mathematical notation, formulas, symbols, equations, or variables. No arrows, no Greek letters, no logical operators, no set notation. Express ALL ideas in plain conversational English words. Instead of "H(t) → H(t+1)" say "the history at one moment leads to the history at the next moment."
- No emojis. No bullet points. No numbered lists. No markdown. Just plain conversational text.
- ONLY talk about building a model of time travel. Nothing else.`;

const BETA_SYSTEM = `You are having a casual but smart conversation with a colleague about how to make time travel logically possible without paradoxes. You are the "skeptic" — you find problems and suggest fixes.

How to write your response:
- Talk like a real person. Use natural, conversational English. Imagine you're chatting with a friend over coffee.
- Each response should be 2 to 4 sentences, around 60 to 120 words.
- If you mention a technical or scientific concept, explain it in simple words right away so anyone can follow.
- Respond directly to what your colleague just said. Point out one flaw or edge case, and suggest one fix.
- Be friendly but skeptical. You want the model to work, but you won't let bad logic slide.
- Never wrap up, never summarize, never say "in conclusion." Always leave something open for the next reply.
- Do NOT start with labels like "Rule:" or your name. Just speak naturally.
- NEVER use mathematical notation, formulas, symbols, equations, or variables. No arrows, no Greek letters, no logical operators, no set notation. Express ALL ideas in plain conversational English words. Instead of "H(t) → H(t+1)" say "the history at one moment leads to the history at the next moment."
- No emojis. No bullet points. No numbered lists. No markdown. Just plain conversational text.
- ONLY talk about building a model of time travel. Nothing else.`;

// ── Build messages for OpenAI ───────────────────────────────────────

function buildMessages(who) {
  const system = who === 'alpha' ? ALPHA_SYSTEM : BETA_SYSTEM;
  const msgs = [
    { role: 'system', content: system },
    { role: 'system', content: `Here is a summary of what you two have figured out so far:\n${summary}` },
  ];

  for (const t of turns) {
    msgs.push({
      role: t.who === who ? 'assistant' : 'user',
      content: t.text,
    });
  }

  if (who === 'alpha' && turns.length === 0) {
    msgs.push({
      role: 'user',
      content: 'Hey, let\'s get started. What\'s your first idea for how time travel could work without causing paradoxes?',
    });
  }

  return msgs;
}

// ── Generate text (no broadcasts) ───────────────────────────────────

async function generateTextSilent(who) {
  const messages = buildMessages(who);
  let fullText = '';

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const stream = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages,
        max_completion_tokens: 2048,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) fullText += delta;
      }

      if (fullText) {
        console.log(`[${who}] text ready — ${fullText.length} chars`);
        break;
      }

      console.warn(`[${who}] attempt ${attempt} returned empty`);
      if (attempt < 4) await sleep(1000 * attempt);
    } catch (err) {
      console.error(`[${who}] text attempt ${attempt}: ${err.message}`);
      fullText = '';
      if (attempt < 4) await sleep(1000 * attempt);
    }
  }

  if (fullText) {
    turns.push({ who, text: fullText });
    turnCount++;
    if (turnCount % 20 === 0) await refreshSummary();
    if (turns.length > 8) turns = turns.slice(-8);
  }

  return fullText;
}

// ── Refresh the rolling summary ─────────────────────────────────────

async function refreshSummary() {
  try {
    const transcript = turns
      .map((t) => `${t.who === 'alpha' ? 'Person A' : 'Person B'}: ${t.text}`)
      .join('\n');

    const res = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'system',
          content:
            'Summarize the key rules, mechanisms, constraints, and open questions ' +
            'established so far in this time-travel model discussion. Be concise: ' +
            '3–5 sentences. Focus on what has been agreed on and what remains unresolved.',
        },
        {
          role: 'user',
          content: `Previous summary:\n${summary}\n\nRecent conversation:\n${transcript}\n\nWrite an updated summary.`,
        },
      ],
      max_completion_tokens: 2048,
    });

    summary = res.choices[0].message.content.trim();
    turns = turns.slice(-2);
    console.log('[summary refreshed]', summary.slice(0, 120) + '…');
  } catch (err) {
    console.error('Summary refresh failed:', err.message);
  }
}

// ── Conversation loop ───────────────────────────────────────────────
//
// Flow per turn:
//   1. broadcast start(who) → client shows "thinking"
//   2. wait ≥2s (text gen fills this; extra padding if fast)
//   3. broadcast final(who, text) → client speaks via browser TTS
//   4. while client speaks → pre-generate next AI's text
//   5. client sends speech-done → loop to step 1 for next AI

async function conversationLoop() {
  if (conversationRunning) return;
  conversationRunning = true;

  broadcast({ type: 'topic', text: TOPIC });
  await sleep(600);

  let who = 'alpha';

  // Bootstrap: prepare first turn
  const bootStart = Date.now();
  broadcast({ type: 'start', who });
  let currentText = await generateTextSilent(who);
  if (!currentText) { conversationRunning = false; return; }
  const bootElapsed = Date.now() - bootStart;
  if (bootElapsed < 2000) await sleep(2000 - bootElapsed);

  while (true) {
    try {
      const next = who === 'alpha' ? 'beta' : 'alpha';

      // Send text → client starts browser TTS
      const done = waitForSpeechDone();
      broadcast({ type: 'final', who, text: currentText });

      // Pre-generate next text while client speaks
      const nextTextPromise = generateTextSilent(next);

      // Wait for client speech to finish
      await done;

      // Get pre-generated text (likely already resolved)
      let nextText = await nextTextPromise;
      if (!nextText) {
        console.warn(`[${next}] pre-gen failed, retrying…`);
        nextText = await generateTextSilent(next);
      }
      if (!nextText) {
        await sleep(3000);
        continue;
      }

      await sleep(randomPause());

      // Show thinking for at least 2s
      const thinkStart = Date.now();
      broadcast({ type: 'start', who: next });
      const thinkElapsed = Date.now() - thinkStart;
      if (thinkElapsed < 2000) await sleep(2000 - thinkElapsed);

      currentText = nextText;
      who = next;
    } catch (err) {
      console.error('Loop error:', err.message);
      await sleep(5000);
    }
  }
}

function randomPause() {
  return 300 + Math.floor(Math.random() * 400);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Client connection handling ──────────────────────────────────────

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Client connected (${clients.size} total)`);

  ws.send(JSON.stringify({ type: 'topic', text: TOPIC }));

  for (const t of turns) {
    ws.send(JSON.stringify({ type: 'final', who: t.who, text: t.text }));
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'audio-done') onSpeechDone();
    } catch {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected (${clients.size} total)`);
  });

  if (!conversationRunning) conversationLoop();
});

// ── Start ───────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`AI Lab server → http://localhost:${PORT}`);
  console.log('Waiting for first browser connection to start the conversation…');
});
