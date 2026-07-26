# Golden evaluation set

This is the ground truth for the OCR pipeline. Until the `actual` columns are
filled, every accuracy claim about this app is a guess — an audit sampled 12
poles and found 10 accepted with only 4 correct, all scoring 0.90+.

## How to label (≈1 hour for everything)

For each drawing folder:

- **`<drawing>/poles/`** — open each `<n>.png`, read the pole ID printed in it,
  and type it into the `actual` column of `labels.csv` on the row with that
  `pole_id`. If the crop is not a pole label at all (clutter, half a symbol),
  write `MISSING`.
- **`<drawing>/strand/`** — same, but the content is a strand length number
  (metres). Type the number you see. If the crop is not a number, write
  `MISSING`.

Do not correct the `predicted` column — that is what the pipeline said, and the
gap between it and `actual` is the measurement.

## How to score

```
python -X utf8 scripts/pole_eval.py  eval --dxf uploads/LP1709.dxf --labels eval_data/LP1709/poles/labels.csv
python -X utf8 scripts/strand_eval.py eval --dxf uploads/LP1709.dxf --layer "PDF_S102$STRAND" --out-dir eval_data/LP1709/strand --labels eval_data/LP1709/strand/labels.csv
```

The reports show three numbers that matter:

- **Accuracy** — exact matches.
- **LOST** — labelled items the pipeline no longer detects. A lost pole means a
  wrong span; this is the failure that costs the most downstream.
- **Wrong but ACCEPTED** (poles) — misreads that passed the confidence gate, so
  nobody was ever asked to review them. This is the dangerous bucket.

Rows are matched by drawing coordinates (`cx`, `cy`), not by id, so pipeline
changes that renumber candidates cannot silently shift the scoring.

## Strand layers per drawing

| Drawing | Layer(s) |
|---|---|
| LP1709 | `PDF_S102$STRAND` |
| TY1401 | `PDF_STTEXT01` |
| MN6001 | `PDF_s48$STRAND` |
| BCR405 | `PDF_DISTANCE,PDF_STRAND` |
