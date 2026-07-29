# STATUS — p5.export

## Nu bezig
- **MP4-export robuuster gemaakt** (dezelfde ingreep als in p5.waves_lab; `p5export.js` is
  daar byte-identiek — wijzig altijd allebei). Zie docs/decisions.md. Kort: even afmetingen
  afdwingen, encoder cappen op 1920 via hele deelfactoren, vooraf-check op `VideoEncoder` +
  `canEncodeVideo()`, en de échte foutmelding via `setStatus(..., 'error')` i.p.v. een stille
  reset. Nieuw: `mp4-export-diagnose.html` om het encoder-pad op een andere machine te meten.

## Blokkades
- **Wacht op Seb:** `main` in dit repo is beveiligd (PR + groene `validate`-check vereist,
  zie docs/BRANCH_PROTECTION.md), dus direct pushen naar main kan niet. De commit staat op
  branch `claude/mp4-export-hardening` en is gepusht. Er is nog **geen PR geopend** — zeg
  of dat mag.

## Volgende stap
- Wijziging in worktree `jolly-clarke-91c342` (branch `claude/repo-update-check-696dbe`) nakijken en beslissen: committen/mergen naar main? Wijziging: status-link na mp4-export downloadt nu het bestand bij klikken (voorheen enkel blob-preview in nieuw tabblad). Let op: die worktree raakt óók `index.html`, maar een ander stuk (`setPreviewLink`) dan mijn wijziging hier (record-handler + error-listener).

## Gedaan
- 2026-07-16: Repo-check — main gelijk aan origin/main (3a91046), werkmap schoon.
- 2026-07-16: Uitgezocht waar mp4's terechtkomen: met gekozen map schrijft de tool direct naar schijf ([projectmap]/export/ of [outputmap]/[sketchnaam]/) via File System Access API; zonder map valt hij terug op de Downloads-map. De ✓-link in de status was enkel een blob-preview.
- 2026-07-16: index.html aangepast (in worktree): setPreviewLink kreeg een download-parameter; klikken op de ✓-link downloadt nu ook een kopie van de mp4.
