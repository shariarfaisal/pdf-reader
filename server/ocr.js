import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { chatCompletion, getCompletionText } from './usage.js';

const execFileAsync = promisify(execFile);
const BIN_DIR = path.resolve(process.cwd(), 'bin');
const PDF_TOOL_BIN = path.join(BIN_DIR, 'pdf_tool');
const MACOS_OCR_BIN = path.join(BIN_DIR, 'macos_ocr');
const TESSDATA_DIR = path.join(BIN_DIR, 'tessdata');
const BIJOY_SCRIPT = path.join(BIN_DIR, 'convert_bijoy.py');

// Script detection regexes
const BENGALI_UNICODE_REGEX = /[\u0980-\u09FF]/;
const ARABIC_UNICODE_REGEX = /[\u0600-\u06FF]/;

/**
 * Detect if text is legacy Bijoy/ANSI Bengali encoding
 */
export function isBijoyEncoded(text) {
  if (!text || text.length < 5) return false;

  // Bijoy characteristic vowel signs: † (alt-0134), ‡ (alt-0135), ˆ, ‰, Š, ‹, Œ
  const hasBijoyVowels = /[\u2020\u2021\u02c6\u2030\u0160\u2039\u0152]/.test(text);
  if (hasBijoyVowels) return true;

  // Common Bijoy word patterns
  const bijoyPatterns = [
    /Zvdmxi/i, /cvewj‡Kkb/i, /wbwl×/i, /m~iv/i, /cviv/i, /AvZ¥i¶v/i,
    /†gvt/i, /Be&b/i, /gyRxeyi/i, /†nv‡mb/i, /ingvb/i, /evmv/i, /moK/i,
    /hy×/i, /†Zvgiv/i, /Avj­vni/i, /cÖwZwôZ/i
  ];

  return bijoyPatterns.some(regex => regex.test(text));
}

/**
 * Convert Bijoy/ANSI text to clean Unicode Bengali
 */
export async function convertBijoyToUnicode(bijoyText) {
  return new Promise((resolve) => {
    try {
      const child = spawn('python3', [BIJOY_SCRIPT]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => { stdout += data.toString(); });
      child.stderr.on('data', data => { stderr += data.toString(); });

      child.on('close', code => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          console.warn('[Bijoy Converter] Error:', stderr);
          resolve(bijoyText);
        }
      });

      child.stdin.write(bijoyText);
      child.stdin.end();
    } catch (e) {
      console.warn('[Bijoy Converter] spawn error:', e.message);
      resolve(bijoyText);
    }
  });
}

/**
 * Extract digital text directly from PDF page
 */
export async function extractDigitalText(pdfPath, pageIndex) {
  try {
    const { stdout } = await execFileAsync(PDF_TOOL_BIN, [pdfPath, 'extract-text', String(pageIndex)]);
    const res = JSON.parse(stdout.trim());
    return res.text ? res.text.trim() : '';
  } catch (err) {
    return '';
  }
}

/**
 * Render a single PDF page to a PNG file (2x DPI by default).
 * Pass a smaller scale (e.g. 1.4) for lightweight UI previews; a `.jpg` output
 * path encodes JPEG instead of PNG to keep those previews small.
 */
export async function renderPdfPage(pdfPath, pageIndex, outputPath, scale = 2.0) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const args = [pdfPath, 'render-page', String(pageIndex), outputPath];
  if (scale !== 2.0) args.push(String(scale));
  const { stdout } = await execFileAsync(PDF_TOOL_BIN, args);
  const res = JSON.parse(stdout.trim());
  if (!res.success) {
    throw new Error(res.error || 'Failed to render PDF page');
  }
  return outputPath;
}

/**
 * Get PDF metadata and total page count
 */
export async function getPdfInfo(pdfPath) {
  const { stdout } = await execFileAsync(PDF_TOOL_BIN, [pdfPath, 'info']);
  return JSON.parse(stdout.trim());
}

/**
 * Run local Tesseract OCR with Bengali, Arabic, and English traineddata
 */
export async function runTesseractOcr(imagePath) {
  try {
    const resolvedPath = fs.realpathSync(imagePath);
    const { stdout } = await execFileAsync('tesseract', [
      resolvedPath,
      'stdout',
      '--tessdata-dir', TESSDATA_DIR,
      '-l', 'ben+ara+eng'
    ]);
    const cleanText = stdout.trim();
    return {
      text: cleanText,
      success: cleanText.length > 0,
      source: 'tesseract_multilingual'
    };
  } catch (err) {
    console.warn(`[Tesseract OCR] Execution failed: ${err.message}`);
    return { text: '', success: false, source: 'tesseract_multilingual', error: err.message };
  }
}

/**
 * Run Apple Vision framework native OCR on image
 */
export async function runMacVisionOcr(imagePath) {
  try {
    const { stdout } = await execFileAsync(MACOS_OCR_BIN, [imagePath]);
    const res = JSON.parse(stdout.trim());
    return {
      text: res.text || '',
      confidence: res.confidence || 0,
      lineCount: res.lineCount || 0,
      success: !!res.success,
      source: 'mac_vision'
    };
  } catch (err) {
    return { text: '', confidence: 0, lineCount: 0, success: false, source: 'mac_vision', error: err.message };
  }
}

/**
 * Fallback Vision LLM transcription for complex scanned books,
 * or remote server hosting Baidu Unlimited-OCR / SGLang / Gemini / OpenAI.
 */
export async function runLlmVisionOcr(imagePath, settings, context = {}) {
  const apiKey = settings.llm_vision_key;
  const baseUrl = (settings.llm_vision_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = settings.llm_vision_model || 'gpt-4o';

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Data = imageBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64Data}`;

  const prompt = `You are a high-precision OCR and document transcription engine.
Transcribe the entire visible text from this book page with exact fidelity.
Languages present may include Bengali (বাংলা), Arabic (العربية), and English.
Guidelines:
1. Preserve mixed scripts (Bengali narrative, Arabic verses/hadith, English terms).
2. Maintain natural paragraph layout.
3. Transcribe only what is printed on the page. Do not add conversational commentary or markdown code blocks.`;

  const payload = {
    model: model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 3000
  };


  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

  // Metered call: throws on HTTP/transport failure, logs tokens + cost per page.
  const result = await chatCompletion({
    url: endpoint,
    apiKey,
    model,
    payload,
    stage: 'ocr',
    projectId: context.projectId ?? null,
    pageNumber: context.pageNumber ?? null,
    // '1' (default) = local proxy is free; only full API rates when set to '0'
    billableLocal: settings.usage_free_local === '0',
    throwOnError: true
  });

  const text = getCompletionText(result.json);
  return {
    text: text,
    confidence: 0.95,
    source: 'llm_vision'
  };
}

/**
 * Unified Extraction Pipeline for a page:
 * 1. Digital text check (with auto-detection and decoding of Bijoy / ANSI legacy Bengali).
 * 2. If image/scanned or text is missing:
 *    - Render page image to 2x PNG.
 *    - Run local Tesseract OCR with Bengali + Arabic + English (`ben+ara+eng`).
 *    - In parallel/fallback, run Apple Vision OCR (`bin/macos_ocr`).
 *    - If configured or needed, fallback to external LLM Vision (Gemini / OpenAI / Baidu Unlimited-OCR).
 */
export async function extractPageText(pdfPath, pageIndex, renderPath, settings, context = {}) {
  // 1. Digital text check
  const digitalText = await extractDigitalText(pdfPath, pageIndex);

  if (digitalText && digitalText.length >= 25) {
    // Check if the digital text is encoded in legacy Bijoy / ANSI Bengali
    if (isBijoyEncoded(digitalText)) {
      const unicodeConverted = await convertBijoyToUnicode(digitalText);
      return {
        text: unicodeConverted,
        source: 'bijoy_digital',
        confidence: 1.0
      };
    }

    // Check if digital text contains genuine Unicode Bengali, Arabic, or English
    const hasUnicode = BENGALI_UNICODE_REGEX.test(digitalText) || ARABIC_UNICODE_REGEX.test(digitalText) || /[a-zA-Z]{5,}/.test(digitalText);
    if (hasUnicode) {
      return {
        text: digitalText,
        source: 'digital',
        confidence: 1.0
      };
    }
  }

  // 2. Render page to image if not already rendered
  if (!fs.existsSync(renderPath)) {
    await renderPdfPage(pdfPath, pageIndex, renderPath);
  }

  // Check OCR tier setting
  const tier = settings.ocr_tier || 'mac_first';

  if (tier === 'llm_only' && (settings.llm_vision_key || settings.llm_vision_url)) {
    return await runLlmVisionOcr(renderPath, settings, context);
  }

  // 3. Local Tesseract OCR (Bengali + Arabic + English)
  const tessRes = await runTesseractOcr(renderPath);
  if (tessRes.success && tessRes.text.length >= 35) {
    return {
      text: tessRes.text,
      source: 'tesseract_multilingual',
      confidence: 0.90
    };
  }

  // 4. Apple Vision OCR (fast neural engine for Latin / Arabic scripts)
  const macRes = await runMacVisionOcr(renderPath);
  if (macRes.success && macRes.text.length >= 35) {
    return {
      text: macRes.text,
      source: 'mac_vision',
      confidence: macRes.confidence
    };
  }

  // 5. Fallback to external LLM Vision (OpenAI / Gemini / Baidu Unlimited-OCR endpoint)
  if (settings.llm_vision_key || (settings.llm_vision_url && !settings.llm_vision_url.includes('openai.com'))) {
    try {
      const llmRes = await runLlmVisionOcr(renderPath, settings, context);
      if (llmRes.text) {
        return llmRes;
      }
    } catch (err) {
      console.warn(`[OCR] LLM Vision fallback failed: ${err.message}.`);
    }
  }

  // Return best available result
  return {
    text: tessRes.text || macRes.text || digitalText || '',
    source: tessRes.text ? 'tesseract_multilingual' : (macRes.text ? 'mac_vision' : 'digital'),
    confidence: tessRes.text ? 0.85 : (macRes.confidence || 0)
  };
}
