# Website build and hosting

The full 2012 game is still being rebuilt. Restoration data lives in `public/restoration/progress.json`; the build validates its gates and calculates the displayed percentages. These are reviewed evidence assignments, not a live backend test report. Artwork provenance and publication limits are in `docs/THIRD_PARTY.md`.

Website `main` publishes GitHub Pages using the live server/client revisions, patched movie, pinned Ruffle and audio. Successful server/client deployments request republication. Website changes do not restart the game.

```sh
SITE_URL=http://127.0.0.1:18924/ CLIENT_DIR=../client npm test
SITE_URL=http://127.0.0.1:18924/ API_ORIGIN=http://127.0.0.1:18924 CLIENT_DIR=../client npm run build
```

Gameplay and API requests use `API_ORIGIN` (production: https://game.openrotmg.org). The website/client remain available during a game-server outage. The July 2010 preview remains at https://www.openrotmg.org/2010/ to preserve its saved identity.

Local development is served entirely by the local backend: the server's `./run.sh` downloads and prepares the client automatically. No hosted website connection or local-network permission is needed.
