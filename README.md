# MTG Commander Simulator (Two-Deck Framework)

This is a web prototype for simulating two Commander-style decks playing each other.

Core features:
- Visual playmat-style battlefield for both players
- Auto-running simulation playback and a move console log
- Basic gameplay rules for Commander (two-player simplified)
- Commander-specific rules: command zone, commander tax, commander damage tracking
- Sound effects and Scryfall-based card art rendering

The UI expects you to upload both deck files before running a simulation.

## Run

For the full experience (art lookups and predictable behavior) serve the project folder over HTTP rather than opening `index.html` via `file://`.

Example quick servers (run in the project root):

```powershell
# Python 3
python -m http.server 8000

# Node (if you have npm)
npx http-server -c-1 8000
```

Then open http://localhost:8000 in your browser.

1. Click **Upload Deck 1** and select your first deck `.txt` file.
2. Click **Upload Deck 2** and select your second deck `.txt` file.
3. Click **Start** once both uploads are loaded.
4. Click **Enable Audio** (or click the play area) to unlock sound effects (browser autoplay policy).
5. Open DevTools → Console to view detailed logs.

Headless (Node) test runner
- The project contains headless smoke tests and targeted tests that run under Node.js.
- Requirements: Node 16+ (LTS recommended).
- Run the smoke harness (10 sample silent runs):

```powershell
node test/smoke.js
```

- Run targeted tests (examples):

```powershell
node test/commander_tax_test.js
node test/exile_test.js
```

## Audio controls

- Use **Enable Audio** to unlock sound effects in your browser (required by autoplay policy).
- Sound effects trigger for: card draw, movement/cast, attack, and graveyard/removal events.

## Card visuals

- The battlefield and graveyard panels render card thumbnails while the game runs.
- Art is fetched from Scryfall by card name and cached in-browser. If a lookup fails, a default card-back image is used.

UI notes
- Exile events are logged to the move console (`exile` class) so you can quickly spot exiled cards during simulations.
- The Command Zone area shows a `Tax: +N` badge when the commander is in the command zone (N = 2 × times cast).

## Deck upload format (`.txt`)

Use this structure (same style as exported ManaBox files):

```txt
// COMMANDER
1 Commander Name (SET) 123

1 Card Name (SET) 001
15 Island (SET) 250
1 Split Card // Name (SET) 321
```

- The first `// COMMANDER` card is used as the commander.
- All other quantity lines are treated as the deck cards.
- Card roles (`land`, `ramp`, `draw`, `removal`, `threat`, `utility`) are inferred from Scryfall data during upload.

Example deck files
------------------
You can find two example deck files in the repository under the `decks/` folder: `decks/example_deck_A.txt` and `decks/example_deck_B.txt`.

An example `.txt` deck structure (minimal):

```txt
// COMMANDER
1 Atraxa, Praetors' Voice (M21) 001

1 Sol Ring (M11) 001
36 Plains (CORE) 250
4 Small Threat (CUSTOM) 001
4 Big Threat (CUSTOM) 002
```

These sample decks are intentionally small and illustrative. You can upload your own deck files following the same structure or use the provided samples for quick testing.

Gameplay rules (simplified)
- Commander: commander starts in the command zone. Casting from the command zone costs base CMC + 2 × times previously cast from command zone.
- Commander damage: receiving 21 or more combat damage from a single commander causes that player to lose.
- First-turn draw: the player who goes first skips their first-turn draw (Commander rule).
- Summoning sickness: creatures enter with summoning sickness and cannot attack the turn they enter (no haste implemented). Creatures are cleared of summoning sickness on their controller's next untap.
- Combat: a simple blocking AI pairs largest blockers to largest attackers (1:1). Blocked creatures exchange damage and die if their toughness is met or exceeded. Unblocked attackers deal damage to the defending player.

Notes and limitations
- This simulator is intentionally simplified: it does not implement the full stack, priority passes, complex replacement effects, multiple blockers per attacker, first strike, trample, deathtouch, or accurate continuous damage tracking across multiple turns.
- Card-level interactions (keywords, triggered abilities) are not fully modeled; classification is heuristic based on Scryfall oracle text.

## Internal deck JSON format

Internally a deck looks like:

```json
{
  "name": "Example Deck",
  "commander": "Commander Name",
  "cards": [ { "name": "Island", "count": 36, "type": "land" }, ... ]
}
```

## Framework extension points

- Add card-level scripting by replacing generic `type` logic in `resolveSpell()`.
- Add stack/priority by introducing an action queue between `mainPhase()` and `resolveSpell()`.
- Add turn phases/triggers in `tick()`.
- Add deterministic replay export by serializing `logs`.

## Cleanup

- Removed files: `validate_deck.js`, `validate_deck.py`, `decks.js`, and `decks.vampire.js`. These validator scripts and bundled prebuilt decks were removed because the web app expects users to upload deck `.txt` files via the UI.
- To restore removed files, retrieve them from source control or add equivalent validator/prebuilt deck files back into the project root.

If you prefer a small set of example decks to ship with the app, I can add a compact `prebuilt_decks.js` that exports only the decks you want.

---

Last updated: 2026-02-23

## License

This project is released under the MIT License. See the `LICENSE` file for details. Replace the placeholder copyright holder in `LICENSE` with your name if desired.

## Legal / IP Notice

- This project and its source code are owned by the repository author and licensed under the MIT License. The project does not include any Wizards of the Coast or Hasbro assets.
- Card names, card text, and Magic: The Gathering logos are trademarked and copyrighted by Wizards of the Coast/Hasbro. This repository only references card data at runtime via third-party APIs and does not claim ownership of that IP.
- Card art is fetched at runtime from Scryfall (https://scryfall.com). By using this software you should comply with Scryfall's API terms and attribution requirements.
- Do not redistribute proprietary images or text from Wizards of the Coast unless you have explicit permission.

If you want, I can add a short Scryfall attribution block linking their API terms.
