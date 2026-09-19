import { describe, expect, it } from 'vitest';
import { analyzeEditingHistory, isCameraFirmware } from '../heuristics/editingHistory';

type Lang = 'ru' | 'en' | 'uz';
const LANGS: Lang[] = ['ru', 'en', 'uz'];

const analyze = (metadata: Record<string, unknown>, xmp: Record<string, unknown> = {}, lang: Lang = 'en') =>
  analyzeEditingHistory(metadata, xmp, lang);

const UNTOUCHED = { edited: false, software: [], editingLevel: 'none', hints: [], aiScope: 'none', aiTool: null, aiEvidence: null, aiDetails: null };

describe('analyzeEditingHistory: software profiles', () => {
  it('Adobe Photoshop → professional edit', () => {
    const result = analyze({ Software: 'Adobe Photoshop 25.0 (Macintosh)' });
    expect(result.edited).toBe(true);
    expect(result.software).toContain('Adobe Photoshop');
    expect(result.editingLevel).toBe('professional');
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.aiScope).toBe('none');
    expect(result.aiTool).toBeNull();
  });

  it('"Photoshop" does not also match the Apple "Photos" profile (whole-word match)', () => {
    const result = analyze({ Software: 'Adobe Photoshop 25.0 (Macintosh)' });
    expect(result.software).toEqual(['Adobe Photoshop']);
    expect(result.hints).toHaveLength(1);
  });

  it('the most specific profile wins when product names nest', () => {
    expect(analyze({ Software: 'Google Photos' }).software).toEqual(['Google Photos']);
    expect(analyze({ Software: 'Photos 9.0' }).software).toEqual(['Photos']);
    const classic = analyze({}, { CreatorTool: 'Adobe Photoshop Lightroom Classic 13.0' });
    expect(classic.software).toEqual(['Adobe Lightroom']);
    expect(classic.editingLevel).toBe('professional');
    expect(analyze({ Software: 'Lightroom Classic 13.0' }).software).toEqual(['Adobe Lightroom']);
  });

  it('a profile name embedded in a longer word is not a match', () => {
    expect(analyze({ Software: 'GIMPY 1.0' })).toEqual({ ...UNTOUCHED, edited: true, software: ['GIMPY 1.0'] });
    expect(analyze({ Software: 'Reminiscence' }).software).toEqual(['Reminiscence']);
    expect(analyze({ Software: 'Topaz Photo AI 3.0' }).software).toEqual(['Topaz']);
  });

  it.each<[string, 'basic' | 'professional']>([
    ['Adobe Lightroom 7.0', 'professional'],
    ['Capture One 23', 'professional'],
    ['Affinity Photo 2', 'professional'],
    ['GIMP 2.10.34', 'professional'],
    ['DaVinci Resolve 18', 'professional'],
    ['Topaz Photo AI', 'professional'],
    ['Snapseed 2.19', 'basic'],
    ['VSCO', 'basic'],
    ['PicsArt 21.0', 'basic'],
    ['Samsung Gallery', 'basic'],
    ['Remini', 'basic']
  ])('%s → %s', (software, level) => {
    const result = analyze({ Software: software });
    expect(result.edited).toBe(true);
    expect(result.editingLevel).toBe(level);
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.software.length).toBeGreaterThan(0);
  });

  it('the strongest level wins when several editors are present', () => {
    const result = analyze({ Software: 'Snapseed' }, { CreatorTool: 'Adobe Lightroom 7.0' });
    expect(result.editingLevel).toBe('professional');
    expect(result.software).toEqual(expect.arrayContaining(['Snapseed', 'Adobe Lightroom']));
    expect(result.hints).toHaveLength(2);
  });

  it('reads lower-case keys and the XMP creator tool too', () => {
    expect(analyze({ software: 'GIMP 2.10' }).software).toEqual(['GIMP']);
    expect(analyze({}, { creatorTool: 'VSCO' }).editingLevel).toBe('basic');
    expect(analyze({}, { CreatorTool: 'Adobe Photoshop Lightroom Classic 13.0' }).edited).toBe(true);
  });

  it('matching is case-insensitive', () => {
    expect(analyze({ Software: 'ADOBE PHOTOSHOP' }).software).toContain('Adobe Photoshop');
    expect(analyze({ Software: 'gimp' }).software).toEqual(['GIMP']);
  });

  it('unknown software is reported verbatim without a level or hint', () => {
    const result = analyze({ Software: 'MyEditor 1.0' });
    expect(result).toEqual({ ...UNTOUCHED, edited: true, software: ['MyEditor 1.0'] });
  });

  it('a one-character software value is ignored', () => {
    expect(analyze({ Software: 'X' })).toEqual(UNTOUCHED);
  });

  it('camera firmware in Software is not an edit', () => {
    expect(analyze({ Software: '17.5.1', Make: 'Apple', Model: 'iPhone 15 Pro' })).toEqual(UNTOUCHED);
  });

  it.each([
    '17.5.1', // iPhone: iOS version
    '16.0',
    'v01.00.0500', // DJI
    'Ver.1.10', // Nikon / Panasonic
    'Version 1.0', // Olympus
    'Ver1.02',
    'Firmware Version 1.1.0', // Canon
    'Digital Camera X-T4 Ver1.02', // Fujifilm
    'GR III Ver1.00', // Ricoh
    'ILCE-7M3 v3.10', // Sony
    'S918BXXS4BXA1', // Samsung build ID
    'G991BXXU5DVJ8',
    'HUAWEI ELE-L29',
    'ELE-L29 10.0.0.168(C432E4R2P1)', // Huawei EMUI
    'HDR+ 1.0.540104767z', // Google Pixel camera pipeline
    'm2101k6g-user 11 RKQ1.201112.002 V12.5.5.0.RKHMIXM release-keys', // Xiaomi build fingerprint
    'HD7.01.01.90.00' // GoPro
  ])('firmware string %j → untouched', (software) => {
    expect(isCameraFirmware(software)).toBe(true);
    expect(analyze({ Software: software })).toEqual(UNTOUCHED);
  });

  it.each(['MyEditor 1.0', 'PhotoScape X v4.2', 'Snapseed 2.19', 'Pixelmator Pro 3.5', 'Midjourney', 'AUTOMATIC1111'])(
    'real software %j is still reported',
    (software) => {
      expect(isCameraFirmware(software)).toBe(false);
      expect(analyze({ Software: software }).edited).toBe(true);
    }
  );

  it('firmware next to a real editor keeps only the editor', () => {
    const result = analyze({ Software: '17.5.1' }, { CreatorTool: 'Adobe Lightroom 7.0' });
    expect(result.software).toEqual(['Adobe Lightroom']);
    expect(result.editingLevel).toBe('professional');
  });

  it('the XMP dc:creator (author name) is not software', () => {
    expect(analyze({}, { Creator: 'John Doe' })).toEqual(UNTOUCHED);
    expect(analyze({}, { creator: ['Jane Roe'] })).toEqual(UNTOUCHED);
    const signed = analyze({}, { Creator: 'John Doe', CreatorTool: 'Adobe Lightroom 7.0' });
    expect(signed.software).toEqual(['Adobe Lightroom']);
  });

  it('XMP history software agents and namespaced creator tools count as software', () => {
    expect(analyze({}, { HistorySoftwareAgent: 'Adobe Photoshop 25.0' }).software).toEqual(['Adobe Photoshop']);
    expect(analyze({}, { xmpMM: { History: [{ action: 'saved', softwareAgent: 'Snapseed 2.19' }] } }).software).toEqual(['Snapseed']);
    expect(analyze({}, { 'xmp:CreatorTool': 'GIMP 2.10' }).software).toEqual(['GIMP']);
    expect(analyze({}, { xmp: { CreatorTool: 'VSCO' } }).editingLevel).toBe('basic');
  });

  it('the same tool named in EXIF and XMP is listed once', () => {
    expect(analyze({ Software: 'MyEditor 1.0' }, { CreatorTool: 'myeditor 1.0' }).software).toEqual(['MyEditor 1.0']);
  });
});

describe('analyzeEditingHistory: clean camera EXIF', () => {
  it('Make/Model without Software → untouched', () => {
    expect(analyze({ Make: 'Canon', Model: 'Canon EOS R6', ExposureTime: 0.004, ISO: 200 })).toEqual(UNTOUCHED);
  });

  it('empty inputs → untouched', () => {
    expect(analyze({}, {})).toEqual(UNTOUCHED);
  });

  it('ordinary XMP fields do not trigger AI detection', () => {
    const result = analyze({}, { description: 'Sunset over the river', Rating: 5, parameters: 'Steps: 20, Sampler: Euler a' });
    expect(result.aiScope).toBe('none');
    expect(result.aiTool).toBeNull();
  });
});

describe('analyzeEditingHistory: AI generation', () => {
  it('Stable Diffusion in the XMP creator tool → AI, and the tool is listed as software', () => {
    const result = analyze({}, { CreatorTool: 'Stable Diffusion' });
    expect(result.aiScope).toBe('generated');
    expect(result.aiTool).toBe('Stable Diffusion');
    expect(result.edited).toBe(true);
    expect(result.software).toContain('Stable Diffusion');
  });

  it.each<[string, string]>([
    ['Made with Midjourney v6', 'Midjourney'],
    ['DALL-E 3', 'DALL-E'],
    ['DALL·E', 'DALL-E'],
    ['Adobe Firefly Image 3', 'Adobe Firefly'],
    ['ComfyUI workflow', 'ComfyUI'],
    ['automatic1111 webui', 'Automatic1111'],
    ['a1111', 'Automatic1111'],
    ['NovelAI Diffusion', 'NovelAI'],
    ['Flux.1 dev', 'Flux'],
    ['DreamStudio', 'DreamStudio'],
    ['dream studio export', 'DreamStudio'],
    ['leonardo.ai', 'Leonardo.AI'],
    ['Runway Gen-3', 'Runway'],
    ['stable-diffusion-xl', 'Stable Diffusion']
  ])('marker %j anywhere in XMP → %s', (text, tool) => {
    const result = analyze({}, { description: text });
    expect(result.aiScope).toBe('generated');
    expect(result.aiTool).toBe(tool);
  });

  it('the word boundary on "flux" avoids false positives', () => {
    expect(analyze({}, { description: 'influx of tourists' }).aiScope).toBe('none');
    expect(analyze({}, { description: 'reflux' }).aiScope).toBe('none');
  });

  it('the first marker in the list wins when several match', () => {
    expect(analyze({}, { description: 'ComfyUI + Stable Diffusion XL' }).aiTool).toBe('Stable Diffusion');
    expect(analyze({}, { description: 'Runway and Midjourney' }).aiTool).toBe('Midjourney');
  });

  it('an AI marker in EXIF Software is detected as well', () => {
    const result = analyze({ Software: 'Midjourney' });
    expect(result.aiScope).toBe('generated');
    expect(result.aiTool).toBe('Midjourney');
    expect(result.software).toEqual(['Midjourney']);
  });

  it.each([
    [{ ai_type: 'generated' }],
    [{ source: 'ai' }],
    [{ credit: 'Generative Fill' }],
    [{ history: [{ action: 'generative expand' }] }]
  ])('explicit XMP marker %j → AI (unknown)', (xmp) => {
    const result = analyze({}, xmp);
    expect(result.aiScope).toBe('generated');
    expect(result.aiTool).toBe('AI (unknown)');
  });

  it('a real editor plus an AI marker keeps both facts', () => {
    const result = analyze({ Software: 'Adobe Photoshop 25.0' }, { description: 'Adobe Firefly generative fill' });
    expect(result.editingLevel).toBe('professional');
    expect(result.aiScope).toBe('generated');
    expect(result.aiTool).toBe('Adobe Firefly');
  });
});

describe('analyzeEditingHistory: languages', () => {
  it('hints are localised and non-empty; structure is language independent', () => {
    const results = LANGS.map((lang) => analyze({ Software: 'Adobe Lightroom 7.0' }, {}, lang));
    for (const result of results) {
      expect(result.software).toEqual(['Adobe Lightroom']);
      expect(result.editingLevel).toBe('professional');
      expect(result.hints).toHaveLength(1);
      expect(result.hints[0].trim().length).toBeGreaterThan(0);
    }
    expect(new Set(results.map((result) => result.hints[0])).size).toBe(3);
  });
});

describe('analyzeEditingHistory: IPTC DigitalSourceType', () => {
  it('reads the standard AI marker the generators write, top-level or nested', () => {
    const top = analyzeEditingHistory({}, { DigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' }, 'en');
    expect(top.aiScope).toBe('generated');
    expect(top.aiTool).toBe('AI (IPTC DigitalSourceType)');
    const nested = analyzeEditingHistory(
      { Software: 'Imagen 3' },
      { Iptc4xmpExt: { DigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia' } },
      'en'
    );
    expect(nested.aiScope).toBe('edited');
    expect(nested.aiTool).toBe('Imagen 3');
    expect(nested.aiEvidence).toContain('compositeWithTrainedAlgorithmicMedia');
    // A camera photo carries digitalCapture and is not AI.
    const capture = analyzeEditingHistory({}, { DigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture' }, 'en');
    expect(capture.aiScope).toBe('none');
  });
});

describe('analyzeEditingHistory: on-device generative editors', () => {
  const iptc = (credit: string, make = 'Apple') =>
    analyzeEditingHistory({ Make: make }, {}, 'en', null, { Credit: credit });

  it('reads the IPTC credit line iOS Clean Up writes as an edit, not as a generated picture', () => {
    const result = iptc('Apple Photos Clean Up');
    expect(result.aiScope).toBe('edited');
    expect(result.aiTool).toBe('Apple Photos Clean Up');
    expect(result.aiEvidence).toBe('Credit: Apple Photos Clean Up');
  });

  it('takes a bare «Clean Up» only on an Apple file: elsewhere it is somebody\'s name', () => {
    expect(iptc('Clean Up').aiScope).toBe('edited');
    expect(iptc('Clean Up', 'Canon').aiScope).toBe('none');
    // A whole credit line that merely contains the words is never an Apple marker.
    expect(iptc('Cleanup Crew Magazine').aiScope).toBe('none');
  });

  it('reads the Google and Samsung markers, and leaves an ordinary press credit alone', () => {
    expect(iptc('Edited with Google AI', 'Google').aiTool).toBe('Google AI');
    expect(iptc('Magic Eraser', 'Google').aiScope).toBe('edited');
    expect(iptc('Galaxy AI', 'samsung').aiTool).toBe('Galaxy AI');
    expect(iptc('Reuters / Ilya Naymushin', 'Canon').aiScope).toBe('none');
  });

  it('a multi-frame blend is a composite, not AI', () => {
    const result = iptc('Best Take', 'Google');
    expect(result.aiScope).toBe('composite');
    expect(result.aiTool).toBe('Best Take');
  });

  it('finds the credit in XMP photoshop:Credit too, nested or flat', () => {
    expect(analyzeEditingHistory({ Make: 'Apple' }, { photoshop: { Credit: 'Apple Photos Clean Up' } }, 'en').aiScope).toBe('edited');
    expect(analyzeEditingHistory({ Make: 'Apple' }, { 'photoshop:Credit': 'Apple Photos Clean Up' }, 'en').aiScope).toBe('edited');
  });
});

describe('analyzeEditingHistory: DigitalSourceType scopes', () => {
  const dst = (term: string, extra: Record<string, unknown> = {}) =>
    analyzeEditingHistory(extra, { DigitalSourceType: `http://cv.iptc.org/newscodes/digitalsourcetype/${term}` }, 'en');

  it.each([
    ['trainedAlgorithmicMedia', 'generated'],
    ['algorithmicMedia', 'generated'],
    ['digitalArt', 'generated'],
    ['compositeWithTrainedAlgorithmicMedia', 'edited'],
    ['compositeSynthetic', 'edited'],
    ['algorithmicallyEnhanced', 'edited'],
    ['compositeCapture', 'composite'],
    ['digitalCapture', 'none'],
    ['minorHumanEdits', 'none']
  ])('%s → %s', (term, scope) => {
    expect(dst(term).aiScope).toBe(scope);
  });

  it('matches the term, not a substring: the composite term is not read as the generated one', () => {
    // «compositeWithTrainedAlgorithmicMedia» ends with «trainedAlgorithmicMedia».
    expect(dst('compositeWithTrainedAlgorithmicMedia').aiScope).not.toBe('generated');
  });

  it('reads the tag from the IPTC group as well, and names the editor from the credit', () => {
    const result = analyzeEditingHistory(
      { Make: 'Apple' },
      {},
      'en',
      null,
      {
        Credit: 'Apple Photos Clean Up',
        DigitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia'
      }
    );
    expect(result.aiScope).toBe('edited');
    expect(result.aiTool).toBe('Apple Photos Clean Up');
    expect(result.aiEvidence).toContain('DigitalSourceType');
  });

  it('a named generator outranks the tag', () => {
    expect(dst('digitalCapture', { Software: 'Midjourney' }).aiScope).toBe('generated');
  });
});

describe('PNG text chunks of AI generators', () => {
  const parameters =
    'a cat sitting on a sofa, photorealistic, 85mm\nNegative prompt: blurry, lowres\nSteps: 30, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 123456, Size: 1024x1024, Model hash: 1fe6c7ec54, Model: juggernautXL_v9, Version: v1.9.4';

  it('reads the Automatic1111 «parameters» block: tool, model and the first prompt line', () => {
    const result = analyzeEditingHistory({}, {}, 'ru', { parameters });
    expect(result.aiScope).toBe('generated');
    expect(result.aiTool).toBe('Stable Diffusion');
    expect(result.aiDetails).toEqual({
      model: 'juggernautXL_v9',
      prompt: 'a cat sitting on a sofa, photorealistic, 85mm',
      chunk: 'parameters'
    });
  });

  it('reads a ComfyUI workflow: the checkpoint and the CLIP text', () => {
    const workflow = JSON.stringify({
      3: { class_type: 'KSampler', inputs: { seed: 1 } },
      4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
      6: { class_type: 'CLIPTextEncode', inputs: { text: 'a dog on the beach at sunset' } }
    });
    const result = analyzeEditingHistory({}, {}, 'en', { workflow });
    expect(result.aiTool).toBe('ComfyUI');
    expect(result.aiDetails).toEqual({ model: 'sd_xl_base_1.0.safetensors', prompt: 'a dog on the beach at sunset', chunk: 'workflow' });
  });

  it('recognises NovelAI by its Software chunk and takes the prompt from Description', () => {
    const result = analyzeEditingHistory({}, {}, 'en', {
      Software: 'NovelAI',
      Description: 'masterpiece, best quality, 1girl, city at night',
      Comment: '{"steps": 28, "sampler": "k_euler", "uc": "lowres"}'
    });
    expect(result.aiTool).toBe('NovelAI');
    expect(result.aiDetails?.prompt).toBe('masterpiece, best quality, 1girl, city at night');
  });

  it('cuts a long prompt to one line of 120 characters', () => {
    const long = `${'word '.repeat(60)}\nSteps: 20, Sampler: Euler a`;
    const result = analyzeEditingHistory({}, {}, 'en', { parameters: long });
    expect(result.aiDetails?.prompt?.length).toBe(120);
    expect(result.aiDetails?.prompt?.endsWith('…')).toBe(true);
  });

  it('leaves an ordinary PNG alone', () => {
    const result = analyzeEditingHistory({}, {}, 'en', { Software: 'GIMP 2.10', Comment: 'Created with GIMP', ImageWidth: 800 });
    expect(result.aiScope).toBe('none');
    expect(result.aiDetails).toBeNull();
    expect(analyzeEditingHistory({}, {}, 'en').aiDetails).toBeNull();
  });
});
