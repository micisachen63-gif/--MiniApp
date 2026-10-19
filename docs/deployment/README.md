# Production receipt location

The authoritative receipts are now on the append-only `deployment-records` branch:

- [Game Worker receipt](https://github.com/micisachen63-gif/--MiniApp/blob/deployment-records/docs/deployment/elf-rpg-api.json)
- [Cloud BOT receipt](https://github.com/micisachen63-gif/--MiniApp/blob/deployment-records/docs/deployment/star-journal-rpg-bot.json)

The JSON files on `main` are historical snapshots retained for continuity. Future releases do not update them.
Fetch `origin deployment-records`, then use `git show origin/deployment-records:docs/deployment/<service>.json`.
Never deploy or check out the metadata branch as game source. Deploy only reviewed `origin/main`.

See [CI and release record handover](../CI_AND_RELEASE_RECORDS_20261019.txt).
