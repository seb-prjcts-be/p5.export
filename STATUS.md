# STATUS — p5.export

## Werkwijze in dit repo (lees dit eerst)
- Werk **altijd in `C:\server\htdocs\p5.export` op `main`**. Geen worktrees, geen losse
  branches laten liggen — dat is wat het verwarrend maakte.
- **`main` is beveiligd:** direct pushen kan niet, GitHub eist een PR met een groene
  `validate`-check (zie docs/BRANCH_PROTECTION.md — zelf zo ingesteld). De werkwijze is dus:
  wijzig op main → tijdelijke branch → PR → mergen → branch weg → terug op main + `git pull`.
  Die branch bestaat alleen om de regel te passeren, niet om werk in te parkeren.
  Wil je dat niet meer, dan moet de ruleset in GitHub's repo-instellingen aangepast worden.
- `p5export.js` is **byte-identiek** aan de kopie in het repo **p5.waves_lab**.
  Wijzig dat bestand altijd in beide repo's tegelijk.

## Blokkades
- Geen.

## Volgende stap
- Niets openstaands. Wel nog te doen bij het Mac-onderzoek: op een machine waar opnemen
  faalt eerst gewoon opnieuw opnemen — de statusbalk noemt sinds de hardening zelf de reden.
  Blijft het onduidelijk, dan `mp4-export-diagnose.html` daar openen (op http/https, niet
  `file://`) en de uitvoer bekijken.

## Gedaan
- 2026-07-29: **MP4-export robuuster** (PR #5, gemerged). Even afmetingen afdwingen, encoder
  cappen op 1920 via hele deelfactoren, vooraf-check op `VideoEncoder` + `canEncodeVideo()`,
  en de échte foutmelding via `setStatus(..., 'error')` i.p.v. een stille reset. Nieuw:
  `mp4-export-diagnose.html`. Zie docs/decisions.md.
- 2026-07-29: **Download-link afgemaakt.** De `setPreviewLink`-wijziging die sinds 16 juli
  ongecommit in een worktree lag, is overgezet op de actuele code en gecommit. Klikken op de
  ✓-link downloadt nu een kopie van de mp4 in plaats van de blob in een tab te openen.
  Die worktree en de bijbehorende branches zijn opgeruimd.
- 2026-07-16: Uitgezocht waar mp4's terechtkomen: met gekozen map schrijft de tool direct
  naar schijf ([projectmap]/export/ of [outputmap]/[sketchnaam]/) via de File System Access
  API; zonder map valt hij terug op de Downloads-map.
