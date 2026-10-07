# Future recognition model

Do not train this yet. The benchmark has to say which error is large enough to justify it.

## Retrieval, not a 34k-way classifier

```text
phone card image
  → MTG-specific embedding
  → nearest neighbours in a canonical gallery
  → top-K oracle ids
  → OCR rerank
  → temporal evidence
```

A new set is added by embedding the new canonical cards. The encoder does not need a new class head for every release. Neighbour margin stays a confidence signal.

## Augmentation the trainer should see

Perspective, rotation, crop shift, and deliberate +3 / +5 / +10 percent crop error. Blur, motion blur, exposure, white balance, noise, JPEG damage, shadow, glare, sleeve reflection, partial occlusion, real backgrounds.

The previous generic CLIP art-crop runs were sensitive to the crop. The next encoder should tolerate a bad crop instead of requiring a perfect quad.

## Full card versus art crop

Compare these later, on the same phone frames:

- rough full card against canonical full-card embeddings
- art-ish crop against canonical art embeddings
- both, fused

An older full-card CLIP run does not settle this. The gallery and the phone crop were not the same kind of picture.
