const CARD_BACK_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='488' height='680'%3E%3Crect width='100%25' height='100%25' fill='%2310182f'/%3E%3Crect x='20' y='20' width='448' height='640' rx='26' ry='26' fill='%231a2447' stroke='%23384d86' stroke-width='8'/%3E%3Ctext x='50%25' y='50%25' fill='%23d9e2ff' font-size='38' text-anchor='middle' font-family='Segoe UI, Arial' dy='0.3em'%3EMTG%3C/text%3E%3C/svg%3E";
const cardArtCache = new Map();
const pendingCardArt = new Set();
const cardMetaCache = new Map();

function cleanCardName(name) {
  return String(name || "").replace(/\s*\(Auto-fill\)$/i, "").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCardArt(name) {
  const cleaned = cleanCardName(name);
  if (!cleaned) return CARD_BACK_PLACEHOLDER;
  if (cleaned === "Card Back") return CARD_BACK_PLACEHOLDER;
  if (cardArtCache.has(cleaned)) return cardArtCache.get(cleaned);
  if (!pendingCardArt.has(cleaned)) {
    pendingCardArt.add(cleaned);
    fetchCardArt(cleaned);
  }
  return CARD_BACK_PLACEHOLDER;
}

// Fetch queue and retry/backoff to avoid hitting Scryfall rate limits from the browser.
const ART_FETCH_QUEUE = [];
let ART_FETCH_ACTIVE = 0;
const ART_FETCH_CONCURRENCY = 4;
const ART_FETCH_MAX_RETRIES = 4;

function processArtQueue() {
  while (ART_FETCH_ACTIVE < ART_FETCH_CONCURRENCY && ART_FETCH_QUEUE.length) {
    const name = ART_FETCH_QUEUE.shift();
    ART_FETCH_ACTIVE += 1;
    (async (n) => {
      try {
        await _doFetchCardArt(n);
      } catch (err) {
        // swallow; _doFetchCardArt will set placeholder on failure
      } finally {
        ART_FETCH_ACTIVE -= 1;
        // schedule next loop tick
        setTimeout(processArtQueue, 0);
      }
    })(name);
  }
}

async function fetchCardArt(name) {
  const cleaned = cleanCardName(name);
  if (!cleaned) return;
  if (cardArtCache.has(cleaned)) return;
  if (!pendingCardArt.has(cleaned)) {
    pendingCardArt.add(cleaned);
    ART_FETCH_QUEUE.push(cleaned);
    processArtQueue();
  }
}

async function _doFetchCardArt(name) {
  const cleaned = cleanCardName(name);
  let queryName = cleaned.replace(/\s*\([^)]+\)\s*\d+.*$/i, '').trim();
  queryName = queryName.replace(/\s*\*.*\*$/g, '').trim();

  for (let attempt = 0; attempt < ART_FETCH_MAX_RETRIES; attempt += 1) {
    try {
      const byExact = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(queryName)}`;
      let response = await fetch(byExact);
      if (!response.ok) {
        const byFuzzy = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(queryName)}`;
        response = await fetch(byFuzzy);
      }

      if (!response.ok) {
        // If rate limited (429) or other transient, throw to retry
        if (response.status === 429 || response.status >= 500) throw new Error(`Transient ${response.status}`);
        throw new Error('No card image found');
      }

      const card = await response.json();
      const image = card?.image_uris?.normal || card?.card_faces?.[0]?.image_uris?.normal || CARD_BACK_PLACEHOLDER;
      cardArtCache.set(cleaned, image);
      // success — stop retrying
      pendingCardArt.delete(cleaned);
      renderBoard();
      return;
    } catch (err) {
      // exponential backoff with jitter
      const backoff = 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
      // final attempt: set placeholder and stop
      if (attempt === ART_FETCH_MAX_RETRIES - 1) {
        cardArtCache.set(cleaned, CARD_BACK_PLACEHOLDER);
        pendingCardArt.delete(cleaned);
        renderBoard();
        return;
      }
      // wait then retry
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, backoff));
      // continue loop
    }
  }
}

function normalizeDeckLine(line) {
  return String(line || "").replace(/\uFEFF/g, "").trim();
}

function parseDeckListText(text, fallbackName = "Uploaded Deck") {
  const lines = String(text || "").split(/\r?\n/);
  const cards = [];
  let commander = "";
  let commanderNext = false;

  for (const rawLine of lines) {
    const line = normalizeDeckLine(rawLine);
    if (!line) continue;

    if (line.startsWith("//")) {
      commanderNext = /commander/i.test(line);
      continue;
    }

    const match = line.match(/^(\d+)\s+(.+?)(?:\s+\([^)]+\)\s+[A-Za-z0-9-]+)?$/);
    if (!match) continue;

    const count = Number(match[1]);
    const name = cleanCardName(match[2]);
    if (!name || !Number.isFinite(count) || count <= 0) continue;

    if (commanderNext && !commander) {
      commander = name;
      commanderNext = false;
      continue;
    }

    cards.push({ name, count });
  }

  if (!commander) throw new Error("Commander not found. Include a '// COMMANDER' section with one commander line.");
  if (!cards.length) throw new Error("No deck cards found after commander.");

  return {
    name: `${fallbackName} (${commander})`,
    commander,
    cards,
  };
}

function classifyCardForSimulator(cardData) {
  const typeLine = String(cardData?.type_line || cardData?.card_faces?.map((face) => face?.type_line || "").join(" ") || "").toLowerCase();
  const oracleText = String(cardData?.oracle_text || cardData?.card_faces?.map((face) => face?.oracle_text || "").join(" ") || "").toLowerCase();
  const cmc = Math.max(0, Math.round(Number(cardData?.cmc) || 0));
  const powerText = cardData?.power ?? cardData?.card_faces?.find((face) => face?.power != null)?.power;
  const parsedPower = Number.parseInt(powerText, 10);
  const power = Number.isFinite(parsedPower) ? parsedPower : 0;

  if (typeLine.includes("land")) return { type: "land", cost: 0, power: 0 };
  // Prioritize actual card types like creatures/planeswalkers before heuristic text matches
  if (typeLine.includes("creature") || typeLine.includes("planeswalker")) {
    return { type: "threat", cost: cmc, power };
  }

  const drawPattern = /draw\s+(?:a|one|two|three|x|\d+)\s+cards?/;
  if (drawPattern.test(oracleText) || oracleText.includes("draw a card")) {
    return { type: "draw", cost: cmc, power };
  }

  const rampPattern = /add\s*\{|search your library.*land|treasure token|costs\s+\d+\s+less\s+to\s+cast|untap target land/;
  if (rampPattern.test(oracleText)) {
    return { type: "ramp", cost: cmc, power };
  }

  const removalPattern = /destroy|exile|counter target|deals?\s+\d+\s+damage\s+to\s+target|return target.*to (?:its|their) owner'?s hand|target player sacrifices/;
  if (removalPattern.test(oracleText)) {
    const exiles = /exile/.test(oracleText);
    return { type: "removal", cost: cmc, power, exiles };
  }

  return { type: "utility", cost: cmc, power };
}

async function fetchCardDetails(name) {
  const cleaned = cleanCardName(name);
  if (!cleaned) return null;
  if (cardMetaCache.has(cleaned)) return cardMetaCache.get(cleaned);

  // queued fetch with retries to avoid rate-limits/CORS 429s
  const queryNameBase = cleaned.replace(/\s*\([^)]+\)\s*\d+.*$/i, '').trim().replace(/\s*\*.*\*$/g, '').trim();
  const DETAILS_QUEUE_CONCURRENCY = 3;

  async function _doFetchDetails(queryName) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const byExact = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(queryName)}`;
        let response = await fetch(byExact);
        if (!response.ok) {
          const byFuzzy = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(queryName)}`;
          response = await fetch(byFuzzy);
        }
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) throw new Error(`Transient ${response.status}`);
          return null;
        }
        const cardData = await response.json();
        return cardData;
      } catch (err) {
        const backoff = 300 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    return null;
  }

  const cardData = await _doFetchDetails(queryNameBase);
  const classified = classifyCardForSimulator(cardData || {});
  const image = cardData?.image_uris?.normal || cardData?.card_faces?.[0]?.image_uris?.normal || null;
  const resolved = {
    name: cleaned,
    type: classified.type,
    cost: classified.cost,
    power: classified.power,
    exiles: classified.exiles || false,
    image,
  };

  cardMetaCache.set(cleaned, resolved);
  return resolved;
}

async function buildSimulationDeck(parsedDeck) {
  const cards = [];

  for (const entry of parsedDeck.cards) {
    const details = await fetchCardDetails(entry.name);
    cards.push({
      name: entry.name,
      count: entry.count,
      type: details?.type || "utility",
      cost: details?.cost ?? 0,
      power: details?.power ?? 0,
      toughness: details?.toughness ?? (details?.power ?? 0),
      exiles: details?.exiles ?? false,
    });
    // If we discovered an image during details fetch, seed the art cache to avoid extra client requests
    try {
      const cleaned = cleanCardName(entry.name);
      if (details?.image) cardArtCache.set(cleaned, details.image);
    } catch (e) { /* ignore */ }
  }

  // Ensure commander metadata/art is fetched and seeded so the command zone can render correctly
  try {
    const cmdName = parsedDeck.commander;
    if (cmdName) {
      const cmdDetails = await fetchCardDetails(cmdName);
      const cleanedCmd = cleanCardName(cmdName);
      if (cmdDetails?.image) cardArtCache.set(cleanedCmd, cmdDetails.image);
      // attach commander details to returned deck for simulator to use
      parsedDeck.commanderDetails = {
        name: cleanedCmd,
        type: cmdDetails?.type || 'threat',
        cost: cmdDetails?.cost ?? 0,
        power: cmdDetails?.power ?? 0,
        image: cmdDetails?.image || null,
      };
    }
  } catch (e) {
    /* ignore commander fetch errors */
  }

  return {
    name: parsedDeck.name,
    commander: parsedDeck.commander,
    commanderDetails: parsedDeck.commanderDetails || null,
    cards,
  };
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.volume = 0.45;
    this.isUnlocked = false;
    this.lastSfxAt = { draw: 0, move: 0, attack: 0, graveyard: 0 };
  }

  async ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        try {
          await this.ctx.resume();
        } catch {
          return false;
        }
      }
      this.isUnlocked = this.ctx.state === "running";
      return this.isUnlocked;
    }

    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return false;
    }

    this.masterGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();

    this.masterGain.gain.value = this.volume;
    this.sfxGain.gain.value = 0.6;

    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    this.isUnlocked = this.ctx.state === "running";
    return this.isUnlocked;
  }

  async unlockAndTest() {
    const ok = await this.ensureContext();
    if (!ok) return false;
    this.playSfx("move");
    setTimeout(() => this.playSfx("draw"), 90);
    return true;
  }

  getStateLabel() {
    if (!this.ctx) return "Locked";
    if (this.ctx.state === "running") return "On";
    return "Locked";
  }

  setVolume(value) {
    this.volume = value;
    if (this.masterGain) this.masterGain.gain.value = value;
  }



  playSfx(type) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const cooldown = 0.06;
    if (now - (this.lastSfxAt[type] || 0) < cooldown) return;
    this.lastSfxAt[type] = now;

    if (type === "draw") {
      this.sweep(now, 740, 980, 0.08, 0.2, "triangle");
      return;
    }
    if (type === "move") {
      this.sweep(now, 220, 300, 0.06, 0.17, "square");
      return;
    }
    if (type === "attack") {
      this.sweep(now, 180, 110, 0.1, 0.24, "sawtooth");
      return;
    }
    if (type === "graveyard") {
      this.sweep(now, 420, 120, 0.12, 0.2, "triangle");
    }
  }

  sweep(when, fromFreq, toFreq, duration, gainValue, waveType) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    filter.type = "bandpass";
    filter.frequency.value = Math.max(180, Math.min(1600, fromFreq));
    osc.type = waveType;
    osc.frequency.setValueAtTime(fromFreq, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, toFreq), when + duration);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  getSfxType(entry) {
    const text = entry.message.toLowerCase();
    if (text.includes("draws a card") || text.includes("draws 2 cards")) return "draw";
    if (text.includes("attacks for")) return "attack";
    if (text.includes("plays a land") || text.includes("casts") || text.includes("deploys threat") || text.includes("ramps a land")) return "move";
    if (text.includes("removes opponent") || text.includes("loses")) return "graveyard";
    return null;
  }

  handleLog(entry) {
    const type = this.getSfxType(entry);
    if (!type) return;
    this.playSfx(type);
  }
}

function expandDeck(deckConfig) {
  const list = [];
  deckConfig.cards.forEach((entry) => {
    for (let i = 0; i < entry.count; i += 1) {
      list.push({
        name: entry.name,
        type: entry.type,
        cost: entry.cost ?? 0,
        power: entry.power ?? 0,
      });
    }
  });
  return list;
}

function randomIndex(maxExclusive) {
  if (maxExclusive <= 1) return 0;
  // Prefer a secure RNG when available (browser or Node's globalThis.crypto)
  const cryptoObj = (typeof window !== 'undefined' ? window.crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null));
  if (cryptoObj?.getRandomValues) {
    const range = 0x100000000;
    const threshold = range - (range % maxExclusive);
    const buffer = new Uint32Array(1);
    let value = 0;
    do {
      cryptoObj.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= threshold);
    return value % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

function rollD20() {
  return randomIndex(20) + 1;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createPlayer(deckConfig, id) {
  return {
    id,
    name: deckConfig.name,
    commander: deckConfig.commander,
    commanderDetails: deckConfig.commanderDetails || null,
    // Commander starts in the command zone; track times cast from command zone
    commanderTimesCasted: 0,
    commandZone: deckConfig.commander ? { name: deckConfig.commander } : null,
    // Track commander damage received from each opponent: { [opponentId]: damage }
    commanderDamageReceived: {},
    library: shuffle(expandDeck(deckConfig)),
    hand: [],
    battlefield: [],
    exile: [],
    graveyard: [],
    life: 40,
    manaAvailable: 0,
    landsInPlay: 0,
    landsPlayedThisTurn: 0,
    damageThisCombat: 0,
  };
}

class Simulator {
  constructor(deckA, deckB, logger, startingPlayerIndex = 0) {
    this.logger = logger;
    this.speed = 700;
    this.timer = null;
    this.turn = 1;
    this.activePlayerIndex = startingPlayerIndex;
    this.startingPlayerIndex = startingPlayerIndex;
    this.phase = "setup";
    this.players = [createPlayer(deckA, "A"), createPlayer(deckB, "B")];
    this.gameOver = false;
    this.winner = null;

    this.players.forEach((player) => {
      for (let i = 0; i < 7; i += 1) this.draw(player, false);
    });
    this.log("SYSTEM", `Game initialized: ${this.players[0].name} vs ${this.players[1].name}`);
  }

  setSpeed(ms) {
    this.speed = ms;
    if (this.timer) {
      this.pause();
      this.start();
    }
  }

  start() {
    if (this.timer || this.gameOver) return;
    this.timer = setInterval(() => this.tick(), this.speed);
    this.log("SYSTEM", "Simulation started");
  }

  pause() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log("SYSTEM", "Simulation paused");
  }

  step() {
    if (this.gameOver) return;
    this.tick();
  }

  tick() {
    const active = this.players[this.activePlayerIndex];
    const opponent = this.players[(this.activePlayerIndex + 1) % 2];

    this.phase = "untap";
    this.untap(active);

    this.phase = "draw";
    // Skip first-turn draw for the player who goes first (Commander rule)
    if (!(this.turn === 1 && this.activePlayerIndex === this.startingPlayerIndex)) {
      this.draw(active, true);
    } else {
      this.log(active.id, `${active.name} skips their first-turn draw`);
    }

    this.phase = "main";
    this.mainPhase(active, opponent);

    this.phase = "combat";
    this.combat(active, opponent);

    this.phase = "end";
    this.endStep(active);

    if (this.checkWinner()) {
      this.gameOver = true;
      this.pause();
      this.log("GAME", `Winner: ${this.winner.name}`, "win");
      return;
    }

    this.activePlayerIndex = (this.activePlayerIndex + 1) % 2;
    this.turn += this.activePlayerIndex === 0 ? 1 : 0;
  }

  untap(player) {
    player.manaAvailable = player.landsInPlay;
    player.landsPlayedThisTurn = 0;
    // Creatures that were under the player's control at the start of this turn lose summoning sickness
    try {
      (player.battlefield || []).forEach((c) => {
        if (c && c.summoningSick) c.summoningSick = false;
      });
    } catch (e) { /* ignore */ }
    this.log(player.id, `${player.name} untaps and has ${player.manaAvailable} mana from lands`);
  }

  draw(player, announce) {
    if (player.library.length === 0) {
      player.life = 0;
      this.log(player.id, `${player.name} tried to draw from empty library and loses`, "dead");
      return;
    }
    const card = player.library.pop();
    player.hand.push(card);
    if (announce) this.log(player.id, `${player.name} draws a card`);
    // Enforce maximum hand size after any draw
    this.enforceHandLimit(player);
  }

  // Evaluate a card's value in the current player state. Higher = more valuable.
  evaluateCardValue(player, card) {
    if (!card) return -Infinity;
    // Base priority by type (higher is better)
    const typePriority = {
      threat: 100,
      removal: 80,
      draw: 70,
      ramp: 65,
      utility: 50,
      land: 40,
    };

    let value = typePriority[card.type] ?? 30;

    // Threats are more valuable with higher power
    value += (card.power || 0) * 2;

    // Cheaper spells are slightly more playable (increase value)
    const cost = Math.max(0, Number(card.cost) || 0);
    value += Math.max(0, 6 - cost);

    // Lands are more valuable when the player has few lands in play
    if (card.type === 'land') {
      value += Math.max(0, 4 - player.landsInPlay) * 6;
    }

    // Ramp/draw are more valuable when mana is low
    if (card.type === 'ramp' && player.manaAvailable <= 1) value += 8;
    if (card.type === 'draw' && player.hand.length <= 4) value += 6;

    return value;
  }

  // Ensure player's hand does not exceed 7 cards by discarding lowest-value cards
  enforceHandLimit(player) {
    const MAX_HAND = 7;
    while (player.hand.length > MAX_HAND) {
      let worstIdx = 0;
      let worstVal = Infinity;
      for (let i = 0; i < player.hand.length; i += 1) {
        const c = player.hand[i];
        const val = this.evaluateCardValue(player, c);
        if (val < worstVal) {
          worstVal = val;
          worstIdx = i;
        }
      }
      const [discarded] = player.hand.splice(worstIdx, 1);
      // If the discarded card is the player's commander, return it to the command zone instead
      if (discarded && (discarded.isCommander || discarded.name === player.commander)) {
        player.commandZone = { name: player.commander };
        this.log(player.id, `${player.name} discards their commander ${discarded.name}; it returns to the command zone`, 'command');
      } else {
        player.graveyard.push(discarded);
        this.log(player.id, `${player.name} discards ${discarded.name} to maintain a ${MAX_HAND}-card hand`, 'discard');
      }
    }
  }

  playLand(player) {
    if (player.landsPlayedThisTurn >= 1) return false;
    const idx = player.hand.findIndex((c) => c.type === "land");
    if (idx === -1) return false;
    const [land] = player.hand.splice(idx, 1);
    player.battlefield.push(land);
    player.landsInPlay += 1;
    player.landsPlayedThisTurn += 1;
    player.manaAvailable += 1;
    this.log(player.id, `${player.name} plays a land (${player.landsInPlay} in play)`);
    return true;
  }

  mainPhase(player, opponent) {
    // Try to play a land first
    this.playLand(player);

    // Find playable spells (non-lands) within available mana
    const playable = player.hand.filter((c) => c.type !== "land" && (c.cost || 0) <= player.manaAvailable);
    // Allow casting commander from the command zone (with commander tax)
    if (player.commandZone && player.commandZone.name && player.commanderDetails) {
      const baseCost = Number(player.commanderDetails.cost || 0);
      const tax = 2 * (player.commanderTimesCasted || 0);
      const cmdCost = Math.max(0, baseCost + tax);
      if (cmdCost <= player.manaAvailable) {
        // Add a synthetic playable commander card (source: command)
        playable.push({
          name: player.commandZone.name,
          type: 'threat',
          cost: cmdCost,
          power: player.commanderDetails.power || 0,
          source: 'command',
        });
      }
    }
    if (playable.length === 0) {
      this.log(player.id, `${player.name} takes no main actions`);
      return;
    }

    const priority = ["ramp", "draw", "threat", "removal", "utility"];
    playable.sort((a, b) => {
      const pa = priority.indexOf(a.type);
      const pb = priority.indexOf(b.type);
      if (pa !== pb) return pa - pb;
      return (b.power || 0) - (a.power || 0);
    });

    const chosen = playable[0];
    // If chosen is being cast from the command zone, it's not in hand — handle separately
    if (chosen.source === 'command') {
      const card = {
        name: chosen.name,
        type: chosen.type,
        cost: chosen.cost,
        power: chosen.power,
        source: 'command',
      };
      player.manaAvailable = Math.max(0, player.manaAvailable - (card.cost || 0));
      this.resolveSpell(card, player, opponent);
      return;
    }

    const idx = player.hand.findIndex((c) => c.name === chosen.name && c.type === chosen.type && (c.cost || 0) === (chosen.cost || 0));
    if (idx === -1) {
      this.log(player.id, `${player.name} couldn't locate chosen card in hand`);
      return;
    }

    const [card] = player.hand.splice(idx, 1);
    player.manaAvailable = Math.max(0, player.manaAvailable - (card.cost || 0));
    this.resolveSpell(card, player, opponent);
  }

  resolveSpell(card, player, opponent) {
    this.log(player.id, `${player.name} casts ${card.name} (${card.type})`);

    if (card.type === "ramp") {
      const hit = player.library.findIndex((c) => c.type === "land");
      if (hit >= 0) {
        const [land] = player.library.splice(hit, 1);
        player.battlefield.push(land);
        player.landsInPlay += 1;
        this.log(player.id, `${player.name} ramps a land to battlefield`);
      }
      player.graveyard.push(card);
      return;
    }

    if (card.type === "draw") {
      this.draw(player, false);
      this.draw(player, false);
      this.log(player.id, `${player.name} draws 2 cards from draw spell`);
      player.graveyard.push(card);
      return;
    }

    if (card.type === "removal") {
      const target = opponent.battlefield.findIndex((c) => c.type === "threat");
      if (target >= 0) {
        const [killed] = opponent.battlefield.splice(target, 1);
        // Commander replacement: if the killed card is the opponent's commander, it returns to the command zone
        if (killed && killed.name === opponent.commander) {
          // preserve commanderTimesCasted on the player object and return commander to command zone
          opponent.commandZone = { name: opponent.commander };
          this.log(player.id, `${player.name} removes opponent commander ${killed.name}; it returns to the command zone`);
        } else if (card.exiles) {
          this.exileCard(opponent, killed, player);
        } else {
          opponent.graveyard.push(killed);
          this.log(player.id, `${player.name} removes opponent ${killed.name}`);
        }
      } else {
        this.log(player.id, `${player.name} has no good removal target`);
      }
      player.graveyard.push(card);
      return;
    }

    if (card.type === "threat") {
      // If casting from the command zone, mark commander state and increment tax counter
      if (card.source === 'command') {
        player.commanderTimesCasted = (player.commanderTimesCasted || 0) + 1;
        // remove from command zone
        player.commandZone = null;
      }
      // Mark commander instances for later tracking
      if (player.commander && card.name === player.commander) card.isCommander = true;
      // Give creature summoning sickness when it enters battlefield (unless it has 'haste')
      card.summoningSick = true;
      // ensure toughness exists
      card.toughness = card.toughness ?? card.power ?? 0;
      player.battlefield.push(card);
      this.log(player.id, `${player.name} deploys threat (power ${card.power || 0})`);
      return;
    }

    player.battlefield.push(card);
  }

  exileCard(targetPlayer, card, byPlayer) {
    try {
      targetPlayer.exile.push(card);
      // Log who exiled what so the UI move console shows it clearly
      this.log(byPlayer.id, `${byPlayer.name} exiles ${card.name}` , 'exile');
    } catch (e) {
      // fallback: push without logging
      try { targetPlayer.exile.push(card); } catch { /* ignore */ }
    }
  }

  combat(player, opponent) {
    // Determine eligible attackers (no summoning sickness)
    const attackers = player.battlefield.filter((c) => c.type === "threat" && !c.summoningSick);
    if (!attackers.length) {
      this.log(player.id, `${player.name} has no attacks`);
      return;
    }

    // Potential blockers (can block even if summoning-sick)
    const blockers = [...opponent.battlefield.filter((c) => c.type === 'threat')];

    // Simple blocking AI: pair largest blockers to largest attackers 1:1
    const sortedAttackers = attackers.slice().sort((a, b) => (b.power || 0) - (a.power || 0));
    const sortedBlockers = blockers.slice().sort((a, b) => (b.power || 0) - (a.power || 0));

    const pairs = [];
    const remainingAttackers = [];

    for (let i = 0; i < sortedAttackers.length; i += 1) {
      const at = sortedAttackers[i];
      const blk = sortedBlockers.shift();
      if (blk) pairs.push({ attacker: at, blocker: blk });
      else remainingAttackers.push(at);
    }

    let totalDamageToPlayer = 0;

    // Resolve blocked fights
    for (const p of pairs) {
      const a = p.attacker;
      const b = p.blocker;
      const aDamage = a.power || 0;
      const bDamage = b.power || 0;

      // deal damage to each other
      // If blocker dies, send to graveyard (or command zone if commander)
      if (bDamage >= (a.toughness || a.power || 0)) {
        // attacker dies
        const idx = player.battlefield.indexOf(a);
        if (idx >= 0) player.battlefield.splice(idx, 1);
        if (a.isCommander) {
          player.commandZone = { name: player.commander };
          this.log(player.id, `${a.name} (commander) dies and returns to command zone`);
        } else {
          player.graveyard.push(a);
          this.log(player.id, `${a.name} dies in combat and goes to graveyard`);
        }
      }

      if (aDamage >= (b.toughness || b.power || 0)) {
        const idx = opponent.battlefield.indexOf(b);
        if (idx >= 0) opponent.battlefield.splice(idx, 1);
        if (b.isCommander) {
          opponent.commandZone = { name: opponent.commander };
          this.log(player.id, `${player.name} kills ${b.name} (commander); it returns to command zone`);
        } else {
          opponent.graveyard.push(b);
          this.log(player.id, `${player.name}'s ${a.name} kills blocker ${b.name}`);
        }
      }
    }

    // Unblocked attackers deal damage to player (and to commander damage tracking if attacker is a commander)
    for (const ua of remainingAttackers) {
      const dmg = ua.power || 0;
      totalDamageToPlayer += dmg;
      if (ua.isCommander) {
        opponent.commanderDamageReceived[player.id] = (opponent.commanderDamageReceived[player.id] || 0) + dmg;
        this.log(player.id, `${player.name}'s commander deals ${dmg} commander damage to ${opponent.name} (total ${opponent.commanderDamageReceived[player.id]})`);
      }
    }

    if (totalDamageToPlayer > 0) {
      opponent.life -= totalDamageToPlayer;
      player.damageThisCombat = totalDamageToPlayer;
      this.log(player.id, `${player.name} attacks for ${totalDamageToPlayer}. ${opponent.name} to ${opponent.life}`);
    } else {
      this.log(player.id, `${player.name} deals no unblocked damage`);
    }
  }

  endStep(player) {
    player.damageThisCombat = 0;
  }

  checkWinner() {
    // A player loses if life <= 0 OR if they've taken 21+ commander damage from a single commander
    const losers = this.players.filter((p) => {
      if (p.life <= 0) return true;
      const byCommander = Object.values(p.commanderDamageReceived || {}).some((v) => (v || 0) >= 21);
      return byCommander;
    });
    if (losers.length === 0) return false;
    // If only one player remains, they win. If both lose at same time, pick first alive or null.
    const alive = this.players.filter((p) => !losers.includes(p));
    if (alive.length === 1) this.winner = alive[0];
    else this.winner = this.players.find((p) => p.life > 0) || this.players[0];
    return true;
  }


  log(source, message, className = "") {
    const entry = {
      turn: this.turn,
      phase: this.phase,
      source,
      message,
      className,
      at: new Date().toLocaleTimeString(),
    };
    this.logger(entry);
  }
}

let ui = null;
if (typeof document !== 'undefined') {
  ui = {
    infoBanner: document.getElementById("infoBanner"),
    dismissInfoBannerBtn: document.getElementById("dismissInfoBannerBtn"),
    tableWrap: document.getElementById("tableWrap"),
    startBtn: document.getElementById("startBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    resetBtn: document.getElementById("resetBtn"),
    uploadDeck1Btn: document.getElementById("uploadDeck1Btn"),
    uploadDeck2Btn: document.getElementById("uploadDeck2Btn"),
    deck1FileInput: document.getElementById("deck1FileInput"),
    deck2FileInput: document.getElementById("deck2FileInput"),
    deck1Badge: document.getElementById("deck1Badge"),
    deck2Badge: document.getElementById("deck2Badge"),
    slowerBtn: document.getElementById("slowerBtn"),
    fasterBtn: document.getElementById("fasterBtn"),
    enableAudioBtn: document.getElementById("enableAudioBtn"),
    speedBadge: document.getElementById("speedBadge"),
    audioBadge: document.getElementById("audioBadge"),
    moveConsole: document.getElementById("moveConsole"),
    playersView: document.getElementById("playersView"),
    metaStats: document.getElementById("metaStats"),
    simCountInput: document.getElementById("simCountInput"),
    deck1Wins: document.getElementById("deck1Wins"),
    deck2Wins: document.getElementById("deck2Wins"),
    silentRunCheckbox: document.getElementById("silentRunCheckbox"),
    batchProgress: document.getElementById("batchProgress"),
    batchProgressLabel: document.getElementById("batchProgressLabel"),
  };
} else {
  // headless stub for Node tests
  ui = {};
}

let logs = [];
let simulator = null;
const audio = new AudioEngine();
let simSpeed = 1400;
const uploadedDecks = { A: null, B: null };
let d20Rolls = { A: null, B: null };
let winCounters = { A: 0, B: 0 };

function appendLog(entry) {
  if (!entry.at) entry.at = new Date().toLocaleTimeString();
  logs.push(entry);
  if (logs.length > 1500) logs.shift();
  audio.handleLog(entry);
  console.log(`[${entry.at}] T${entry.turn} ${entry.phase.toUpperCase()} | ${entry.source} | ${entry.message}`);
  renderBoard();
}

function countType(player, type) {
  return player.battlefield.filter((c) => c.type === type).length;
}

function renderBoard() {
  if (!simulator) {
    ui.metaStats.textContent = "Upload Deck 1 and Deck 2 to start simulation.";
    ui.moveConsole.textContent = "No moves yet.";
    ui.playersView.innerHTML = `
      <article class="player-card">
        <div class="player-header">
          <strong>Deck 1</strong>
          <span>Player A</span>
        </div>
        <div class="deck-upload-zone" data-deck-slot="A">
          <div>
            <strong>Drop Deck 1 .txt here</strong>
            <span>or use Upload Deck 1 above</span>
          </div>
        </div>
      </article>
      <article class="player-card">
        <div class="player-header">
          <strong>Deck 2</strong>
          <span>Player B</span>
        </div>
        <div class="deck-upload-zone" data-deck-slot="B">
          <div>
            <strong>Drop Deck 2 .txt here</strong>
            <span>or use Upload Deck 2 above</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  ui.metaStats.textContent = `Turn ${simulator.turn} • Phase: ${simulator.phase.toUpperCase()} • Active: ${simulator.players[simulator.activePlayerIndex].name} • Speed: ${simSpeed}ms`;

  // Diagnostic: report art/cache and exile/battlefield counts to help debugging
  try {
    console.debug(`Art cache: ${cardArtCache.size}, pending: ${pendingCardArt.size}`);
    simulator.players.forEach((pp) => {
      const threats = pp.battlefield.filter((c) => c.type === 'threat').length;
      const lands = pp.battlefield.filter((c) => c.type === 'land').length;
      console.debug(`Player ${pp.id} ${pp.name}: battlefield threats=${threats}, lands=${lands}, exile=${(pp.exile||[]).length}`);
    });
  } catch (e) { /* ignore */ }

  const recentMoves = logs.slice(-10).map((entry) => `[T${entry.turn}] ${entry.phase.toUpperCase()}: ${entry.message}`);
  ui.moveConsole.textContent = recentMoves.length ? recentMoves.join("\n") : "No moves yet.";
  ui.moveConsole.scrollTop = ui.moveConsole.scrollHeight;

  ui.playersView.innerHTML = simulator.players
    .map((p) => {
      try {
      const threats = p.battlefield.filter((c) => c.type === "threat").slice(0, 16);
      const lands = p.battlefield.filter((c) => c.type === "land").slice(0, 16);
      const recentGraveyard = (p.graveyard || []).slice(-6).reverse();
      // Normalize exile entries: some code paths may push a name string instead of an object
      const recentExile = (p.exile || []).slice(-6).reverse().map((e) => (e && typeof e === 'object') ? e : { name: String(e || 'Unknown') });

      const displayCommander = p.commander && !(p.name || '').includes(p.commander) ? `<span>${escapeHtml(p.commander)}</span>` : '';

      const renderCardTile = (card, zone) => {
        const art = getCardArt(card.name);
        const cardName = escapeHtml(card.name);
        // Debug: if art is placeholder, log cache/meta state to help diagnose
        try {
          const cleaned = cleanCardName(card.name);
          if (art === CARD_BACK_PLACEHOLDER) {
            console.debug('No art for', cleaned, { cacheHas: cardArtCache.has(cleaned), pending: pendingCardArt.has(cleaned), meta: cardMetaCache.get(cleaned) });
          }
        } catch (e) {
          /* ignore */
        }
        return `<div class="card-tile" title="${cardName} [${zone}]">
          <img src="${art}" alt="${cardName}" loading="lazy" />
          <span>${cardName}</span>
        </div>`;
      };
      return `
        <article class="player-card ${p.life <= 0 ? "dead" : ""}">
          <div class="player-header">
            <strong>${p.name}</strong>
            ${displayCommander}
          </div>
          <div class="mat">
            <div class="zone zone-main">
              <h4>Battlefield</h4>
              <div class="card-grid">
                ${threats.length ? threats.map((t) => renderCardTile(t, "battlefield")).join("") : '<span class="badge">No creatures in play</span>'}
              </div>
            </div>
            <div class="zone zone-lands">
              <h4>Lands</h4>
              <div class="card-grid small">
                ${lands.length ? lands.map((l) => renderCardTile(l, "lands")).join("") : '<span class="badge">No lands in play</span>'}
              </div>
            </div>

            <div class="zone-side">
              <div class="zone zone-life">
                <h4>Life</h4>
                <div class="life-box">${p.life}</div>
              </div>
                      <div class="zone zone-command">
                        <h4>Command Zone</h4>
                        <div class="card-grid small">${p.commandZone && p.commandZone.name ? renderCardTile({ name: p.commandZone.name }, "command") : '<span class="badge">Commander on battlefield</span>'}</div>
                        ${p.commandZone && p.commandZone.name ? `<span class="badge">Tax: +${2 * (p.commanderTimesCasted || 0)}</span>` : ''}
                      </div>
              <div class="zone zone-exile">
                <h4>Exile</h4>
                <div class="card-grid small">
                  ${recentExile.length ? recentExile.map((g) => renderCardTile(g, "exile")).join("") : '<span class="badge">Empty</span>'}
                </div>
              </div>
              <div class="zone zone-library">
                <h4>Library</h4>
                <div class="card-grid small">${renderCardTile({ name: "Card Back" }, "library")}</div>
                <span class="badge">Cards: ${p.library.length}</span>
                <span class="badge">Hand: ${p.hand.length}</span>
                <span class="badge">Mana: ${p.manaAvailable}</span>
              </div>
              <div class="zone zone-graveyard">
                <h4>Graveyard</h4>
                <div class="card-grid small">
                  ${recentGraveyard.length ? recentGraveyard.map((g) => renderCardTile(g, "graveyard")).join("") : '<span class="badge">Empty</span>'}
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
      } catch (err) {
        console.error('Error rendering player view', err, p);
        return `
        <article class="player-card error">
          <div class="player-header">
            <strong>Render Error</strong>
            <span>${escapeHtml(p?.name || 'Unknown')}</span>
          </div>
          <div class="mat">
            <div class="zone-side">
              <span class="badge">Error rendering player area</span>
            </div>
          </div>
        </article>
        `;
      }
    })
    .join("");
}

function resetSimulation(performInitialRoll = false) {
  console.debug('resetSimulation called', { uploadedDecks, simSpeed, performInitialRoll });
  if (!uploadedDecks.A || !uploadedDecks.B) {
    simulator = null;
    renderBoard();
    return;
  }

  if (simulator) simulator.pause();
  logs = [];

  // Create simulator without performing the first-player roll — caller may request it
  const startingPlayerIndex = 0;
  simulator = new Simulator(uploadedDecks.A, uploadedDecks.B, appendLog, startingPlayerIndex);
  simulator.setSpeed(simSpeed);

  // Debug: log initial simulator state for troubleshooting deck-specific behavior
  try {
    simulator.players.forEach((p) => {
      const typeCounts = p.library.reduce((acc, c) => { acc[c.type] = (acc[c.type] || 0) + 1; return acc; }, {});
      console.debug(`Player ${p.id} '${p.name}' — library: ${p.library.length} cards, hand: ${p.hand.length}, battlefield: ${p.battlefield.length}, types: ${JSON.stringify(typeCounts)}`);
      console.debug(`Player ${p.id} hand sample: ${p.hand.slice(0,8).map((c) => `${c.name}(${c.type})`).join(', ')}`);
    });
  } catch (e) {
    console.warn('Could not print simulator debug info', e);
  }

  // Ensure commander art is fetched right away so the command zone can render images
  try {
    simulator.players.forEach((p) => {
      if (p.commander) fetchCardArt(p.commander);
    });
  } catch (e) {
    /* ignore */
  }

  if (performInitialRoll) {
    d20Rolls.A = rollD20();
    d20Rolls.B = rollD20();
    const chosen = d20Rolls.A > d20Rolls.B ? 0 : 1;
    const rollMessage = `${uploadedDecks.A.name} rolled ${d20Rolls.A}, ${uploadedDecks.B.name} rolled ${d20Rolls.B} - ${simulator.players[chosen].name} goes first!`;
    appendLog({ turn: 0, phase: "setup", source: "SYSTEM", message: rollMessage, className: "" });
    simulator.activePlayerIndex = chosen;
  }

  renderBoard();
}

function getDeckTotals(deck) {
  return deck.cards.reduce((sum, card) => sum + (card.count || 0), 0);
}

function updateDeckBadges() {
  ui.deck1Badge.textContent = uploadedDecks.A ? `Deck 1: ${uploadedDecks.A.name} (${getDeckTotals(uploadedDecks.A)} cards)` : "Deck 1: Not loaded";
  ui.deck2Badge.textContent = uploadedDecks.B ? `Deck 2: ${uploadedDecks.B.name} (${getDeckTotals(uploadedDecks.B)} cards)` : "Deck 2: Not loaded";
}

function updateWinBadges() {
  try {
    if (ui.deck1Wins) ui.deck1Wins.textContent = `Wins: ${winCounters.A}`;
    if (ui.deck2Wins) ui.deck2Wins.textContent = `Wins: ${winCounters.B}`;
  } catch (e) {
    console.warn('Could not update win badges', e);
  }
}

function setBatchProgress(value, max) {
  try {
    if (!ui.batchProgress) return;
    ui.batchProgress.max = max || 100;
    ui.batchProgress.value = value;
    ui.batchProgress.hidden = false;
    if (ui.batchProgressLabel) ui.batchProgressLabel.textContent = `Batch Progress: ${value} / ${max}`;
  } catch (e) {
    /* ignore */
  }
}

function hideBatchProgress() {
  try {
    if (ui.batchProgress) ui.batchProgress.hidden = true;
    if (ui.batchProgressLabel) ui.batchProgressLabel.textContent = `Batch Progress:`;
  } catch (e) { /* ignore */ }
}

function updateControlState() {
  const ready = Boolean(uploadedDecks.A && uploadedDecks.B);
  ui.startBtn.disabled = !ready;
  ui.resetBtn.disabled = !ready;
}

async function handleDeckUpload(slot, file) {
  if (!file) return;

  const badge = slot === "A" ? ui.deck1Badge : ui.deck2Badge;
  try {
    badge.textContent = `${slot === "A" ? "Deck 1" : "Deck 2"}: Loading ${file.name}...`;
    const text = await file.text();
    const fileBaseName = file.name.replace(/\.[^/.]+$/, "");
    const parsedDeck = parseDeckListText(text, fileBaseName || "Uploaded Deck");
    const simDeck = await buildSimulationDeck(parsedDeck);
    uploadedDecks[slot] = simDeck;

    // Debug: log a short summary of the uploaded deck to help diagnose deck-specific issues
    try {
      const counts = simDeck.cards.reduce((acc, c) => {
        acc[c.type] = (acc[c.type] || 0) + (c.count || 0);
        return acc;
      }, {});
      console.debug(`Deck ${slot} loaded: ${simDeck.name} — totals: ${JSON.stringify(counts)}`);
    } catch (e) {
      console.debug(`Deck ${slot} loaded: ${simDeck.name}`);
    }

    updateDeckBadges();
    updateControlState();
    if (uploadedDecks.A && uploadedDecks.B) {
      // Log current requested runs when both decks are uploaded
      try {
        const runsVal = ui?.simCountInput?.value || '1';
        console.log('Both decks uploaded. Runs:', runsVal);
      } catch (e) { /* ignore */ }
      resetSimulation(false);
    } else {
      renderBoard();
    }
  } catch (error) {
    uploadedDecks[slot] = null;
    updateDeckBadges();
    updateControlState();
    console.error(error);
    badge.textContent = `${slot === "A" ? "Deck 1" : "Deck 2"}: Upload failed`;
    ui.metaStats.textContent = `Upload error: ${error?.message || "Could not parse deck file."}`;
  }
}

function updateSpeedBadge() {
  ui.speedBadge.textContent = `Speed: ${simSpeed}ms`;
}

function updateAudioBadge() {
  ui.audioBadge.textContent = `Audio: ${audio.getStateLabel()}`;
}

if (typeof document !== 'undefined' && ui) {
  ui.enableAudioBtn.addEventListener("click", async () => {
    const ok = await audio.unlockAndTest();
    updateAudioBadge();
    if (!ok) {
      console.warn("Audio could not be unlocked by browser. Sound effects disabled.");
    }
  });

  ui.tableWrap.addEventListener("click", async () => {
    await audio.ensureContext();
    updateAudioBadge();
  });

  ui.startBtn.addEventListener("click", async () => {
  console.log('startBtn clicked', { uploadedDecksLoaded: !!uploadedDecks.A && !!uploadedDecks.B, simulatorExists: !!simulator });
  if (!uploadedDecks.A || !uploadedDecks.B) {
    console.log('Start pressed but decks not ready');
    return;
  }
  // read requested run count (robust fallback to 1)
  let runs = 1;
  try {
    if (ui.simCountInput) {
      const raw = ui.simCountInput.value;
      const num = Number(raw);
      runs = Number.isFinite(num) && num > 0 ? Math.floor(num) : 1;
      console.log('Requested runs:', runs, { raw });
    }
  } catch (e) {
    console.warn('Could not read simCountInput, defaulting to 1', e);
    runs = 1;
  }

  // If multiple runs requested, play each run visually in sequence
  if (runs > 1) {
    // reset win counters
    winCounters = { A: 0, B: 0 };
    updateWinBadges();

    // Disable controls while running
    ui.startBtn.disabled = true;
    ui.resetBtn.disabled = true;
    ui.uploadDeck1Btn.disabled = true;
    ui.uploadDeck2Btn.disabled = true;
    const silent = Boolean(ui.silentRunCheckbox && ui.silentRunCheckbox.checked);

    if (silent) {
      // Fast silent batch: run simulations synchronously (but yield to UI between runs)
      setBatchProgress(0, runs);
      try {
        for (let i = 0; i < runs; i += 1) {
          const runIndex = i + 1;
          ui.metaStats.textContent = `Running silent run ${runIndex} / ${runs}...`;

          const aRoll = rollD20();
          const bRoll = rollD20();
          const starting = aRoll > bRoll ? 0 : 1;

          // Use a no-op logger to avoid heavy DOM updates during silent runs
          const batchSim = new Simulator(uploadedDecks.A, uploadedDecks.B, () => {}, starting);

          let ticks = 0;
          while (!batchSim.gameOver) {
            batchSim.tick();
            ticks += 1;
            // periodically yield to the event loop so the UI can update
            if ((ticks & 0x3FF) === 0) await new Promise((r) => setTimeout(r, 0));
          }

          if (batchSim.winner?.id === 'A') winCounters.A += 1;
          else if (batchSim.winner?.id === 'B') winCounters.B += 1;
          updateWinBadges();
          setBatchProgress(runIndex, runs);
          console.log(`Silent batch run ${runIndex} finished after ${ticks} ticks, winner: ${batchSim.winner?.id || 'none'}`);
          // yield briefly between runs to allow repaint
          // eslint-disable-next-line no-await-in-loop
          await new Promise((res) => setTimeout(res, 8));
        }
      } catch (err) {
        console.error('Error during silent batch runs:', err);
      } finally {
        hideBatchProgress();
      }
    } else {
      // Animated sequential runs (existing behavior)
      for (let i = 0; i < runs; i += 1) {
        const runIndex = i + 1;
        try {
          ui.metaStats.textContent = `Playing run ${runIndex} / ${runs}...`;
          console.log(`Animated run ${runIndex}/${runs} starting`);

          // prepare and start a fresh simulator with a per-run roll
          resetSimulation(true);
          await audio.ensureContext();
          updateAudioBadge();
          simulator.start();

          // wait for simulator to finish
          await new Promise((resolve) => {
            const id = setInterval(() => {
              if (!simulator || simulator.gameOver) {
                clearInterval(id);
                resolve();
              }
            }, 120);
          });

          // record winner
          if (simulator?.winner?.id === 'A') winCounters.A += 1;
          else if (simulator?.winner?.id === 'B') winCounters.B += 1;
          updateWinBadges();
          console.log(`Animated run ${runIndex}/${runs} finished, winner:`, simulator?.winner?.id || 'none');

          // small pause between runs so UI can reflect final state
          // eslint-disable-next-line no-await-in-loop
          await new Promise((res) => setTimeout(res, 120));
        } catch (errRun) {
          console.error(`Error during animated run ${runIndex}:`, errRun);
        }
      }
    }

    // Re-enable controls
    ui.startBtn.disabled = false;
    ui.resetBtn.disabled = false;
    ui.uploadDeck1Btn.disabled = false;
    ui.uploadDeck2Btn.disabled = false;
    ui.metaStats.textContent = `Batch complete: ${runs} runs`;
    renderBoard();
    return;
  }

  // Single run behavior
  if (!simulator) {
    console.log('No live simulator, creating with resetSimulation');
    resetSimulation(true);
  }
  await audio.ensureContext();
  updateAudioBadge();
  console.log('simulator state before start', { exists: !!simulator, gameOver: simulator?.gameOver, hasTimer: !!simulator?.timer });
  if (simulator && simulator.gameOver) {
    console.log('Simulator was finished; recreating via resetSimulation');
    resetSimulation(true);
  }
  if (simulator && typeof simulator.start === 'function') {
    console.log('Starting simulator now');
    simulator.start();
  } else {
    console.warn('Simulator not available to start');
  }
});

ui.pauseBtn.addEventListener("click", () => {
  simulator?.pause();
});

ui.resetBtn.addEventListener("click", () => {
  resetSimulation(true);
});

ui.dismissInfoBannerBtn.addEventListener("click", () => {
  try {
    const banner = ui.infoBanner || document.getElementById("infoBanner");
    if (banner && banner.remove) banner.remove();
    else if (banner) banner.hidden = true;
  } catch (e) {
    console.warn('Could not dismiss info banner', e);
  }
});

// Ensure clicking the dismiss button doesn't bubble to other handlers
if (ui.dismissInfoBannerBtn) {
  ui.dismissInfoBannerBtn.addEventListener('click', (ev) => ev.stopPropagation());
}

// Allow Escape key to dismiss banner
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    const banner = ui.infoBanner || document.getElementById('infoBanner');
    if (banner && banner.remove) banner.remove();
  }
});

ui.uploadDeck1Btn.addEventListener("click", () => {
  ui.deck1FileInput.click();
});

ui.uploadDeck2Btn.addEventListener("click", () => {
  ui.deck2FileInput.click();
});

ui.deck1FileInput.addEventListener("change", async (event) => {
  const file = event.target?.files?.[0];
  await handleDeckUpload("A", file);
  event.target.value = "";
});

ui.deck2FileInput.addEventListener("change", async (event) => {
  const file = event.target?.files?.[0];
  await handleDeckUpload("B", file);
  event.target.value = "";
});

ui.playersView.addEventListener("dragover", (event) => {
  const zone = event.target.closest(".deck-upload-zone");
  if (!zone) return;
  event.preventDefault();
  zone.classList.add("drag-over");
});

ui.playersView.addEventListener("dragleave", (event) => {
  const zone = event.target.closest(".deck-upload-zone");
  if (!zone) return;
  zone.classList.remove("drag-over");
});

ui.playersView.addEventListener("drop", async (event) => {
  const zone = event.target.closest(".deck-upload-zone");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("drag-over");

  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const slot = zone.dataset.deckSlot;
  if (slot !== "A" && slot !== "B") return;
  await handleDeckUpload(slot, file);
});



ui.slowerBtn.addEventListener("click", () => {
  simSpeed = Math.min(3000, simSpeed + 200);
  updateSpeedBadge();
  simulator?.setSpeed(simSpeed);
  renderBoard();
});

ui.fasterBtn.addEventListener("click", () => {
  simSpeed = Math.max(200, simSpeed - 200);
  updateSpeedBadge();
  simulator?.setSpeed(simSpeed);
  renderBoard();
});

} // end DOM listeners guard

if (typeof document !== 'undefined') {
  audio.setVolume(0.45);
  updateSpeedBadge();
  updateAudioBadge();
  updateDeckBadges();
  updateControlState();
  renderBoard();
  // Auto-start only when a single run is requested (preserve manual control for batch runs)
  try {
    const runsRequested = Number(ui?.simCountInput?.value || 1);
    if (Number.isFinite(runsRequested) && runsRequested <= 1) {
      if (simulator && typeof simulator.start === 'function') simulator.start();
    }
  } catch (e) {
    console.warn('Auto-start check failed', e);
  }
}

// Export core simulator symbols for headless testing (Node)
try {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Simulator, createPlayer, expandDeck, shuffle, rollD20 };
  }
} catch (e) {
  // ignore
}
