# STATUS — p5.export

## Nu bezig
- **MP4-export robuuster gemaakt** (dezelfde ingreep als in p5.waves_lab; `p5export.js` is
  daar byte-identiek — wijzig altijd allebei). Zie docs/decisions.md. Kort: even afmetingen
  afdwingen, encoder cappen op 1920 via hele deelfactoren, vooraf-check op `VideoEncoder` +
  `canEncodeVideo()`, en de échte foutmelding via `setStatus(..., 'error')` i.p.v. een stille
  reset. Nieuw: `mp4-export-diagnose.html` om het encoder-pad op een andere machine te meten.

## Blokkades
- **Wacht op Seb:** PR #5 (`claude/mp4-export-hardening` → `main`) staat open, `validate` is
  groen, mergeable. Alleen jij kunt mergen — `main` is beveiligd (PR + groene check vereist,
  zie docs/BRANCH_PROTECTION.md). https://github.com/seb-prjcts-be/p5.export/pull/5

## Volgende stap
- Wijziging in worktree `jolly-clarke-91c342` (branch `claude/repo-update-check-696dbe`) nakijken en beslissen: committen/mergen naar main? Wijziging: status-link na mp4-export downloadt nu het bestand bij klikken (voorheen enkel blob-preview in nieuw tabblad). Let op: die worktree raakt óók `index.html`, maar een ander stuk (`setPreviewLink`) dan mijn wijziging hier (record-handler + error-listener).

## Gedaan
- 2026-07-16: Repo-check — main gelijk aan origin/main (3a91046), werkmap schoon.
- 2026-07-16: Uitgezocht waar mp4's terechtkomen: met gekozen map schrijft de tool direct naar schijf ([projectmap]/export/ of [outputmap]/[sketchnaam]/) via File System Access API; zonder map valt hij terug op de Downloads-map. De ✓-link in de status was enkel een blob-preview.
- 2026-07-16: index.html aangepast (in worktree): setPreviewLink kreeg een download-parameter; klikken op de ✓-link downloadt nu ook een kopie van de mp4.
