# Future video collection

No video files are in the repo. Do not invent video metrics until a file exists.

The annotation shape is already reserved in `annotations/videos.json`:

```ts
type ScannerVideoAnnotation = {
  videoId: string;
  path: string;
  segments: Array<{
    startMs: number;
    endMs: number;
    oracleId: string;
    cardName: string;
  }>;
};
```

Later scores, once those segments exist:

- correct card sessions
- wrong locks
- misses
- duplicate publications
- card-visible to first correct id, p50 and p95
- A→B transition latency
- manual actions

Those are the comparison points against a polished scanner. They are not computed now.

## Competitive-20 protocol

Use the same 20 physical cards for every pass.

1. Clean table, normal speed.
2. Fast swaps.
3. Messy background.
4. Poor light.
5. Angled.
6. Sleeved.
7. Glare or foil.
8. Natural use.

Do not pause to help the scanner lock. Present the card the way you would at a table.

Keep each pass as its own file so a session split cannot leak frames from one condition into another.
