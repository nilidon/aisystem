(() => {
  'use strict';

  // ── DOM refs ────────────────────────────────────────────────────────

  const msgAlpha     = document.getElementById('msg-alpha');
  const msgBeta      = document.getElementById('msg-beta');
  const panelAlpha   = document.getElementById('panel-alpha');
  const panelBeta    = document.getElementById('panel-beta');
  const statusEl     = document.getElementById('status');
  const counterEl    = document.getElementById('turn-counter');
  const overlayAlpha = document.getElementById('overlay-alpha');
  const overlayBeta  = document.getElementById('overlay-beta');
  const startScreen  = document.getElementById('start-screen');

  // ── State ───────────────────────────────────────────────────────────

  let activeSpeaker    = null;
  let pendingText      = '';
  let wordEls          = [];
  let animIdx          = 0;
  let streaming        = { alpha: false, beta: false };
  let totalTurns       = 0;
  let wsRef            = null;
  let speechCleanedUp  = false;
  let keepAliveTimer   = null;

  // ── Voice setup (browser SpeechSynthesis — free) ──────────────────

  let voiceAlpha = null;
  let voiceBeta  = null;

  function loadVoices() {
    const all = speechSynthesis.getVoices();
    const en = all.filter((v) => v.lang.startsWith('en'));
    if (en.length === 0) return;

    console.log('Available EN voices:', en.map((v) => v.name).join(', '));

    // Tier 1: neural "Online" voices (Edge) — sound nearly human
    const neural = en.filter((v) => /online|natural|neural/i.test(v.name));
    // Tier 2: Google voices (Chrome) — decent
    const google = en.filter((v) => /google/i.test(v.name));
    // Tier 3: everything else (desktop voices — robotic)
    const pool = neural.length >= 2 ? neural : google.length >= 2 ? google : en;

    // Pick two distinct voices, prefer male + female
    const v1 = pool.find((v) => /christopher|andrew|eric|steffan|roger|ryan/i.test(v.name))
             || pool.find((v) => /brian|davis|jacob/i.test(v.name))
             || pool.find((v) => /uk english male/i.test(v.name))
             || pool[0];
    const v2 = pool.find((v) => v !== v1 && /aria|jenny|emma|michelle|ana|sonia/i.test(v.name))
             || pool.find((v) => v !== v1 && /us english/i.test(v.name))
             || pool.find((v) => v !== v1)
             || pool[0];

    voiceAlpha = v1;
    voiceBeta = v2;

    const tier = neural.length >= 2 ? 'neural' : google.length >= 2 ? 'google' : 'desktop';
    console.log(`Voice tier: ${tier} | AI-1: ${voiceAlpha?.name} | AI-2: ${voiceBeta?.name}`);
  }

  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();

  // ── Helpers ─────────────────────────────────────────────────────────

  function containerOf(who) {
    return who === 'alpha' ? msgAlpha : msgBeta;
  }

  const other = (who) => (who === 'alpha' ? 'beta' : 'alpha');

  function setActive(who) {
    panelAlpha.classList.toggle('active', who === 'alpha');
    panelBeta.classList.toggle('active', who === 'beta');
    panelAlpha.classList.toggle('dim', who !== 'alpha');
    panelBeta.classList.toggle('dim', who !== 'beta');
  }

  function showOverlay(panelId, type) {
    const overlay = panelId === 'alpha' ? overlayAlpha : overlayBeta;
    const img = overlay.querySelector('.state-img');
    const label = overlay.querySelector('.state-label');
    img.src = type === 'thinking' ? 'thinking.png' : 'listening.png';
    label.textContent = type === 'thinking' ? 'Thinking' : 'Listening';
    overlay.classList.add('visible');
  }

  function hideOverlay(panelId) {
    (panelId === 'alpha' ? overlayAlpha : overlayBeta).classList.remove('visible');
  }

  function hideAllOverlays() {
    overlayAlpha.classList.remove('visible');
    overlayBeta.classList.remove('visible');
  }

  function splitWords(text) {
    return text.match(/\S+/g) || [];
  }

  function sendToServer(msg) {
    if (wsRef && wsRef.readyState === WebSocket.OPEN) {
      wsRef.send(JSON.stringify(msg));
    }
  }

  // ── Stop any running speech + animation ───────────────────────────

  function finalizeAnimation() {
    speechCleanedUp = true;
    if (keepAliveTimer) {
      clearTimeout(keepAliveTimer);
      keepAliveTimer = null;
    }
    speechSynthesis.cancel();
    for (let i = animIdx; i < wordEls.length; i++) {
      wordEls[i].classList.add('pop');
    }
  }

  // ── Render words hidden (ready to animate) ────────────────────────

  function renderWordsHidden(who, text) {
    const el = containerOf(who);
    el.innerHTML = '';
    const words = splitWords(text);
    wordEls = [];
    animIdx = 0;
    words.forEach((w) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = w + ' ';
      el.appendChild(span);
      wordEls.push(span);
    });
    return words.length;
  }

  // ── Render static (for catch-up messages) ─────────────────────────

  function renderStatic(who, text) {
    const el = containerOf(who);
    el.innerHTML = '';
    splitWords(text).forEach((w) => {
      const span = document.createElement('span');
      span.className = 'word pop';
      span.textContent = w + ' ';
      el.appendChild(span);
    });
  }

  // ── Speak using browser SpeechSynthesis (free) ────────────────────

  function speak(who, text) {
    if (!window.speechSynthesis) {
      animateFallback(who);
      return;
    }

    speechCleanedUp = false;
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = who === 'alpha' ? voiceAlpha : voiceBeta;
    utterance.rate = 0.95;
    utterance.pitch = who === 'alpha' ? 1.0 : 1.1;

    // Precompute character positions of each word for boundary sync
    const positions = [];
    const regex = /\S+/g;
    let m;
    while ((m = regex.exec(text)) !== null) positions.push(m.index);

    let boundaryFired = false;

    utterance.addEventListener('start', () => {
      hideOverlay(who);
      containerOf(other(who)).innerHTML = '';
      showOverlay(other(who), 'listening');
    });

    utterance.addEventListener('boundary', (e) => {
      if (e.name !== 'word') return;
      boundaryFired = true;

      let target = 0;
      for (let i = 0; i < positions.length; i++) {
        if (positions[i] <= e.charIndex) target = i;
        else break;
      }
      while (animIdx <= target && animIdx < wordEls.length) {
        wordEls[animIdx].classList.add('pop');
        animIdx++;
      }
      containerOf(who).scrollTop = containerOf(who).scrollHeight;
    });

    function done() {
      if (keepAliveTimer) {
        clearTimeout(keepAliveTimer);
        keepAliveTimer = null;
      }
      if (speechCleanedUp) return;
      speechCleanedUp = true;
      for (let i = animIdx; i < wordEls.length; i++) {
        wordEls[i].classList.add('pop');
      }
      containerOf(other(who)).innerHTML = '';
      hideAllOverlays();
      sendToServer({ type: 'audio-done' });
    }

    utterance.addEventListener('end', done);
    utterance.addEventListener('error', (e) => {
      if (e.error === 'canceled') return;
      console.error('Speech error:', e.error);
      done();
    });

    speechSynthesis.speak(utterance);

    // Chrome bug workaround: speech cuts off after ~15s without this
    function keepAlive() {
      if (speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
      if (speechSynthesis.speaking) {
        keepAliveTimer = setTimeout(keepAlive, 10000);
      }
    }
    keepAliveTimer = setTimeout(keepAlive, 10000);

    // Safety: if speech hasn't started in 5s, fall back to animation
    const safetyTimeout = setTimeout(() => {
      if (!speechCleanedUp && !speechSynthesis.speaking) {
        console.warn('Speech never started, falling back');
        speechSynthesis.cancel();
        animateFallback(who);
      }
    }, 5000);

    utterance.addEventListener('start', () => clearTimeout(safetyTimeout));

    // Extra safety: if boundary events never fire, use a timer fallback
    // that gradually reveals words based on estimated speech duration
    utterance.addEventListener('end', () => {
      if (!boundaryFired && animIdx < wordEls.length) {
        for (let i = animIdx; i < wordEls.length; i++) {
          wordEls[i].classList.add('pop');
        }
      }
    });
  }

  // ── Fallback: animate without voice ───────────────────────────────

  function animateFallback(who) {
    hideOverlay(who);
    containerOf(other(who)).innerHTML = '';
    showOverlay(other(who), 'listening');

    if (wordEls.length === 0) {
      renderWordsHidden(who, pendingText);
    }

    const perWord = 70;
    animIdx = 0;
    const timer = setInterval(() => {
      if (animIdx < wordEls.length) {
        wordEls[animIdx].classList.add('pop');
        animIdx++;
        containerOf(who).scrollTop = containerOf(who).scrollHeight;
      } else {
        clearInterval(timer);
        containerOf(other(who)).innerHTML = '';
        hideAllOverlays();
        if (!speechCleanedUp) {
          speechCleanedUp = true;
          sendToServer({ type: 'audio-done' });
        }
      }
    }, perWord);
  }

  // ── Message handlers ──────────────────────────────────────────────

  function onStart(who) {
    finalizeAnimation();

    activeSpeaker = who;
    streaming[who] = true;
    pendingText = '';
    wordEls = [];
    animIdx = 0;

    containerOf(who).innerHTML = '';
    setActive(who);

    hideAllOverlays();
    showOverlay(who, 'thinking');
  }

  function onDelta(who, text) {
    if (who !== activeSpeaker) return;
    pendingText += text;
  }

  function onFinal(who, text) {
    if (streaming[who]) {
      streaming[who] = false;
      pendingText = text;
      totalTurns++;
      counterEl.textContent = 'TURN ' + totalTurns;

      renderWordsHidden(who, text);
      speak(who, text);
    } else {
      renderStatic(who, text);
      totalTurns++;
      counterEl.textContent = 'TURN ' + totalTurns;
    }
  }

  // ── Click-to-start (helps with browser speech permissions) ────────

  if (startScreen) {
    startScreen.addEventListener('click', () => {
      startScreen.classList.add('hidden');
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume();
    });
  }

  // ── WebSocket with auto-reconnect ─────────────────────────────────

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}`);
    wsRef = ws;

    ws.addEventListener('open', () => {
      statusEl.textContent = 'CONNECTED';
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'topic':
          break;
        case 'start':
          onStart(msg.who);
          break;
        case 'delta':
          onDelta(msg.who, msg.text);
          break;
        case 'final':
          onFinal(msg.who, msg.text);
          break;
      }
    });

    ws.addEventListener('close', () => {
      statusEl.textContent = 'RECONNECTING…';
      wsRef = null;
      setTimeout(connect, 2000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  connect();
})();
