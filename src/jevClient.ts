/**
 * jevClient.ts
 *
 * Thin, typed wrapper around the TypeSafe "System One" API (the Jev model).
 *
 * Jev is a System-1 decision model: instead of generating prose, it evaluates
 * typed questions against a state and returns a single structured answer with
 * a confidence. We use it for fast element selection:
 *   - state       = the natural-language description of the element to act on
 *   - one Choice question "pick" = the compressed page elements (id → description)
 *   - answer      = { choice: <element id>, confidence: 0..1 }
 *
 * Endpoint: POST {baseUrl}/systemone   (default https://api.typesafe.ai/v1)
 * Docs: https://docs.typesafe.ai
 *
 * When the API is unreachable, a general-purpose heuristic fallback is used.
 * Heuristic results are labeled source:"heuristic" with capped confidence so
 * weak matches do not auto-click under a normal threshold.
 */

import { z } from 'zod';
import { logger } from './utils/logger';
import type { CompressedElement } from './utils/compressDOM';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface JevClientConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** HTTP timeout in ms (default 8 000) */
  timeoutMs?: number;
}

// ─── Request / Response Schemas ──────────────────────────────────────────────

/** TypeSafe /systemone request body. */
interface TypeSafeRequestBody {
  model: string;
  /** The state to evaluate — here, the user's element-selection intent. */
  state: string;
  questions: {
    pick: {
      type: 'choice';
      instructions: string;
      /** element id → short description */
      criteria: Record<string, string>;
    };
  };
}

/** Validated TypeSafe API response (one entry per asked question). */
const TypeSafeAnswerSchema = z.object({
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()).optional(),
});

const TypeSafeResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), TypeSafeAnswerSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

/** Internal selection result shape (unchanged across API backends). */
interface SelectionResult {
  target_id: {
    choice: string;
    confidence: number;
  };
  reasoning?: string;
  latency_ms?: number;
}

export type SelectorSource = 'jev' | 'heuristic';

export type JevResponse = SelectionResult & {
  source: SelectorSource;
};

/** Compact, token-cheap description of one element for the Choice criteria. */
function describeElement(el: CompressedElement): string {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const parts: string[] = [el.role || el.tag.toLowerCase()];
  const text = clean(el.text);
  const aria = clean(el.ariaLabel);
  const ph = clean(el.placeholder);
  if (text) parts.push(`text "${text}"`);
  if (aria && aria !== text) parts.push(`aria "${aria}"`);
  if (ph) parts.push(`placeholder "${ph}"`);
  if (el.zone) parts.push(`zone ${el.zone}`);
  return parts.join(' ');
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class JevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: JevClientConfig) {
    this.apiKey    = config.apiKey;
    this.baseUrl   = (config.baseUrl ?? 'https://api.typesafe.ai/v1').replace(/\/$/, '');
    this.model     = config.model    ?? 'jev-latest';
    this.timeoutMs = config.timeoutMs ?? 8_000;
  }

  /**
   * Ask Jev to identify the best-matching element from the compressed DOM list.
   *
   * @param elements  Compressed DOM elements (from compressDOM).
   * @param targetDescription  Natural-language goal from the planner.
   * @returns  A validated JevResponse containing the chosen element id and confidence.
   */
  async selectElement(
    elements: CompressedElement[],
    targetDescription: string,
  ): Promise<JevResponse> {
    if (elements.length === 0) {
      throw new Error('JevClient.selectElement: elements array is empty — nothing to choose from.');
    }

    const body: TypeSafeRequestBody = {
      model: this.model,
      state: `The user is driving a web browser and wants to act on one element of the current page. What the user is looking for: ${targetDescription}`,
      questions: {
        pick: {
          type: 'choice',
          instructions:
            'Which single interactive element on the page should be acted on to fulfil the user\'s intent? ' +
            'Choose exactly one id from the criteria. Prefer specific content elements over generic site chrome unless asked for.',
          criteria: Object.fromEntries(elements.map(el => [el.id, describeElement(el)])),
        },
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    logger.debug('JevClient → request', { model: this.model, elementCount: elements.length, target: targetDescription });

    let raw: unknown;
    try {
      const resp = await fetch(`${this.baseUrl}/systemone`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-Client':      'jev-fast-playwright/1.1.0',
        },
        body:   JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '(no body)');
        throw new Error(`TypeSafe API HTTP ${resp.status}: ${text}`);
      }

      raw = await resp.json();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        logger.warn(`TypeSafe API timed out after ${this.timeoutMs}ms, using fallback selector`);
      } else {
        logger.warn('TypeSafe API call failed, using fallback selector', { err: String(err) });
      }
      return this.heuristicSelect(elements, targetDescription);
    } finally {
      clearTimeout(timer);
    }

    // Validate and map the response to the internal selection shape
    const parsed = TypeSafeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error('JevClient ← invalid response shape, using fallback selector', { issues: parsed.error.issues, raw });
      return this.heuristicSelect(elements, targetDescription);
    }

    const answer = parsed.data.answers['pick'];
    const chosen = elements.find(e => e.id === answer?.choice);
    if (!answer || !chosen) {
      logger.warn('TypeSafe API returned an unknown element id, using fallback selector', { choice: answer?.choice });
      return this.heuristicSelect(elements, targetDescription);
    }

    const label = chosen.text ?? chosen.ariaLabel ?? chosen.role;
    logger.debug('JevClient ← response', {
      choice: answer.choice,
      confidence: answer.confidence,
      model: parsed.data.model,
      usage: parsed.data.usage,
    });

    return {
      target_id: { choice: answer.choice, confidence: answer.confidence },
      reasoning: `typeSafe ${parsed.data.model ?? this.model} picked [${answer.choice}] "${label}" for "${targetDescription}"`,
      source: 'jev',
    };
  }

  /**
   * General-purpose text/role heuristic — no site-specific hardcoding.
   *
   * Scoring favors distinctiveness: rare tokens in the description outweigh
   * generic short labels, header/footer chrome is down-weighted for content
   * intents ("open the product card…"), and "not X" phrasing excludes
   * elements. Confidence is capped so weak matches fail the confidence gate.
   */
  private heuristicSelect(elements: CompressedElement[], targetDescription: string): JevResponse {
    const desc = targetDescription.toLowerCase().trim();
    const { include: words, exclude: excludeWords } = parseTargetWords(desc);
    const distinctive = words.filter(w => !MODIFIER_WORDS.has(w));
    const contentIntent = CONTENT_INTENT_RE.test(desc);

    const wantsInput =
      /\b(input|field|textbox|search|type|email|password|username)\b/.test(desc);
    const wantsButton =
      /\b(button|click|submit|add to cart|buy|checkout|sign.?in|log.?in|continue)\b/.test(desc);
    const wantsLink =
      /\b(link|nav|menu|category|tab)\b/.test(desc);

    interface Scored { el: CompressedElement; score: number; distinctMatched: number; }
    const scored: Scored[] = elements.map(el => {
      const text = (el.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
      const aria = (el.ariaLabel ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
      const placeholder = (el.placeholder ?? '').toLowerCase().trim();
      const name = (el.name ?? '').toLowerCase().trim();
      const role = (el.role ?? '').toLowerCase();
      const combined = `${text} ${aria} ${placeholder} ${name} ${role}`;

      let score = 0;
      const matched = new Set<string>();

      // Distinctiveness-weighted token hits
      for (const w of words) {
        if (!phraseIn(combined, w)) continue;
        matched.add(w);
        score += MODIFIER_WORDS.has(w) ? 1 : 3 + Math.min(4, w.length);
      }
      const distinctMatched = distinctive.filter(w => matched.has(w)).length;

      // Phrase bonuses, scaled by how much of the description the label explains,
      // so a one-word nav label ("Shoes") cannot outscore a specific product card
      // just because the word appears in the description.
      const denom = Math.max(2, words.length);
      const textWords = text ? text.split(' ').length : 0;
      const explain = Math.max(0.25, Math.min(1, textWords / denom));
      if (text.length >= 3 && phraseIn(desc, text)) score += 14 * explain;
      if (aria.length >= 3 && phraseIn(desc, aria)) score += 10 * explain;
      if (placeholder && phraseIn(desc, placeholder)) score += 10;
      if (desc.length >= 4 && phraseIn(combined, desc)) score += 16;

      // Role preference
      if (wantsInput && (role === 'textbox' || role === 'searchbox' || el.tag === 'INPUT' || el.tag === 'TEXTAREA')) {
        score += 6;
      }
      if (wantsButton && (role === 'button' || el.tag === 'BUTTON')) {
        score += 5;
      }
      if (wantsLink && (role === 'link' || el.tag === 'A')) {
        score += 4;
      }

      // Prefer short actionable labels over huge text blobs — except under a
      // content intent, where richer text (a full product card) is the more
      // specific target and short labels are usually tiles or chrome.
      if (contentIntent ? text.length > 30 : text.length > 0 && text.length <= 40) score += 2;
      if (text.length > 80) score -= 4;

      // Soft-penalize ubiquitous chrome unless explicitly requested
      if ((NAV_CHROME.includes(text) || NAV_CHROME.includes(aria)) &&
          !words.some(w => matched.has(w))) {
        score -= 6;
      }

      // Content intent: prefer the page body over site chrome and tiny labels
      if (contentIntent) {
        if (el.zone === 'header') score -= 7;
        else if (el.zone === 'footer') score -= 4;
        else if (el.zone === 'main' && matched.size > 0) score += 3;
        if (text.length > 0 && text.length <= 12) score -= 4;
      }

      // Exclusions from "not X" / "except X" phrasing — an element whose entire
      // label is the excluded word ("Shoes" nav link) is punished hard, while a
      // longer text merely containing it loses little.
      for (const x of excludeWords) {
        if (text === x || aria === x) {
          score -= 12;
          continue;
        }
        if (!phraseIn(combined, x)) continue;
        score -= text.length > 0 && text.length <= 20 ? 8 : 3;
      }

      return { el, score, distinctMatched };
    });

    // Relative specificity premium: element(s) covering the most distinctive
    // description tokens win, so a card matching "adizero" beats a nav link
    // that merely matches "shoes".
    const maxDistinct = Math.max(0, ...scored.map(s => s.distinctMatched));
    if (maxDistinct >= 1 && distinctive.length > 0) {
      for (const s of scored) {
        if (s.distinctMatched === maxDistinct) s.score += 6;
        if (s.distinctMatched === distinctive.length) s.score += 10;
      }

      // Query-echo penalty: under a content intent, an element whose entire
      // label merely echoes the query or a collection tile ("Running Shoes"
      // title, "Best Running Shoes") is usually not the requested item when a
      // more specific sibling (a product card with richer text) matches the
      // same tokens.
      if (contentIntent) {
        const norm = (t: string | null) => (t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
        const topTier = scored.filter(s => s.distinctMatched === maxDistinct);
        const longestTopText = Math.max(...topTier.map(s => norm(s.el.text).length));
        const descWords = new Set(words);
        for (const s of topTier) {
          const t = norm(s.el.text);
          const tWords = t.split(' ').filter(w => w.length > 2);
          const isEcho = t.length >= 3
            && t.length < longestTopText
            && tWords.length <= 3
            && tWords.every(w => descWords.has(w) || ECHO_FILLER.has(w));
          if (isEcho) s.score -= 8;
        }
      }
    }

    let best = scored[0]!;
    for (const s of scored) {
      if (s.score > best.score) best = s;
    }
    const bestEl = best.el;
    const bestScore = best.score;

    // Map score → capped confidence (never pretend to be Jev-turbo 0.96)
    let confidence: number;
    if (bestScore >= 22) confidence = 0.84;      // strong exact/phrase
    else if (bestScore >= 14) confidence = 0.78; // solid multi-token
    else if (bestScore >= 8) confidence = 0.68;  // weak — usually below threshold
    else confidence = 0.45;                      // guess — will not auto-click

    const label = bestEl.text ?? bestEl.ariaLabel ?? bestEl.placeholder ?? bestEl.role;
    logger.info('Heuristic selected element', {
      id: bestEl.id,
      label,
      score: bestScore,
      confidence,
    });

    return {
      target_id: {
        choice: bestEl.id,
        confidence,
      },
      reasoning: `heuristic score=${bestScore} selected [${bestEl.id}] "${label}" for "${targetDescription}"`,
      latency_ms: 5,
      source: 'heuristic',
    };
  }
}

// ─── Heuristic helpers ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'onto',
  'a', 'an', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'is', 'be',
  'main', 'page', 'element', 'please', 'click', 'find', 'select',
]);

/** Structural words the user mentions that rarely identify a target by themselves. */
const MODIFIER_WORDS = new Set([
  'product', 'item', 'card', 'link', 'button', 'category', 'tab', 'section',
  'input', 'field', 'box', 'bar', 'open', 'view', 'see', 'show', 'try', 'use',
  'first', 'second', 'third', 'top', 'bottom', 'left', 'right', 'new',
]);

const NEGATION_WORDS = new Set(['not', 'except', 'without', 'excluding', 'exclude', 'avoid', 'skip', 'instead']);

/** After a negation word, keep negating through these structural connectors ("not the nav shoes"). */
const NEGATION_GLUE = new Set(['nav', 'navbar', 'header', 'menu', 'footer', 'the', 'a', 'an', 'and']);

/** Descriptions with these words are looking for page content, not site chrome. */
const CONTENT_INTENT_RE =
  /\b(product|item|card|listing|grid|result|detail|details|buy|order|article|post)\b/;

const NAV_CHROME = [
  'home', 'cart', 'log in', 'login', 'sign up', 'signup', 'contact',
  'about us', 'about', 'previous', 'next', 'menu', 'close', 'search',
];

/** Generic collection-tile words that don't make a label a specific item. */
const ECHO_FILLER = new Set([
  'best', 'top', 'new', 'all', 'men', 'mens', 'women', 'womens',
  'kids', 'sale', 'shop', 'buy', 'more', 'view',
]);

/** Whole-word/phrase containment: "shoes" matches "running shoes" but not "shoestring". */
function phraseIn(haystack: string, needle: string): boolean {
  const esc = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!esc) return false;
  const pattern = `(^|[^a-z0-9])${esc.split(/\s+/).join('\\s+')}([^a-z0-9]|$)`;
  return new RegExp(pattern, 'i').test(haystack);
}

interface ParsedTarget { include: string[]; exclude: string[]; }

/** Tokenise a target description, honouring "not X" / "except X" exclusions. */
function parseTargetWords(desc: string): ParsedTarget {
  const tokens = desc.split(/[^a-z0-9]+/).filter(Boolean);
  const rawInclude: string[] = [];
  const rawExclude: string[] = [];
  let negating = false;
  for (const t of tokens) {
    if (NEGATION_WORDS.has(t)) {
      negating = true;
      continue;
    }
    if (negating) {
      rawExclude.push(t);
      if (!NEGATION_GLUE.has(t)) negating = false;
      continue;
    }
    rawInclude.push(t);
  }
  const clean = (arr: string[]) =>
    [...new Set(arr.filter(w => w.length > 2 && !STOP_WORDS.has(w)))];
  const exclude = clean(rawExclude);
  const excludeSet = new Set(exclude);
  const include = clean(rawInclude).filter(w => !excludeSet.has(w));
  return { include, exclude };
}
