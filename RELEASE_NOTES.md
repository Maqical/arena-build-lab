# Arena Build Lab v1.1.0 release candidate

v1.1.0 adds the competitive-intelligence layer on top of the verified live overlay, resolver, and immutable match warehouse.

## Highlights

- NA, KR, and Global data contexts with region-scoped meta aggregation.
- Dynamic champion tier lists, matchup intelligence, duo synergy, and patch trends.
- ASIA-routed KR snowball crawler with strict rate limiting and deduplication.
- Public tracked-player registry, local follow state, exact setup copying, scheduled refreshes, and optional Twitch status.
- Match-v5 purchase timeline ingestion and champion-plus-augment purchase-order recommendations.
- Post-game performance scores and grades, personal form trends, and native record notifications.
- Desktop notifications for followed-player activity, patch changes, and personal stat records.
- Shareable local meta reports with patch, region, and sample-size provenance.

## Verification status

- Lint, TypeScript, and unit tests pass.
- Production web build passes.
- Competitive UI smoke test passes against the 1,075-match NA warehouse.
- The KR crawler is implementation-complete; a current Riot development key is required to populate the 1,000-match KR cohort.

No repository push or release tag is created until the packaged RC completes an installed live-game test.
