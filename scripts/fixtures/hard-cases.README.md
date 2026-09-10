# Hard-case real photos

Catalog: `scripts/fixtures/hard-cases.json` (committed metadata only).

Place matching PNGs at the paths listed in each case (`detectPath` /
`pipelinePath`). Those directories are gitignored — do **not** commit card art.

| Case | Stress |
|------|--------|
| Maddening Hex AFC showcase | D&D showcase frame, vertical mana, orange sleeve, strong glare |
| The Deck of Many Things (FR) | Long French title; fragment risk → Waker of the Wilds ~0.72 must stay unpublished |

```bash
# detection corpus
yarn scan:detect-eval --real

# recognition pipeline on real photos
yarn scan:pipeline:real
```
