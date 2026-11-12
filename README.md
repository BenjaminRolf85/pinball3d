# Pinball 3D: Riffgewitter · Rotorsturm · Erdabwehr

**Deutsch** | [English](#english)

Drei 3D-Flippertische für Handy und Browser, ein Spiel von [Echomotion](https://echomotion.ai). Die Tische sind in Blender gebaut, Physik und Regeln in JavaScript geschrieben, alle Klänge werden live synthetisiert.

Online spielen: https://riffgewitter.netlify.app

## Die Tische

| | Riffgewitter | Rotorsturm | Erdabwehr |
|---|---|---|---|
| Thema | Hard Rock, Blitz und Feuer | Vietnam 1968, Rettungsflieger | Außerirdische greifen die Erde an |
| Herzstück | Chrom-Schädel mit Kugelsperre, Pin-up Roxy | Versenkter Stahlhelm startet Missionen, Helipad mit Hubschrauber | Mutterschiff mit Traktorstrahl, Kampfroboter mitten auf der Angriffsachse |
| Besonderheiten | Setlist mit fünf Songs, Backstage-Tourbus, Plattenteller, Mikrofonständer, Lichttraverse | Cu-Chi-Tunnel unter Glas mit Mini-Flipper, M16-Weiche, Alarmstufe Rot | Zwei sich kreuzende Rampen, Panzerstellung, Laserbatterie, Untertassen-Formation |
| Ziele / Bahnen | R-O-C-K / A-M-P | Sterne / S-O-S | E-R-D-E / U-F-O |

Alle Texte gibt es auf Deutsch und Englisch. Kameraansichten (Spieler, ganzer Tisch, flach, nah, von oben) wechselt der Knopf oben rechts oder die Taste V.

**Credits:** Jedes Gerät startet mit 20 Credits, ein Spiel kostet einen. Danach erscheint der Hinweis auf MultiMate.app. Die Credits liegen nur im Browser-Speicher (`localStorage`).

## Steuerung

| Aktion | Handy | Tastatur |
|---|---|---|
| Linker Flipper | linke Bildschirmhälfte | Pfeil links, A, linke Umschalttaste |
| Rechter Flipper | rechte Bildschirmhälfte | Pfeil rechts, D, rechte Umschalttaste |
| Abschuss | rechts halten, loslassen | Leertaste halten, loslassen |
| Rütteln | Knopf unten in der Mitte | Pfeil hoch, N |
| Kameraansicht | Knopf oben rechts | V |
| Pause | Knopf oben links | P, Esc |

## Selbst bauen

Voraussetzungen: Node.js 20+, Python 3.11+ mit Blender als Modul.

```bash
npm install
```

```bash
pip install bpy shapely fonttools brotli numpy pillow
```

Layout exportieren, Spielfeld-Textur backen, Tisch in Blender bauen (für jeden Tisch `riff`, `rotor`, `alien`):

```bash
node tools/export-layout.mjs alien
```

```bash
python3 blender/bake_playfield.py --table alien
```

```bash
python3 blender/build_table.py --table alien
```

Alles bündeln nach `dist/` (Webseite, Einzeldatei `dist/riffgewitter-standalone.html`, Netlify-Konfiguration):

```bash
npm run build
```

Lokal testen:

```bash
npm run serve
```

**Musik:** Die eigenen Hintergrundsongs sind aus Rechtegründen nicht im öffentlichen Repository. Lege die `.mp3`-Dateien nach `assets/music/`, dann übernimmt `npm run build` sie in die Jukebox. Ohne sie spielt der eingebaute Synthesizer-Soundtrack.

**Veröffentlichen:** Den Ordner `dist/` auf einen beliebigen Webspace legen, zum Beispiel Netlify.

## Tests

| Befehl | Prüft |
|---|---|
| `TABLE=alien node tools/sim.mjs 40` | Bot spielt 40 Partien ohne Grafik (Statistik pro Ereignis) |
| `TABLE=alien node tools/stuck.mjs` | Stellen, an denen die Kugel liegen bleibt |
| `node tools/e2e.mjs alien` | Browser-Test mit echter Grafik, Eingaben und Bot |
| `node tools/shot.mjs build/shots alien-play` | Screenshot einer Szene |
| `node tools/audio-test.mjs` | Pegel und Fehlerfreiheit aller Klänge |
| `node tools/art-preview.mjs alien build/art --debug` | Spielfeldgrafik als Bild, mit Geometrie-Overlay |

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/layout*.js` | Tischgeometrie in Millimetern, gemeinsame Quelle für Physik, Blender und Grafik |
| `src/physics.js` | Kugelphysik (1200 Hz), Ebenen, Rampen als Schienen, Scoops, Drehteller |
| `src/game*.js` | Regeln: gemeinsame Basis plus eine Datei pro Tisch |
| `src/render.js`, `src/render-alien.js` | three.js-Darstellung, Animationen, Funken, Laser, Blitze |
| `src/playfieldArt.js`, `src/art/` | Spielfeldgrafik, zur Laufzeit gemalt |
| `src/audio.js`, `src/jukebox.js` | Effekte und Musik per WebAudio, Jukebox für eigene Songs |
| `src/dmd.js`, `src/i18n.js` | Punktmatrix-Anzeige, Texte Deutsch und Englisch |
| `src/styles/tokens.css` | Design-Tokens: Farben, Schriften, Abstände je Tisch |
| `blender/` | Modellbibliotheken, Tisch-Zusammenbau, Textur-Bake, Vorschauen |
| `assets/<tisch>/` | Gebaute Tische (`table.glb`), Spielfeld-Untergrund, gemalte Szenen |
| `tools/` | Build, lokaler Server, Simulation, Browser-Tests, Screenshots |

Schriften: Metal Mania, Black Ops One, Orbitron, Barlow, Barlow Condensed (SIL Open Font License).

Impressum: [echomotion.ai/impressum](https://echomotion.ai/impressum) · © 2026 Echomotion GmbH

---

<a id="english"></a>

# Pinball 3D: Riffgewitter · Rotorsturm · Erdabwehr (English)

Three 3D pinball tables for phone and browser, a game by [Echomotion](https://echomotion.ai). The tables are built in Blender, physics and rules are written in JavaScript, and every sound is synthesised live.

Play online: https://riffgewitter.netlify.app

## The tables

| | Riffgewitter | Rotorsturm | Erdabwehr |
|---|---|---|---|
| Theme | hard rock, lightning and fire | Vietnam 1968, rescue pilots | aliens attack Earth |
| Centrepiece | chrome skull with ball lock, pin-up Roxy | sunken steel helmet starts missions, helipad with helicopter | mothership with tractor beam, war robot astride the attack axis |
| Highlights | five-song setlist, backstage tour bus, turntable, mic stand, light truss | Cu Chi tunnel under glass with mini flipper, M16 diverter, red alert | two crossing ramps, tank emplacement, laser battery, saucer formation |
| Targets / lanes | R-O-C-K / A-M-P | stars / S-O-S | E-R-D-E / U-F-O |

All text is available in German and English. Camera views (player, full table, low angle, close up, top down) are switched with the button top right or the V key.

**Credits:** every device starts with 20 credits and a game costs one. After that the game points to MultiMate.app. Credits are kept only in browser storage (`localStorage`).

## Controls

| Action | Phone | Keyboard |
|---|---|---|
| Left flipper | left half of the screen | left arrow, A, left Shift |
| Right flipper | right half of the screen | right arrow, D, right Shift |
| Launch | hold right, release | hold Space, release |
| Nudge | button at the bottom centre | up arrow, N |
| Camera view | button top right | V |
| Pause | button top left | P, Esc |

## Build it yourself

Requirements: Node.js 20+, Python 3.11+ with Blender as a module. Run the commands from the German section in the same order: install, export the layout, bake the playfield texture and build the table in Blender (for each table `riff`, `rotor`, `alien`), then `npm run build` to bundle everything into `dist/`. `npm run serve` serves it locally.

**Music:** the owner's background songs are not in the public repository for rights reasons. Put the `.mp3` files into `assets/music/` and `npm run build` adds them to the jukebox. Without them the built-in synthesised soundtrack plays.

**Publish:** upload the `dist/` folder to any web host, for example Netlify.

## Tests

See the table in the German section: bot simulation, stuck-ball finder, browser end-to-end test, screenshots, audio check and playfield art preview.

## Structure

See the table in the German section. In short: `src/` is the game (layouts, physics, rules, renderer, art, audio, texts, design tokens), `blender/` builds the 3D tables, `assets/` holds the built tables and textures, `tools/` holds build, server and tests.

Fonts: Metal Mania, Black Ops One, Orbitron, Barlow, Barlow Condensed (SIL Open Font License).

Legal notice: [echomotion.ai/impressum](https://echomotion.ai/impressum) · © 2026 Echomotion GmbH
