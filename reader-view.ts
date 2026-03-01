import { TextFileView, WorkspaceLeaf, TFile, Menu } from "obsidian";
import ePub, { Book, Rendition, NavItem } from "epubjs";
import type EpubPlusPlusPlugin from "./main";
import { HighlightStore, Highlight } from "./highlight-store";
import { NoteGenerator } from "./note-generator";

export const VIEW_TYPE_EPUB = "epub-plus-plus-view";

type ReaderState = "idle" | "loading" | "reading" | "error";

export class EpubReaderView extends TextFileView {
  private plugin: EpubPlusPlusPlugin;
  private store: HighlightStore;
  private noteGen: NoteGenerator;

  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private readerState: ReaderState = "idle";
  private uiBuilt = false;

  // DOM elements
  private headerEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private viewerEl!: HTMLElement;
  private progressBarEl!: HTMLElement;
  private progressFillEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private tocEl!: HTMLElement;
  private tocListEl!: HTMLElement;
  private highlightPopupEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private highlightPanelEl!: HTMLElement;
  private highlightListEl!: HTMLElement;

  private tocVisible = false;
  private highlightPanelVisible = false;
  private currentChapter = "";
  private totalLocations = 0;

  constructor(leaf: WorkspaceLeaf, plugin: EpubPlusPlusPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.store = new HighlightStore(this.app);
    this.noteGen = new NoteGenerator(this.app);
  }

  getViewType(): string {
    return VIEW_TYPE_EPUB;
  }

  getDisplayText(): string {
    return this.file?.basename || "EPUB++";
  }

  getIcon(): string {
    return "book-open";
  }

  // ─── TextFileView required stubs (EPUB is binary) ──
  // CRITICAL: EPUB is binary. TextFileView's save() calls getViewData()
  // and writes it back to file. We MUST block this or it overwrites
  // the EPUB with an empty string → data loss.

  getViewData(): string {
    return "";
  }

  setViewData(data: string, clear: boolean): void {
    if (clear) {
      this.cleanup();
    }
    if (this.file) {
      this.loadEpub(this.file);
    }
  }

  clear(): void {
    this.cleanup();
  }

  /** Block save — never overwrite binary EPUB via text pipeline */
  async save(): Promise<void> {
    // no-op: prevent TextFileView from writing "" to the EPUB file
  }

  /** Block debounced save requests */
  requestSave(): void {
    // no-op
  }

  // ─── EPUB Loading ──────────────────────────────

  private async loadEpub(file: TFile): Promise<void> {
    if (!this.uiBuilt) {
      this.buildUI();
      this.uiBuilt = true;
    }

    this.cleanup();
    this.setReaderState("loading");

    try {
      const buf = await this.app.vault.readBinary(file);
      this.book = ePub(buf as any);

      await this.book.ready;

      // Extract metadata
      const meta = this.book.packaging?.metadata;
      if (meta) {
        await this.store.setBookMeta(
          file.path,
          meta.title || file.basename,
          meta.creator || "",
          meta.identifier || ""
        );
      }

      this.titleEl.setText(meta?.title || file.basename);

      // Render
      this.viewerEl.empty();
      this.rendition = this.book.renderTo(this.viewerEl, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
      });

      // Theme: inject dark mode styles
      this.applyTheme();

      // Generate locations for progress tracking
      await this.book.locations.generate(1600);
      this.totalLocations = this.book.locations.length();

      // Load saved position or start from beginning
      const bookData = await this.store.load(file.path);
      if (bookData.lastPosition) {
        await this.rendition.display(bookData.lastPosition);
      } else {
        await this.rendition.display();
      }

      // Restore saved highlights
      await this.restoreHighlights(bookData.highlights);

      // Event: text selection → highlight popup
      this.rendition.on("selected", this.onTextSelected.bind(this));

      // Event: page turn → update progress
      this.rendition.on("relocated", this.onRelocated.bind(this));

      // Build TOC
      const nav = await this.book.loaded.navigation;
      this.buildTOC(nav.toc);

      this.setReaderState("reading");
    } catch (err) {
      console.error("EPUB++ load error:", err);
      this.setReaderState("error");
      this.statusEl.setText(`Error: ${err}`);
    }
  }

  // ─── UI Construction ───────────────────────────

  private buildUI(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("epp-container");

    // Header: nav + title + progress
    this.headerEl = container.createDiv({ cls: "epp-header" });

    const navLeft = this.headerEl.createEl("button", {
      text: "◀",
      cls: "epp-nav-btn",
    });
    navLeft.addEventListener("click", () => this.prevPage());

    this.titleEl = this.headerEl.createDiv({ cls: "epp-title" });
    this.titleEl.setText("EPUB++");

    this.progressEl = this.headerEl.createDiv({ cls: "epp-progress-text" });

    const navRight = this.headerEl.createEl("button", {
      text: "▶",
      cls: "epp-nav-btn",
    });
    navRight.addEventListener("click", () => this.nextPage());

    // Viewer
    this.viewerEl = container.createDiv({ cls: "epp-viewer" });

    // Progress bar
    this.progressBarEl = container.createDiv({ cls: "epp-progress-bar" });
    this.progressFillEl = this.progressBarEl.createDiv({
      cls: "epp-progress-fill",
    });

    // Footer: action buttons
    this.footerEl = container.createDiv({ cls: "epp-footer" });

    const btnNote = this.footerEl.createEl("button", {
      text: "📝 노트 생성",
      cls: "epp-btn epp-btn-primary",
    });
    btnNote.addEventListener("click", () => this.generateNote());

    const btnHL = this.footerEl.createEl("button", {
      text: "📋 하이라이트",
      cls: "epp-btn",
    });
    btnHL.addEventListener("click", () => this.toggleHighlightPanel());

    const btnTOC = this.footerEl.createEl("button", {
      text: "📚 목차",
      cls: "epp-btn",
    });
    btnTOC.addEventListener("click", () => this.toggleTOC());

    // TOC sidebar (hidden)
    this.tocEl = container.createDiv({ cls: "epp-toc epp-hidden" });
    const tocHeader = this.tocEl.createDiv({ cls: "epp-toc-header" });
    tocHeader.createEl("span", { text: "📚 목차" });
    const tocClose = tocHeader.createEl("button", {
      text: "✕",
      cls: "epp-close-btn",
    });
    tocClose.addEventListener("click", () => this.toggleTOC());
    this.tocListEl = this.tocEl.createDiv({ cls: "epp-toc-list" });

    // Highlight panel (hidden)
    this.highlightPanelEl = container.createDiv({
      cls: "epp-highlight-panel epp-hidden",
    });
    const hlHeader = this.highlightPanelEl.createDiv({
      cls: "epp-toc-header",
    });
    hlHeader.createEl("span", { text: "📋 하이라이트" });
    const hlClose = hlHeader.createEl("button", {
      text: "✕",
      cls: "epp-close-btn",
    });
    hlClose.addEventListener("click", () => this.toggleHighlightPanel());
    this.highlightListEl = this.highlightPanelEl.createDiv({
      cls: "epp-highlight-list",
    });

    // Highlight color popup (hidden, absolute positioned)
    this.highlightPopupEl = container.createDiv({
      cls: "epp-hl-popup epp-hidden",
    });

    // Status
    this.statusEl = container.createDiv({ cls: "epp-status" });
  }

  // ─── Theme ─────────────────────────────────────

  private applyTheme(): void {
    if (!this.rendition) return;
    const isDark = document.body.classList.contains("theme-dark");

    this.rendition.themes.default({
      body: {
        color: isDark ? "#dcddde" : "#1e1e1e",
        background: isDark ? "#1e1e1e" : "#ffffff",
        "font-family": "var(--font-text)",
        "line-height": "1.6",
        padding: "20px !important",
      },
      "a:link": {
        color: isDark ? "#7f6df2" : "#4a6cf7",
      },
    });
  }

  // ─── Navigation ────────────────────────────────

  private async prevPage(): Promise<void> {
    if (this.rendition) await this.rendition.prev();
  }

  private async nextPage(): Promise<void> {
    if (this.rendition) await this.rendition.next();
  }

  private async goToChapter(href: string): Promise<void> {
    if (this.rendition) {
      await this.rendition.display(href);
      this.tocVisible = true;
      this.toggleTOC(); // close after nav
    }
  }

  // ─── Events ────────────────────────────────────

  private onTextSelected(cfiRange: string, contents: any): void {
    if (!this.book || !this.rendition || !this.file) return;

    this.book.getRange(cfiRange).then((range: Range) => {
      const text = range.toString().trim();
      if (!text || text.length < 2) return;
      this.showHighlightPopup(cfiRange, text, contents);
    });
  }

  private onRelocated(location: any): void {
    if (!this.file || !this.book) return;

    const current = location.start;
    const cfi = current.cfi;

    // Update chapter title
    if (current.href && this.book.navigation) {
      const navItem = this.findNavItem(
        this.book.navigation.toc,
        current.href
      );
      if (navItem) {
        this.currentChapter = navItem.label.trim();
      }
    }

    // Calculate progress
    let progress = 0;
    if (this.book.locations && current.location !== undefined) {
      progress = current.location / this.totalLocations;
    }

    const pct = Math.round(progress * 100);
    this.progressEl.setText(`${pct}%`);
    this.progressFillEl.style.width = `${pct}%`;

    // Save position
    this.store.updatePosition(
      this.file.path,
      cfi,
      progress,
      this.totalLocations
    );
  }

  private findNavItem(toc: NavItem[], href: string): NavItem | null {
    for (const item of toc) {
      if (item.href && href.includes(item.href.split("#")[0])) return item;
      if (item.subitems) {
        const found = this.findNavItem(item.subitems, href);
        if (found) return found;
      }
    }
    return null;
  }

  // ─── Highlight Popup ──────────────────────────

  private showHighlightPopup(
    cfiRange: string,
    text: string,
    contents: any
  ): void {
    this.highlightPopupEl.empty();
    this.highlightPopupEl.removeClass("epp-hidden");

    const colors = this.plugin.settings.highlightColors;

    for (const c of colors) {
      const btn = this.highlightPopupEl.createEl("button", {
        cls: "epp-color-btn",
      });
      btn.style.backgroundColor = c.value;
      btn.setAttribute("title", c.label);
      btn.addEventListener("click", async () => {
        await this.addHighlight(cfiRange, text, c.name);
        this.hideHighlightPopup();
        if (contents?.window?.getSelection) {
          contents.window.getSelection()?.removeAllRanges();
        }
      });
    }

    const deleteBtn = this.highlightPopupEl.createEl("button", {
      text: "🗑️",
      cls: "epp-color-btn epp-delete-btn",
    });
    deleteBtn.addEventListener("click", () => {
      this.removeHighlightByCfi(cfiRange);
      this.hideHighlightPopup();
      if (contents?.window?.getSelection) {
        contents.window.getSelection()?.removeAllRanges();
      }
    });

    this.highlightPopupEl.style.top = "8px";
    this.highlightPopupEl.style.left = "50%";
    this.highlightPopupEl.style.transform = "translateX(-50%)";
  }

  private hideHighlightPopup(): void {
    this.highlightPopupEl.addClass("epp-hidden");
  }

  // ─── Highlight CRUD ────────────────────────────

  private async addHighlight(
    cfi: string,
    text: string,
    colorName: string
  ): Promise<void> {
    if (!this.file || !this.rendition) return;

    const color = this.plugin.settings.highlightColors.find(
      (c) => c.name === colorName
    );
    const fillColor = color?.value || "#ffff00";

    this.rendition.annotations.highlight(
      cfi,
      { color: colorName },
      (e: MouseEvent) => {
        e.stopPropagation();
      },
      "epp-highlight",
      {
        fill: fillColor,
        "fill-opacity": "0.3",
        "mix-blend-mode": "multiply",
      }
    );

    await this.store.addHighlight(
      this.file.path,
      cfi,
      text,
      colorName,
      this.currentChapter
    );

    if (this.highlightPanelVisible) {
      await this.refreshHighlightPanel();
    }
  }

  private async removeHighlightByCfi(cfi: string): Promise<void> {
    if (!this.file || !this.rendition) return;

    const data = await this.store.load(this.file.path);
    const hl = data.highlights.find((h) => h.cfi === cfi);
    if (hl) {
      this.rendition.annotations.remove(cfi, "highlight");
      await this.store.removeHighlight(this.file.path, hl.id);
      if (this.highlightPanelVisible) {
        await this.refreshHighlightPanel();
      }
    }
  }

  private async restoreHighlights(highlights: Highlight[]): Promise<void> {
    if (!this.rendition) return;

    for (const hl of highlights) {
      const color = this.plugin.settings.highlightColors.find(
        (c) => c.name === hl.color
      );
      const fillColor = color?.value || "#ffff00";

      try {
        this.rendition.annotations.highlight(
          hl.cfi,
          { color: hl.color },
          undefined,
          "epp-highlight",
          {
            fill: fillColor,
            "fill-opacity": "0.3",
            "mix-blend-mode": "multiply",
          }
        );
      } catch {
        // CFI might be invalid if book structure changed
      }
    }
  }

  // ─── TOC ───────────────────────────────────────

  private toggleTOC(): void {
    this.tocVisible = !this.tocVisible;
    if (this.tocVisible) {
      this.tocEl.removeClass("epp-hidden");
      this.highlightPanelEl.addClass("epp-hidden");
      this.highlightPanelVisible = false;
    } else {
      this.tocEl.addClass("epp-hidden");
    }
  }

  private buildTOC(toc: NavItem[]): void {
    this.tocListEl.empty();
    this.buildTOCItems(toc, this.tocListEl, 0);
  }

  private buildTOCItems(
    items: NavItem[],
    parent: HTMLElement,
    depth: number
  ): void {
    for (const item of items) {
      const el = parent.createDiv({ cls: "epp-toc-item" });
      el.style.paddingLeft = `${depth * 16}px`;
      el.setText(item.label.trim());
      el.addEventListener("click", () => this.goToChapter(item.href));

      if (item.subitems && item.subitems.length > 0) {
        this.buildTOCItems(item.subitems, parent, depth + 1);
      }
    }
  }

  // ─── Highlight Panel ──────────────────────────

  private toggleHighlightPanel(): void {
    this.highlightPanelVisible = !this.highlightPanelVisible;
    if (this.highlightPanelVisible) {
      this.highlightPanelEl.removeClass("epp-hidden");
      this.tocEl.addClass("epp-hidden");
      this.tocVisible = false;
      this.refreshHighlightPanel();
    } else {
      this.highlightPanelEl.addClass("epp-hidden");
    }
  }

  private async refreshHighlightPanel(): Promise<void> {
    if (!this.file) return;
    this.highlightListEl.empty();

    const data = await this.store.load(this.file.path);

    if (data.highlights.length === 0) {
      this.highlightListEl.createDiv({
        text: "아직 하이라이트가 없습니다",
        cls: "epp-hl-empty",
      });
      return;
    }

    const grouped = new Map<string, Highlight[]>();
    for (const hl of data.highlights) {
      const ch = hl.chapter || "미분류";
      if (!grouped.has(ch)) grouped.set(ch, []);
      grouped.get(ch)!.push(hl);
    }

    for (const [chapter, hls] of grouped) {
      this.highlightListEl.createDiv({
        text: chapter,
        cls: "epp-hl-chapter",
      });

      for (const hl of hls) {
        const color = this.plugin.settings.highlightColors.find(
          (c) => c.name === hl.color
        );

        const item = this.highlightListEl.createDiv({ cls: "epp-hl-item" });
        item.style.borderLeft = `3px solid ${color?.value || "#ffff00"}`;

        const textEl = item.createDiv({ cls: "epp-hl-text" });
        textEl.setText(
          hl.text.length > 80 ? hl.text.slice(0, 80) + "…" : hl.text
        );

        if (hl.note) {
          item.createDiv({ cls: "epp-hl-note", text: `💭 ${hl.note}` });
        }

        item.addEventListener("click", () => {
          if (this.rendition) this.rendition.display(hl.cfi);
        });

        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const menu = new Menu();
          menu.addItem((i) =>
            i
              .setTitle("메모 추가/편집")
              .setIcon("pencil")
              .onClick(() => this.editHighlightNote(hl))
          );
          menu.addItem((i) =>
            i
              .setTitle("삭제")
              .setIcon("trash-2")
              .onClick(async () => {
                await this.store.removeHighlight(this.file!.path, hl.id);
                if (this.rendition) {
                  this.rendition.annotations.remove(hl.cfi, "highlight");
                }
                await this.refreshHighlightPanel();
              })
          );
          menu.showAtMouseEvent(e);
        });
      }
    }
  }

  private editHighlightNote(hl: Highlight): void {
    if (!this.file) return;
    const modal = document.createElement("div");
    modal.className = "epp-note-modal";

    const textarea = document.createElement("textarea");
    textarea.className = "epp-note-input";
    textarea.value = hl.note || "";
    textarea.placeholder = "메모를 입력하세요...";

    const btnRow = document.createElement("div");
    btnRow.className = "epp-note-btn-row";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "저장";
    saveBtn.className = "epp-btn epp-btn-primary";
    saveBtn.addEventListener("click", async () => {
      await this.store.updateHighlightNote(
        this.file!.path,
        hl.id,
        textarea.value
      );
      modal.remove();
      if (this.highlightPanelVisible) await this.refreshHighlightPanel();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "취소";
    cancelBtn.className = "epp-btn";
    cancelBtn.addEventListener("click", () => modal.remove());

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    modal.appendChild(textarea);
    modal.appendChild(btnRow);
    this.contentEl.appendChild(modal);
    textarea.focus();
  }

  // ─── Note Generation ──────────────────────────

  async generateNote(): Promise<void> {
    if (!this.file) return;

    const data = await this.store.load(this.file.path);
    if (data.highlights.length === 0) {
      this.statusEl.setText("하이라이트가 없습니다. 텍스트를 선택해 밑줄을 그어보세요.");
      setTimeout(() => this.statusEl.setText(""), 3000);
      return;
    }

    try {
      const settings = this.plugin.settings;
      const noteFile = await this.noteGen.generate(this.file.path, data, {
        savePath: settings.noteSavePath,
        groupByChapter: true,
        includeSourceLink: true,
        template: settings.noteTemplate,
      });

      this.statusEl.setText(`✅ 노트 생성 완료: ${noteFile.path}`);
      setTimeout(() => this.statusEl.setText(""), 5000);

      await this.app.workspace.getLeaf("tab").openFile(noteFile);
    } catch (err) {
      this.statusEl.setText(`❌ 노트 생성 실패: ${err}`);
    }
  }

  // ─── State ─────────────────────────────────────

  private setReaderState(s: ReaderState): void {
    this.readerState = s;
    switch (s) {
      case "idle":
        this.statusEl.setText("EPUB 파일을 열어주세요");
        break;
      case "loading":
        this.statusEl.setText("로딩 중...");
        break;
      case "reading":
        this.statusEl.setText("");
        break;
      case "error":
        break;
    }
  }

  // ─── Cleanup ───────────────────────────────────

  private cleanup(): void {
    if (this.rendition) {
      this.rendition.destroy();
      this.rendition = null;
    }
    if (this.book) {
      this.book.destroy();
      this.book = null;
    }
  }
}
