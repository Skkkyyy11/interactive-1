/* =============================================
   MY SPACE — BACKROOMS GAME — CORE LOGIC
   ============================================= */

const WIN_THRESHOLD = 5;
const LOOP_ENTRY    = 'scene_07';
const MAX_LIVES     = 3;

const PARTY_SCENE_ID = 'scene_10';
const PARTY_MIN_LOOP = 1;
const TRAP_CHANCE    = 0.08;

// Bonus anomaly pool (scenes not fixed as anomaly in scenes.json)
const BONUS_POOL  = ['scene_04','scene_05','scene_07','scene_09','scene_10','scene_12'];
const ANOM_TYPES  = ['LIGHT_FLICKER','LIGHT_COLOR','PERSPECTIVE','SIGN_COLOR'];

const G = {
    scenes:       [],
    currentId:    'scene_01',
    streak:       0,
    loopCount:    0,
    lives:        MAX_LIVES,
    visited:      new Set(),
    busy:         false,
    bonusId:      null,
    bonusType:    null,
    lastMistakeAt: 0,
    partySeen:    false,
    inOverlay:    false,
    audioStarted: false,
    audio:        null
};

/* ─── bootstrap ─── */
async function init() {
    try {
        const res = await fetch('scenes.json');
        G.scenes = await res.json();
    } catch (e) {
        console.error('Failed to load scenes.json via API', e);
    }
}

function startGame() {
    document.getElementById('title-screen').classList.add('hidden');
    newBonusAnomaly();
    G.lives = MAX_LIVES;
    updateLivesBar();
    updatePressure();
    G.partySeen = false;
    const door = document.getElementById('door-screen');
    if (door) door.classList.remove('hidden');
}

function handleDoorChoice(type) {
    startAmbientAudio();
    const door = document.getElementById('door-screen');
    if (door) door.classList.add('hidden');

    if (type === 'wait') {
        // Passing the door: brief green-ish calm before the corridor.
        const ov = document.getElementById('anomaly-overlay');
        if (ov) {
            ov.style.opacity = '1';
            ov.style.background = 'rgba(55, 145, 95, 0.10)';
            ov.style.mixBlendMode = 'screen';
            setTimeout(() => {
                ov.style.opacity = '';
                ov.style.background = '';
                ov.style.mixBlendMode = '';
            }, 900);
        }
        goTo('scene_01');
        return;
    }

    // Force door: brief caught flash (1.png), then failure and restart.
    const caught = document.getElementById('caught-overlay');
    if (caught) caught.classList.remove('hidden');
    setTimeout(() => {
        if (caught) caught.classList.add('hidden');
        showFail('The door did not open. You hear footsteps stop right behind it.');
        setTimeout(() => restartGame(), 1200);
    }, 650);
}

/* ─── helpers ─── */
function scene(id) { return G.scenes.find(s => s.id === id); }

function newBonusAnomaly() {
    const pool = [...BONUS_POOL];
    G.bonusId   = pool[Math.floor(Math.random() * pool.length)];
    G.bonusType = ANOM_TYPES[Math.floor(Math.random() * ANOM_TYPES.length)];
}

function isAnomaly(s) {
    return s.id === G.bonusId || s.isAnomaly;
}

function anomalyType(s) {
    if (s.id === G.bonusId) return G.bonusType;
    return s.anomalyType;
}

/* ─── render ─── */
function goTo(id) {
    G.currentId = id;
    G.visited.add(id);

    const s = scene(id);
    if (!s) { console.error('Unknown scene:', id); return; }

    // image
    const img = document.getElementById('game-image');
    img.src = 'images/' + s.image;

    // anomaly CSS
    const container = document.getElementById('scene-container');
    container.className = 'scene-container';
    const aType = anomalyType(s);
    if (isAnomaly(s) && aType) container.classList.add('anomaly-' + aType);

    // HUD
    const num = id.replace('scene_', '').replace(/^0/, '');
    document.getElementById('scene-label').textContent = 'ROOM ' + num.padStart(2,'0');
    document.getElementById('loop-badge').textContent  = G.loopCount > 0 ? `LOOP ×${G.loopCount}` : '';
    updateStreakBar();
    updateLivesBar();
    updatePressure();

    // narrative — show automatically on each scene
    document.getElementById('narrative-text').textContent = s.narrative;
    document.getElementById('narrative-panel').classList.remove('hidden');

    // Partygoer encounter (one-time per run)
    if (!G.partySeen && id === PARTY_SCENE_ID && G.loopCount >= PARTY_MIN_LOOP) {
        G.partySeen = true;
        showParty();
    }

    // map
    renderMap();

    // choices visibility
    const choiceArea = document.getElementById('choice-area');
    if (s.isWin) {
        choiceArea.classList.add('hidden');
        setTimeout(showWin, 1400);
    } else {
        choiceArea.classList.remove('hidden');
    }
}

/* ─── choice handler ─── */
function handleChoice(type) {
    if (G.busy) return;
    const s = scene(G.currentId);
    if (!s || s.isWin) return;

    const correct =
        (type === 'continue' && !isAnomaly(s)) ||
        (type === 'escape'   &&  isAnomaly(s));

    if (correct) {
        G.streak++;
        let next = s.nextScene;

        // Win gate: need WIN_THRESHOLD streak AND be at scene_12
        if (s.id === 'scene_12') {
            if (G.streak >= WIN_THRESHOLD) {
                next = 'scene_13';
            } else {
                G.loopCount++;
                newBonusAnomaly();       // reshuffle bonus anomaly for next loop
                next = LOOP_ENTRY;
            }
        }

        if (!next) { showWin(); return; }
        crossfade(next);
    } else {
        wrongAnswer();
    }
}

/* ─── transitions ─── */
function crossfade(nextId) {
    G.busy = true;
    const c = document.getElementById('scene-container');
    c.classList.add('fade-out');
    setTimeout(() => {
        // Random trap space: costs a life.
        if (shouldTrap(nextId)) {
            G.lives = Math.max(0, G.lives - 1);
            updateLivesBar(true);
            updatePressure(true);
            if (G.lives <= 0) {
                showLevel();
                c.classList.remove('fade-out');
                G.busy = false;
                return;
            }
            // Survived: brief disorientation, continue.
        }
        goTo(nextId);
        c.classList.remove('fade-out');
        c.classList.add('fade-in');
        setTimeout(() => { c.classList.remove('fade-in'); G.busy = false; }, 450);
    }, 450);
}

function shouldTrap(nextId) {
    if (!nextId) return false;
    if (G.inOverlay) return false;
    if (nextId === 'scene_13') return false;
    if (G.streak >= WIN_THRESHOLD) return false;
    if (G.loopCount < 1) return false;
    return Math.random() < TRAP_CHANCE;
}

function wrongAnswer() {
    G.busy = true;

    G.lives = Math.max(0, G.lives - 1);
    G.lastMistakeAt = Date.now();
    updateLivesBar(true);
    updatePressure(true);

    const ov = document.getElementById('wrong-overlay');
    const wrongSub = document.getElementById('wrong-sub');
    if (wrongSub) {
        wrongSub.textContent = G.lives > 0
            ? `Wrong call — chance -1 (${G.lives} left)`
            : 'No chances left — you are lost.';
    }

    ov.classList.add('active');
    setTimeout(() => {
        ov.classList.remove('active');

        if (G.lives <= 0) {
            showFail('No chances left. You can no longer tell how many times you stood under this same light.');
            G.busy = false;
            return;
        }

        // Punish memory but keep you in the space.
        G.streak = 0;
        updateStreakBar();

        // Disorientation: fade-out/in the same scene (no teleport to start).
        const c = document.getElementById('scene-container');
        c.classList.add('fade-out');
        setTimeout(() => {
            goTo(G.currentId);
            c.classList.remove('fade-out');
            c.classList.add('fade-in');
            setTimeout(() => { c.classList.remove('fade-in'); G.busy = false; }, 450);
        }, 420);
    }, 1200);
}

function showFail(msg) {
    const fail = document.getElementById('fail-screen');
    if (fail) fail.classList.remove('hidden');
    const choiceArea = document.getElementById('choice-area');
    if (choiceArea) choiceArea.classList.add('hidden');
    const sub = document.querySelector('#fail-screen .fail-sub');
    if (sub && msg) sub.textContent = msg;
}

function showLevel() {
    G.inOverlay = true;
    const level = document.getElementById('level-screen');
    if (level) level.classList.remove('hidden');
    const choiceArea = document.getElementById('choice-area');
    if (choiceArea) choiceArea.classList.add('hidden');
}

function showParty() {
    G.inOverlay = true;
    const p = document.getElementById('party-overlay');
    if (p) p.classList.remove('hidden');
    const choiceArea = document.getElementById('choice-area');
    if (choiceArea) choiceArea.classList.add('hidden');
    const r = document.getElementById('party-result');
    if (r) r.textContent = '';
}

function handlePartyChoice(opt) {
    startAmbientAudio();
    const r = document.getElementById('party-result');

    if (opt === 'C') {
        if (r) r.textContent = 'You don\'t respond. You turn and walk away. No footsteps behind you — but the smile lingers.';
        setTimeout(() => {
            const p = document.getElementById('party-overlay');
            if (p) p.classList.add('hidden');
            G.inOverlay = false;
            const s = scene(G.currentId);
            if (s && s.nextScene) crossfade(s.nextScene);
        }, 900);
        return;
    }

    if (opt === 'A') {
        if (r) r.textContent = 'You take the balloon. The string wraps around your hand. It steps closer. Its smile grows. You start smiling too. 🙂🙂🙂';
    } else {
        if (r) r.textContent = 'You nod and slowly step back. The corridor lights flash. You realize you\'ve backed into a doorway.';
    }

    G.lives = Math.max(0, G.lives - 1);
    updateLivesBar(true);
    updatePressure(true);

    setTimeout(() => {
        const p = document.getElementById('party-overlay');
        if (p) p.classList.add('hidden');
        if (G.lives <= 0) {
            showLevel();
        } else {
            G.inOverlay = false;
            const s = scene(G.currentId);
            if (s && s.nextScene) crossfade(s.nextScene);
        }
    }, 1200);
}

/* ─── streak bar ─── */
function updateStreakBar() {
    const bar = document.getElementById('streak-bar');
    bar.innerHTML = '';
    for (let i = 0; i < WIN_THRESHOLD; i++) {
        const d = document.createElement('span');
        d.className = 's-dot' + (i < G.streak ? ' on' : '');
        bar.appendChild(d);
    }
}

/* ─── narrative toggle ─── */
function toggleNarrative() {
    document.getElementById('narrative-panel').classList.toggle('hidden');
}

/* ─── map toggle ─── */
function toggleMap() {
    const ov = document.getElementById('map-overlay');
    ov.classList.toggle('hidden');
    if (!ov.classList.contains('hidden')) renderMap();
}

/* ─── win / restart ─── */
function showWin() {
    const unlock = document.getElementById('unlock-overlay');
    if (unlock) unlock.classList.remove('hidden');
    setTimeout(() => {
        if (unlock) unlock.classList.add('hidden');
        document.getElementById('win-streak-val').textContent = G.streak;
        document.getElementById('win-loop-val').textContent   = G.loopCount;
        document.getElementById('win-screen').classList.remove('hidden');
    }, 1400);
}

function restartGame() {
    G.streak    = 0;
    G.loopCount = 0;
    G.lives     = MAX_LIVES;
    G.visited.clear();
    G.busy      = false;
    G.inOverlay = false;
    G.partySeen = false;
    newBonusAnomaly();
    const fail = document.getElementById('fail-screen');
    if (fail) fail.classList.add('hidden');
    const level = document.getElementById('level-screen');
    if (level) level.classList.add('hidden');
    const party = document.getElementById('party-overlay');
    if (party) party.classList.add('hidden');
    const unlock = document.getElementById('unlock-overlay');
    if (unlock) unlock.classList.add('hidden');
    const door = document.getElementById('door-screen');
    if (door) door.classList.add('hidden');
    const caught = document.getElementById('caught-overlay');
    if (caught) caught.classList.add('hidden');
    document.getElementById('win-screen').classList.add('hidden');
    document.getElementById('scene-container').className = 'scene-container';
    document.getElementById('choice-area').classList.remove('hidden');
    updateLivesBar();
    updatePressure();
    startGame();
}

/* ─── audio (synth ambient) ─── */
function startAmbientAudio() {
    if (G.audioStarted) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        const master = ctx.createGain();
        master.gain.value = 0.055;
        master.connect(ctx.destination);

        // Drone oscillator
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 44;

        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.08;

        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 14;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 260;
        filt.Q.value = 0.8;

        const drift = ctx.createOscillator();
        drift.type = 'sine';
        drift.frequency.value = 0.12;
        const driftGain = ctx.createGain();
        driftGain.gain.value = 40;
        drift.connect(driftGain);
        driftGain.connect(filt.frequency);

        osc.connect(filt);
        filt.connect(master);

        // Subtle noise layer
        const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.12;
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuf;
        noise.loop = true;

        const noiseFilt = ctx.createBiquadFilter();
        noiseFilt.type = 'highpass';
        noiseFilt.frequency.value = 800;

        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0.015;
        noise.connect(noiseFilt);
        noiseFilt.connect(noiseGain);
        noiseGain.connect(master);

        osc.start();
        lfo.start();
        drift.start();
        noise.start();

        // Occasional distant step pulses
        const step = () => {
            const now = ctx.currentTime;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, now);
            g.gain.linearRampToValueAtTime(0.06, now + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

            const b = ctx.createBufferSource();
            b.buffer = noiseBuf;
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 140;
            bp.Q.value = 1.2;
            b.connect(bp);
            bp.connect(g);
            g.connect(master);
            b.start(now);
            b.stop(now + 0.25);

            const t = 2500 + Math.random() * 4500;
            setTimeout(step, t);
        };
        setTimeout(step, 2400 + Math.random() * 1200);

        G.audioStarted = true;
        G.audio = { ctx, master };
    } catch (e) {
        console.warn('Audio init failed', e);
    }
}

/* ─── lives bar ─── */
function updateLivesBar(animateHit = false) {
    const bar = document.getElementById('lives-bar');
    if (!bar) return;
    bar.innerHTML = '';
    for (let i = 0; i < MAX_LIVES; i++) {
        const d = document.createElement('span');
        const on = i < G.lives;
        d.className = 'life' + (on ? '' : ' off');
        if (animateHit && i === G.lives) d.classList.add('hit');
        bar.appendChild(d);
    }
}

/* ─── atmosphere pressure ─── */
function updatePressure(mistakePulse = false) {
    const loopsFactor = Math.min(1, G.loopCount / 4);
    const livesFactor = Math.min(1, (MAX_LIVES - G.lives) / MAX_LIVES);

    // 0..1
    let p = Math.min(1, (loopsFactor * 0.65) + (livesFactor * 0.55));

    // Short pulse after mistake
    if (mistakePulse) p = Math.min(1, p + 0.18);

    document.documentElement.style.setProperty('--pressure', String(p));
}

/* ─── SVG minimap ─── */
function renderMap() {
    const svg = document.getElementById('map-svg');
    if (!svg || !G.scenes.length) return;

    // Node positions (x,y) within viewBox 1200×500
    const POS = {
        scene_01: { x:80,  y:110 },
        scene_02: { x:250, y:110 },
        scene_03: { x:420, y:110 },
        scene_04: { x:590, y:110 },
        scene_05: { x:760, y:110 },
        scene_06: { x:930, y:110 },
        scene_07: { x:1120,y:110 },   // loop entry (far right)
        scene_08: { x:1120,y:380 },
        scene_09: { x:940, y:380 },
        scene_10: { x:760, y:380 },
        scene_11: { x:580, y:380 },
        scene_12: { x:400, y:380 },
        scene_13: { x:170, y:380 },
    };

    // Edges
    const EDGES = [
        ['scene_01','scene_02'],['scene_02','scene_03'],['scene_03','scene_04'],
        ['scene_04','scene_05'],['scene_05','scene_06'],
        // gap: 06 → 07 is a right-turn, drawn as elbow
        ['scene_07','scene_08'],['scene_08','scene_09'],['scene_09','scene_10'],
        ['scene_10','scene_11'],['scene_11','scene_12'],
        // scene_12 → scene_13 (win)
    ];

    let html = '';

    // Elbow: scene_06 → scene_07
    const p6 = POS['scene_06'], p7 = POS['scene_07'];
    const e06_07_vis = G.visited.has('scene_06') && G.visited.has('scene_07');
    const ec = e06_07_vis ? 'rgba(225,220,205,0.9)' : 'rgba(165,160,150,0.65)';
    html += `<polyline points="${p6.x},${p6.y} ${p7.x-50},${p6.y} ${p7.x},${p7.y}"
        fill="none" stroke="${ec}" stroke-width="4"/>`;

    // Elbow: scene_12 → scene_13
    const p12 = POS['scene_12'], p13 = POS['scene_13'];
    const e12_13_vis = G.visited.has('scene_12') && G.visited.has('scene_13');
    const ec2 = e12_13_vis ? 'rgba(225,220,205,0.9)' : 'rgba(165,160,150,0.65)';
    html += `<line x1="${p12.x}" y1="${p12.y}" x2="${p13.x}" y2="${p13.y}"
        stroke="${ec2}" stroke-width="4"/>`;

    // Loop-back arc: scene_12 back to scene_07
    const lx = (p12.x + p7.x) / 2;
    html += `<path d="M ${p12.x} ${p12.y+38} Q ${lx} 480 ${p7.x} ${p7.y+38}"
        fill="none" stroke="rgba(215,120,100,0.65)" stroke-width="3" stroke-dasharray="10,7"/>`;
    html += `<text x="${lx}" y="488" text-anchor="middle"
        font-family="Courier New" font-size="18" fill="rgba(220,125,105,0.75)" letter-spacing="5">LOOP</text>`;

    // Regular edges
    for (const [a, b] of EDGES) {
        const pa = POS[a], pb = POS[b];
        if (!pa || !pb) continue;
        const vis = G.visited.has(a) && G.visited.has(b);
        const col = vis ? 'rgba(225,220,205,0.9)' : 'rgba(165,160,150,0.65)';
        html += `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}"
            stroke="${col}" stroke-width="4"/>`;
    }

    // Nodes
    for (const s of G.scenes) {
        const pos = POS[s.id]; if (!pos) continue;
        const isCur  = s.id === G.currentId;
        const isVis  = G.visited.has(s.id);
        const isAnom = isAnomaly(s);
        const isWin  = s.isWin;

        let fill   = 'rgba(75,72,64,0.95)';
        let stroke = 'rgba(180,175,162,0.8)';
        let tCol   = 'rgba(200,195,182,0.85)';
        const sw   = isCur ? 3.5 : 2.5;

        if (isCur) {
            fill   = 'rgba(240,235,220,0.98)';
            stroke = 'rgba(255,250,235,1)';
            tCol   = 'rgba(0,0,0,0.92)';
        } else if (isWin && isVis) {
            fill   = 'rgba(75,155,75,0.75)';
            stroke = 'rgba(110,195,110,0.85)';
            tCol   = 'rgba(160,230,160,0.95)';
        } else if (isVis && isAnom) {
            fill   = 'rgba(160,62,50,0.75)';
            stroke = 'rgba(210,95,80,0.85)';
            tCol   = 'rgba(235,170,160,0.95)';
        } else if (isVis) {
            fill   = 'rgba(105,102,92,0.82)';
            stroke = 'rgba(200,195,180,0.8)';
            tCol   = 'rgba(230,225,210,0.95)';
        }

        const R = 34;
        html += `<circle cx="${pos.x}" cy="${pos.y}" r="${R}"
            fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

        const label = s.id.replace('scene_0','').replace('scene_','');
        html += `<text x="${pos.x}" y="${pos.y+8}" text-anchor="middle"
            font-family="Courier New" font-size="22" font-weight="bold" fill="${tCol}">${label}</text>`;

        // Anomaly marker dot (if visited & anomaly)
        if (isAnom && isVis && !isCur) {
            html += `<circle cx="${pos.x+24}" cy="${pos.y-24}" r="9"
                fill="rgba(230,90,72,0.95)"/>`;
        }
    }

    svg.innerHTML = html;
}

/* ─── start ─── */
init();
