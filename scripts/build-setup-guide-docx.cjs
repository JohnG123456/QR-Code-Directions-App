/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run directly */
// Rebuilds docs/New-Resort-Setup-Guide.docx from lib/guides/new-resort-setup.json,
// the same file the admin Setup guide page reads, so the two never disagree.
// Run after editing the guide:
//   npm i --no-save docx && node scripts/build-setup-guide-docx.cjs lib/guides/new-resort-setup.json docs/New-Resort-Setup-Guide.docx
const fs = require('fs');
const d = require('docx');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, LevelFormat, BorderStyle, ShadingType, Footer, PageNumber, AlignmentType } = d;
const g = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];
const FONT = 'Arial';

const runs = (text, extra = {}) => text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(p =>
  p.startsWith('**') ? new TextRun({ text: p.slice(2, -2), bold: true, ...extra }) : new TextRun({ text: p, ...extra }));
const bullet = t => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80 }, children: runs(t) });

const numberingConfig = [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }];
g.steps.forEach(s => numberingConfig.push({ reference: 'n-' + s.id, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] }));
numberingConfig.push({ reference: 'overview', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] });

const kids = [
  new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(g.title)] }),
  new Paragraph({ spacing: { after: 120 }, children: runs(g.summary) }),
  new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: `QR Code Directions App · Admin area → Setup guide · Last reviewed ${g.lastReviewed}`, color: '666666', size: 18 })] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Steps at a glance')] }),
  ...g.steps.map(s => new Paragraph({ numbering: { reference: 'overview', level: 0 }, spacing: { after: 40 }, children: [new TextRun(s.title)] })),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(g.before.title)] }),
  ...g.before.items.map(bullet),
];
g.steps.forEach((s, i) => {
  kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`${i + 1}. ${s.title}`)] }));
  kids.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Where: ', bold: true, color: '555555', size: 20 }), new TextRun({ text: s.where, color: '555555', size: 20 })] }));
  s.do.forEach(t => kids.push(new Paragraph({ numbering: { reference: 'n-' + s.id, level: 0 }, spacing: { after: 80 }, children: runs(t) })));
  if (s.checks) {
    kids.push(new Paragraph({ spacing: { before: 160, after: 80 }, keepNext: true, children: [new TextRun({ text: s.checks.title, bold: true, size: 23 })] }));
    kids.push(new Paragraph({ spacing: { after: 80 }, children: runs(s.checks.intro) }));
    const lines = s.checks.query.split('\n');
    lines.forEach((line, n) => kids.push(new Paragraph({
      spacing: { after: 0, before: 0 }, keepLines: true, keepNext: n < lines.length - 1,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' }, indent: { left: 120, right: 120 },
      children: [new TextRun({ text: line.replace(/^ +/, m => ' '.repeat(m.length)) || ' ', font: 'Consolas', size: 17 })],
    })));
    kids.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    s.checks.items.forEach(t => kids.push(bullet(t)));
  }
  if (s.watch) kids.push(new Paragraph({
    spacing: { before: 120, after: 120 }, indent: { left: 120, right: 120 },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF4DC' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'D99A00', space: 6 } },
    children: [new TextRun({ text: 'Watch out: ', bold: true }), ...runs(s.watch)],
  }));
});
kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(g.later.title)] }));
g.later.items.forEach(t => kids.push(bullet(t)));

const doc = new Document({
  creator: 'Providence Lifestyle Group', title: g.title,
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 40, bold: true }, paragraph: { spacing: { before: 0, after: 160 }, keepNext: true } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 28, bold: true, color: '1F1F1F' }, paragraph: { spacing: { before: 320, after: 80 }, keepNext: true, outlineLevel: 0 } },
    ],
  },
  numbering: { config: numberingConfig },
  sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${g.title} · page `, size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' })] })] }) },
    children: kids,
  }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(out, b); console.log('wrote', out); });
