import { mean, weightedRates } from './metrics.mjs';

const pct = rate => (rate == null ? 'n/a' : `${(100 * rate).toFixed(1)}%`);

export const summarizeRows = rows => {
  const visual = weightedRates(rows, 'visualTop1');
  const visual3 = weightedRates(rows, 'visualTop3');
  const visual5 = weightedRates(rows, 'visualTop5');
  const visual10 = weightedRates(rows, 'visualTop10');
  const ocrRows = rows.filter(r => r.ocrStatus);
  const ocrCorrect = ocrRows.filter(r => r.ocrNameMatch).length;
  const ocrWrong = ocrRows.filter(r => r.ocrWrongAccepted).length;
  const fused = weightedRates(
    rows.filter(r => r.fusedOk != null),
    'fusedOk',
  );
  return {
    n: rows.length,
    visual: { top1: visual, top3: visual3, top5: visual5, top10: visual10 },
    ocr: {
      n: ocrRows.length,
      nameMatch: ocrRows.length ? ocrCorrect / ocrRows.length : null,
      wrongAccepted: ocrRows.length ? ocrWrong / ocrRows.length : null,
      exact: ocrRows.filter(r => r.ocrStatus === 'exact-title').length,
      strongFuzzy: ocrRows.filter(r => r.ocrStatus === 'strong-fuzzy').length,
      ambiguous: ocrRows.filter(r => r.ocrStatus === 'ambiguous').length,
      noMatch: ocrRows.filter(r => r.ocrStatus === 'no-match' || r.ocrStatus === 'ocr-empty').length,
      wrongAcceptedCount: ocrWrong,
    },
    fusion: fused,
    geometry: {
      n: rows.filter(r => r.geometry).length,
      meanIou: mean(rows.map(r => r.geometry?.iou)),
      meanCornerNorm: mean(rows.map(r => r.geometry?.cornerNorm)),
      meanCornerPx: mean(rows.map(r => r.geometry?.cornerPx)),
    },
    timingsMs: {
      decode: mean(rows.map(r => r.timing?.decode)),
      detector: mean(rows.map(r => r.timing?.detector)),
      warp: mean(rows.map(r => r.timing?.warp)),
      crop: mean(rows.map(r => r.timing?.crop)),
      encoder: mean(rows.map(r => r.timing?.encoder)),
      search: mean(rows.map(r => r.timing?.search)),
      ocr: mean(rows.map(r => r.timing?.ocr)),
      fusion: mean(rows.map(r => r.timing?.fusion)),
      total: mean(rows.map(r => r.timing?.total)),
    },
  };
};

export const summaryMarkdown = summary => {
  const v = summary.variants ?? {};
  const line = (id, label) => {
    const block = v[id];
    if (!block) return `| ${label} | n/a | n/a |`;
    return `| ${label} | ${pct(block.visual.top1.frame)} | ${pct(block.visual.top3.frame)} |`;
  };
  const lines = [
    `# Scanner benchmark ${summary.experimentId}`,
    '',
    `Dataset ${summary.datasetVersion} \`${summary.datasetHash?.slice(0, 12) ?? ''}\`.`,
    '',
    summary.note ?? '',
    '',
    'Host benchmark timing is not Samsung latency.',
    '',
    '## Visual',
    '',
    '| Variant | Top1 | Top3 |',
    '| --- | ---: | ---: |',
    line('baseline', 'A Current detector'),
    line('oracle-card', 'B Oracle card corners'),
    line('oracle-art', 'C NOT INDEPENDENT / SAME CROP LOGIC'),
    '',
  ];
  if (summary.gains) {
    lines.push(
      `A→B Top1 gain: ${summary.gains.aToB == null ? 'not measurable' : pct(summary.gains.aToB)}`,
      '',
      `B→C Top1 gain: ${summary.gains.bToC == null ? 'not measurable' : pct(summary.gains.bToC)}`,
      '',
    );
  }
  lines.push(`Verdict: **${summary.verdict}**`, '', summary.verdictWhy ?? '', '');
  return `${lines.join('\n')}\n`;
};

const countLine = (block, key) => {
  if (!block) return 'n/a';
  const n = block.visual[key].n;
  const hits = Math.round((block.visual[key].frame ?? 0) * n);
  return `${hits}/${n}`;
};

export const decisionMarkdown = summary => {
  const a = summary.variants?.baseline;
  const b = summary.variants?.['oracle-card'];
  const g = summary.geometryAggregate;
  const lines = [
    '# ORACLE GEOMETRY DECISION',
    '',
    `N = ${summary.pairedFrames ?? 0}${summary.preliminary ? ' (PRELIMINARY)' : ''}`,
    '',
    `Dataset ${summary.datasetVersion} \`${summary.datasetHash?.slice(0, 12) ?? ''}\`.`,
    summary.previousDatasetHash ? `Previous hash \`${summary.previousDatasetHash.slice(0, 12)}\`.` : '',
    '',
    'Variant C is NOT INDEPENDENT / SAME CROP LOGIC. It uses the same art crop as oracle card.',
    '',
    '## CURRENT DETECTOR',
    '',
    a
      ? `Top1 ${countLine(a, 'top1')}  Top3 ${countLine(a, 'top3')}  Top5 ${countLine(a, 'top5')}  Top10 ${countLine(a, 'top10')}`
      : 'n/a',
    '',
    '## ORACLE CARD CORNERS',
    '',
    b
      ? `Top1 ${countLine(b, 'top1')}  Top3 ${countLine(b, 'top3')}  Top5 ${countLine(b, 'top5')}  Top10 ${countLine(b, 'top10')}`
      : 'n/a',
    '',
    '## RECOVERED',
    '',
    ...(summary.recovered?.length ? summary.recovered.map(name => `- ${name}`) : ['- none']),
    '',
    '## STILL WRONG',
    '',
    ...(summary.stillWrong?.length ? summary.stillWrong.map(name => `- ${name}`) : ['- none']),
    '',
    '## BROKEN BY ORACLE',
    '',
    ...(summary.broken?.length ? summary.broken.map(name => `- ${name}`) : ['- none']),
    '',
    '## CURRENT MISSES',
    '',
    ...((summary.missReviews ?? []).map(
      row =>
        `- ${row.cardName}: ${row.outcome} (rank ${row.currentRank ?? '—'} → ${row.oracleRank ?? '—'}, margin ${row.currentMargin?.toFixed(4) ?? '—'})`,
    )),
    '',
    '## GEOMETRY',
    '',
    g
      ? `Median IoU ${g.medianIou?.toFixed(3) ?? 'n/a'}. Median corner error ${g.medianCornerPx?.toFixed(1) ?? 'n/a'} px. p95 corner error ${g.p95CornerPx?.toFixed(1) ?? 'n/a'} px.`
      : 'n/a',
    '',
    `Verdict: **${summary.verdict}**`,
    '',
    summary.verdictWhy ?? '',
    '',
    '## NEXT',
    '',
    summary.nextExperiment ?? '',
    '',
  ];
  return `${lines.filter(line => line !== undefined).join('\n')}\n`;
};

const shot = (href, label) =>
  href ? `<figure><img src="${href}" alt=""><figcaption>${label}</figcaption></figure>` : '';

const topList = hits =>
  (hits ?? [])
    .slice(0, 5)
    .map((h, i) => `<li>${i + 1}. ${h.name} <span>${Number(h.score).toFixed(3)}</span></li>`)
    .join('');

export const galleryHtml = summary => {
  if (summary.comparisons?.length) {
    const cards = summary.comparisons
      .map(row => {
        const art = (label, href) => shot(href, label);
        const find = (list, label) => list?.find(a => a.label === label)?.href;
        return `<article class="${row.deltaClass}">
          <h3>${row.cardName} · ${row.deltaClass}</h3>
          <p>${row.imageId}${row.uncertain ? ' · uncertain edge' : ''}</p>
          <p>Current Top1 ${row.current.predicted ?? 'none'} rank ${row.current.expectedRank ?? '—'} margin ${row.current.margin?.toFixed(4) ?? '—'}</p>
          <p>Oracle Top1 ${row.oracle.predicted ?? 'none'} rank ${row.oracle.expectedRank ?? '—'} margin ${row.oracle.margin?.toFixed(4) ?? '—'}</p>
          <p>IoU ${row.geometry?.iou?.toFixed(3) ?? '—'} · corner ${row.geometry?.cornerPx?.toFixed(1) ?? '—'} px</p>
          <div class="shots">
            ${art('source', row.sourceHref)}
            ${art('current detector', find(row.current.artifacts, 'overlay'))}
            ${art('manual corners', find(row.oracle.artifacts, 'overlay'))}
            ${art('current warp', find(row.current.artifacts, 'warp'))}
            ${art('oracle warp', find(row.oracle.artifacts, 'warp'))}
            ${art('current art', find(row.current.artifacts, 'art'))}
            ${art('oracle art', find(row.oracle.artifacts, 'art'))}
          </div>
          <div class="tops"><div><h4>Current top 5</h4><ol>${topList(row.current.visualHits)}</ol></div>
          <div><h4>Oracle top 5</h4><ol>${topList(row.oracle.visualHits)}</ol></div></div>
        </article>`;
      })
      .join('\n');
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Oracle geometry</title>
<style>
body{font:14px/1.4 sans-serif;margin:24px;background:#111;color:#eee}
article{border:1px solid #333;padding:12px;margin:16px 0}
.GEOMETRY_FIX{border-color:#3a3}
.STILL_WRONG,.GEOMETRY_BREAK{border-color:#a44}
.shots{display:flex;gap:8px;flex-wrap:wrap}
.tops{display:flex;gap:24px}
img{max-height:240px;background:#000}
figure{margin:0}
</style></head><body>
<h1>${summary.verdict}${summary.preliminary ? ' · PRELIMINARY' : ''}</h1>
<p>${summary.verdictWhy ?? ''}</p>
<p>Variant C is not shown. It uses the same art crop as oracle card.</p>
${cards}
</body></html>`;
  }
  const groups = new Map();
  for (const row of summary.rows ?? []) {
    const key = row.failure || (row.identityCorrect ? 'CORRECT' : 'UNCLASSIFIED');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const section = (title, rows) => {
    const cards = rows
    .map(row => {
      const shots = (row.artifacts ?? [])
        .map(a => `<figure><img src="${a.href}" alt=""><figcaption>${a.label}</figcaption></figure>`)
        .join('');
      const tops = (row.visualHits ?? [])
        .slice(0, 5)
        .map((h, i) => `<li>${i + 1}. ${h.name} <span>${Number(h.score).toFixed(3)}</span></li>`)
        .join('');
      return `<article class="${row.identityCorrect ? 'ok' : 'bad'} ${row.failure ?? ''}">
        <h3>${row.cardName ?? 'unknown'} → ${row.predicted ?? 'none'}</h3>
        <p>${row.imageId}</p>
        <p>OCR ${row.ocrText ?? '—'} · ${row.ocrStatus ?? 'n/a'} · fusion ${row.fusionClass ?? 'n/a'} · ${row.failure ?? ''}</p>
        <div class="shots">${shots}</div>
        <ol>${tops}</ol>
      </article>`;
    })
    .join('\n');
    return `<section><h2>${title} (${rows.length})</h2>${cards}</section>`;
  };
  const body = [...groups.entries()].map(([title, rows]) => section(title, rows)).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Scanner benchmark</title>
<style>
body{font:14px/1.4 sans-serif;margin:24px;background:#111;color:#eee}
article{border:1px solid #333;padding:12px;margin:12px 0}
.bad{border-color:#a44}
.shots{display:flex;gap:8px;flex-wrap:wrap}
img{max-height:220px;background:#000}
figure{margin:0}
</style></head><body>
<h1>${summary.experimentId} · ${summary.verdict}</h1>
<p>${summary.verdictWhy ?? ''}</p>
${body || '<p>No scored rows.</p>'}
</body></html>
`;
};
