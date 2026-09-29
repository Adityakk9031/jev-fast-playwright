/**
 * browserManager.ts
 *
 * Manages a single, persistent Playwright browser + page instance that is
 * shared across all MCP tool calls in a session.
 *
 * Modes (JEV_BROWSER_MODE):
 *   attach — only connectOverCDP to a user-opened browser (visible on desktop)
 *   launch — launch a new browser (may be invisible if spawned by a service)
 *   auto   — try CDP attach first, then launch (default for local CLI/tests)
 *
 * Antigravity MCP defaults to mode=launch (opens Chrome with a dedicated profile).
 * Use mode=attach only when you already opened a browser with --remote-debugging-port.
 */

import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import { logger } from './utils/logger';

export type SupportedBrowserType = 'chromium' | 'firefox' | 'webkit';
export type BrowserMode = 'attach' | 'launch' | 'auto';
export type BrowserChannel = 'chrome' | 'msedge' | 'chromium';

export interface BrowserManagerConfig {
  browserType?: SupportedBrowserType;
  headless?: boolean;
  launchTimeoutMs?: number;
  actionTimeoutMs?: number;
  /** attach | launch | auto */
  mode?: BrowserMode;
  /** chrome | msedge | chromium (bundled) */
  channel?: BrowserChannel;
  /** CDP HTTP endpoint, e.g. http://127.0.0.1:9222 */
  cdpUrl?: string;
  /** Path for launchPersistentContext (Chrome/Edge profile). */
  userDataDir?: string;
}

export interface BrowserStatus {
  ready: boolean;
  mode: BrowserMode;
  connection: 'cdp' | 'launched' | 'none';
  channel: BrowserChannel;
  cdpUrl: string;
  cdpReachable: boolean;
  url: string | null;
  title: string | null;
  headless: boolean;
  pageCount: number;
  userDataDir: string;
}

export class BrowserManager {
  private static instance: BrowserManager | null = null;

  private browser:  Browser        | null = null;
  private context:  BrowserContext | null = null;
  private page:     Page           | null = null;
  private connection: 'cdp' | 'launched' | 'none' = 'none';
  private readonly config: Required<BrowserManagerConfig>;

  private initPromise: Promise<void> | null = null;

  private constructor(config: BrowserManagerConfig = {}) {
    const channelEnv = (process.env['PLAYWRIGHT_CHANNEL'] ?? '').toLowerCase();
    const channel: BrowserChannel =
      config.channel ??
      (channelEnv === 'msedge' || channelEnv === 'edge' ? 'msedge' :
       channelEnv === 'chrome' ? 'chrome' : 'chromium');

    const modeEnv = (process.env['JEV_BROWSER_MODE'] ?? '').toLowerCase();
    const mode: BrowserMode =
      config.mode ??
      (modeEnv === 'attach' || modeEnv === 'launch' || modeEnv === 'auto'
        ? modeEnv
        : 'auto');

    this.config = {
      browserType:     (config.browserType    ?? 'chromium') as SupportedBrowserType,
      headless:        config.headless        ?? true,
      launchTimeoutMs: config.launchTimeoutMs ?? 30_000,
      actionTimeoutMs: config.actionTimeoutMs ?? 10_000,
      mode,
      channel,
      cdpUrl:          config.cdpUrl ?? process.env['JEV_CDP_URL'] ?? 'http://127.0.0.1:9222',
      userDataDir:     config.userDataDir ?? process.env['JEV_USER_DATA_DIR'] ?? 'C:\\ChromeDebugJev',
    };
  }

  /** Returns the process-wide singleton. */
  static getInstance(config?: BrowserManagerConfig): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager(config);
    }
    return BrowserManager.instance;
  }

  /** Test helper — clears the singleton (does not close an attached browser). */
  static resetInstance(): void {
    BrowserManager.instance = null;
  }

  /** Probe whether CDP is listening. */
  async isCdpReachable(): Promise<boolean> {
    try {
      const versionUrl = this.config.cdpUrl.replace(/\/$/, '') + '/json/version';
      const resp = await fetch(versionUrl, { signal: AbortSignal.timeout(1500) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Snapshot for jev_browser_status. */
  async getStatus(): Promise<BrowserStatus> {
    const cdpReachable = await this.isCdpReachable();
    let url: string | null = null;
    let title: string | null = null;
    let pageCount = 0;

    if (this.context) {
      const pages = this.context.pages().filter(p => !p.isClosed());
      pageCount = pages.length;
      if (this.page && !this.page.isClosed()) {
        url = this.page.url();
        try { title = await this.page.title(); } catch { title = null; }
      }
    }

    return {
      ready: this.isReady,
      mode: this.config.mode,
      connection: this.connection,
      channel: this.config.channel,
      cdpUrl: this.config.cdpUrl,
      cdpReachable,
      url,
      title,
      headless: this.config.headless,
      pageCount,
      userDataDir: this.config.userDataDir,
    };
  }

  /** Launch / attach browser if not already running. Idempotent. */
  async init(): Promise<void> {
    if (this.browser?.isConnected() && this.page && !this.page.isClosed()) {
      logger.debug('BrowserManager.init: browser already connected — skipping');
      return;
    }

    if (this.initPromise) {
      logger.debug('BrowserManager.init: initialization already in progress — awaiting');
      return this.initPromise;
    }

    this.initPromise = this._doInit().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    if (this.browser?.isConnected() && this.page && !this.page.isClosed()) {
      return;
    }

    const mode = this.config.mode;
    logger.info('BrowserManager: initializing', {
      mode,
      channel: this.config.channel,
      headless: this.config.headless,
      cdpUrl: this.config.cdpUrl,
    });

    if (mode === 'attach' || mode === 'auto') {
      const attached = await this._tryAttachCdp();
      if (attached) return;

      if (mode === 'attach') {
        throw new Error(
          `CDP attach failed — nothing listening at ${this.config.cdpUrl}. ` +
          `Open a visible browser first:\n` +
          `  1. Run d:\\jev_bridge\\launch_edge.bat\n` +
          `  2. Confirm http://127.0.0.1:9222/json/version returns JSON\n` +
          `  3. Retry the tool call\n` +
          `Tip: Edge REQUIRES --user-data-dir (fresh folder) or the debug port is ignored.`,
        );
      }
      logger.info('BrowserManager: CDP not available — falling back to launch');
    }

    await this._launchBrowser();
  }

  private async _tryAttachCdp(): Promise<boolean> {
    if (this.config.browserType !== 'chromium') {
      return false;
    }

    try {
      const versionUrl = this.config.cdpUrl.replace(/\/$/, '') + '/json/version';
      const cdpCheck = await fetch(versionUrl, { signal: AbortSignal.timeout(1500) });
      if (!cdpCheck.ok) return false;

      const versionInfo = await cdpCheck.json() as { Browser?: string; webSocketDebuggerUrl?: string };
      logger.info('BrowserManager: CDP version', {
        browser: versionInfo.Browser,
        ws: versionInfo.webSocketDebuggerUrl,
      });

      // Prefer the WebSocket endpoint when available — more reliable than HTTP base URL.
      const endpoint = versionInfo.webSocketDebuggerUrl || this.config.cdpUrl;

      logger.info('BrowserManager: connecting over CDP', { endpoint });
      this.browser = await chromium.connectOverCDP(endpoint, {
        timeout: this.config.launchTimeoutMs,
      });

      const contexts = this.browser.contexts();
      this.context = contexts[0] ?? await this.browser.newContext({ viewport: null });

      let pages = this.context.pages().filter(p => !p.isClosed());
      // Prefer a real page over about:blank if multiple tabs exist.
      const nonBlank = pages.find(p => {
        const u = p.url();
        return u && u !== 'about:blank' && !u.startsWith('chrome://') && !u.startsWith('edge://');
      });
      this.page = nonBlank ?? (pages.length > 0 ? pages[0]! : await this.context.newPage());

      // Bring the controlled page to front so the user sees the same tab we act on.
      await this.page.bringToFront().catch(() => {});

      this.context.setDefaultTimeout(this.config.actionTimeoutMs);
      this._wireDialogHandler(this.page);
      this.connection = 'cdp';

      pages = this.context.pages().filter(p => !p.isClosed());
      logger.info('BrowserManager: CDP attached', {
        url: this.page.url(),
        pages: pages.length,
        browser: versionInfo.Browser,
      });
      return true;
    } catch (err) {
      logger.warn('BrowserManager: CDP attach failed', { err: String(err) });
      this.browser = null;
      this.context = null;
      this.page = null;
      this.connection = 'none';
      return false;
    }
  }

  private async _launchBrowser(): Promise<void> {
    const launchArgs = [
      '--start-maximized',
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
    ];

    // Chromium family: persistent profile so Chrome opens as a real visible window.
    if (this.config.browserType === 'chromium') {
      const fs = await import('fs');
      if (!fs.existsSync(this.config.userDataDir)) {
        fs.mkdirSync(this.config.userDataDir, { recursive: true });
      }

      const channelOpt =
        this.config.channel !== 'chromium' ? this.config.channel : undefined;

      try {
        this.context = await chromium.launchPersistentContext(this.config.userDataDir, {
          headless: this.config.headless,
          channel: channelOpt,
          args: launchArgs,
          viewport: null,
          timeout: this.config.launchTimeoutMs,
        });
        logger.info('BrowserManager: launched persistent Chrome/Edge', {
          channel: channelOpt ?? 'bundled',
          userDataDir: this.config.userDataDir,
          headless: this.config.headless,
        });
      } catch (err) {
        const msg = String(err);
        logger.warn('BrowserManager: persistent launch failed — falling back to ephemeral launch', {
          channel: channelOpt,
          err: msg.slice(0, 200),
        });
        // Profile locked or channel missing → ephemeral launch (still visible when headless=false)
        try {
          this.browser = await chromium.launch({
            headless: this.config.headless,
            channel: channelOpt,
            args: launchArgs,
            timeout: this.config.launchTimeoutMs,
          });
        } catch (err2) {
          this.browser = await chromium.launch({
            headless: this.config.headless,
            args: launchArgs,
            timeout: this.config.launchTimeoutMs,
          });
        }
        this.context = await this.browser.newContext({ viewport: null, javaScriptEnabled: true });
        this.context.setDefaultTimeout(this.config.actionTimeoutMs);
        this.page = await this.context.newPage();
        this._wireDialogHandler(this.page);
        this.connection = 'launched';
        await this.page.bringToFront().catch(() => {});
        logger.info('BrowserManager: browser ready (ephemeral launch)', { url: this.page.url() });
        return;
      }

      this.browser = this.context.browser();
      const pages = this.context.pages().filter(p => !p.isClosed());
      this.page = pages.length > 0 ? pages[0]! : await this.context.newPage();
      this.context.setDefaultTimeout(this.config.actionTimeoutMs);
      this._wireDialogHandler(this.page);
      this.connection = 'launched';
      await this.page.bringToFront().catch(() => {});
      logger.info('BrowserManager: browser ready (launched)', {
        url: this.page.url(),
        headless: this.config.headless,
      });
      return;
    }

    const launcher =
      this.config.browserType === 'firefox' ? firefox : webkit;

    this.browser = await launcher.launch({
      headless: this.config.headless,
      args: launchArgs,
      timeout: this.config.launchTimeoutMs,
    });
    this.context = await this.browser.newContext({ viewport: null, javaScriptEnabled: true });
    this.context.setDefaultTimeout(this.config.actionTimeoutMs);
    this.page = await this.context.newPage();
    this._wireDialogHandler(this.page);
    this.connection = 'launched';
    logger.info('BrowserManager: browser ready (launched non-chromium)');
  }

  private _wireDialogHandler(page: Page): void {
    page.removeAllListeners('dialog');
    page.on('dialog', async dialog => {
      logger.info('Auto-accepting dialog', { message: dialog.message() });
      await dialog.accept().catch(() => {});
    });
  }

  /**
   * Returns the shared page, launching/attaching first if needed.
   * Recreates the page if it has been closed externally.
   */
  async getPage(): Promise<Page> {
    if (!this.browser?.isConnected() || !this.context || !this.page || this.page.isClosed()) {
      await this.init();
    }

    // Prefer a non-blank page if one exists (CDP often has multiple tabs)
    if (this.context && this.page) {
      const pages = this.context.pages().filter(p => !p.isClosed());
      const active = pages.find(p => {
        const u = p.url();
        return u && u !== 'about:blank';
      });
      if (active && active !== this.page) {
        this.page = active;
        this._wireDialogHandler(this.page);
      } else if (this.page.isClosed() && pages.length > 0) {
        this.page = pages[0]!;
        this._wireDialogHandler(this.page);
      }
    }

    return this.page!;
  }

  /**
   * Navigate the shared page to a URL.
   * Returns the Page for convenience.
   */
  async navigateTo(url: string): Promise<Page> {
    const page = await this.getPage();
    logger.info('BrowserManager: navigating', { url });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.launchTimeoutMs });
    await page.waitForTimeout(1500);
    return page;
  }

  /**
   * Gracefully release the browser.
   * CDP attach: disconnect references only — do NOT close the user's Edge window.
   * Launched: close the browser process.
   */
  async shutdown(): Promise<void> {
    if (!this.browser && !this.context) return;
    logger.info('BrowserManager: shutting down', { connection: this.connection });
    try {
      if (this.connection === 'launched') {
        // Persistent context: close context (closes the browser).
        if (this.context) {
          await this.context.close();
        } else if (this.browser) {
          await this.browser.close();
        }
      }
      // CDP attach: leave the user's browser open.
    } catch (err) {
      logger.warn('BrowserManager: error during shutdown', { err: String(err) });
    } finally {
      this.browser  = null;
      this.context  = null;
      this.page     = null;
      this.connection = 'none';
    }
  }

  /** True if the browser is connected and the page is open. */
  get isReady(): boolean {
    return !!(this.browser?.isConnected() && this.page && !this.page.isClosed());
  }

  get mode(): BrowserMode {
    return this.config.mode;
  }

  get connectionType(): 'cdp' | 'launched' | 'none' {
    return this.connection;
  }
}
