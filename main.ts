import { Plugin, PluginSettingTab, App, Setting, WorkspaceLeaf, TFile } from "obsidian";
import { EpubReaderView, VIEW_TYPE_EPUB } from "./reader-view";
import { isClaudeAvailable } from "./claude-bridge";

// ─── Settings ────────────────────────────────────

export interface HighlightColor {
  name: string;
  label: string;
  value: string; // hex
}

export interface EpubPlusPlusSettings {
  noteSavePath: string;
  noteTemplate: string;
  highlightColors: HighlightColor[];
  enableAI: boolean;
  questionColor: string;
  aiModel: string;
  aiTimeout: number;
}

const DEFAULT_COLORS: HighlightColor[] = [
  { name: "yellow", label: "핵심", value: "#fde047" },
  { name: "green", label: "동의", value: "#86efac" },
  { name: "blue", label: "질문", value: "#93c5fd" },
  { name: "purple", label: "연결", value: "#c4b5fd" },
];

const DEFAULT_SETTINGS: EpubPlusPlusSettings = {
  noteSavePath: "3_Resources/독서노트",
  noteTemplate: "SQ3R-독서노트",
  highlightColors: [...DEFAULT_COLORS],
  enableAI: true,
  questionColor: "blue",
  aiModel: "haiku",
  aiTimeout: 60000,
};

// ─── Plugin ──────────────────────────────────────

export default class EpubPlusPlusPlugin extends Plugin {
  settings!: EpubPlusPlusSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the EPUB reader view
    this.registerView(VIEW_TYPE_EPUB, (leaf) => new EpubReaderView(leaf, this));

    // Register .epub extension to open in our view
    this.registerExtensions(["epub"], VIEW_TYPE_EPUB);

    // Command: open EPUB file picker
    this.addCommand({
      id: "open-epub",
      name: "Open EPUB file",
      callback: () => this.openEpubPicker(),
    });

    // Command: generate note from current EPUB
    this.addCommand({
      id: "generate-note",
      name: "Generate reading note from highlights",
      checkCallback: (checking: boolean) => {
        const view = this.getActiveEpubView();
        if (!view) return false;
        if (!checking) {
          // Trigger note generation from the view
          (view as any).generateNote();
        }
        return true;
      },
    });

    // Ribbon icon
    this.addRibbonIcon("book-open", "EPUB++", () => this.openEpubPicker());

    // Settings tab
    this.addSettingTab(new EpubPlusPlusSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    // Views are cleaned up automatically by Obsidian
  }

  // ─── Helpers ───────────────────────────────────

  getActiveEpubView(): EpubReaderView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EPUB);
    if (leaves.length > 0) {
      return leaves[0].view as unknown as EpubReaderView;
    }
    return null;
  }

  private async openEpubPicker(): Promise<void> {
    // Find all .epub files in vault
    const epubFiles = this.app.vault
      .getFiles()
      .filter((f) => f.extension === "epub");

    if (epubFiles.length === 0) {
      // No epub files found
      return;
    }

    if (epubFiles.length === 1) {
      await this.openEpubFile(epubFiles[0]);
      return;
    }

    // Show a quick switcher-style list
    const { FuzzySuggestModal } = await import("obsidian");

    class EpubModal extends FuzzySuggestModal<TFile> {
      plugin: EpubPlusPlusPlugin;

      constructor(app: App, plugin: EpubPlusPlusPlugin) {
        super(app);
        this.plugin = plugin;
      }

      getItems(): TFile[] {
        return epubFiles;
      }

      getItemText(item: TFile): string {
        return item.path;
      }

      onChooseItem(item: TFile): void {
        this.plugin.openEpubFile(item);
      }
    }

    new EpubModal(this.app, this).open();
  }

  async openEpubFile(file: TFile): Promise<void> {
    // TextFileView handles file loading via setViewData lifecycle
    // Just open the file in a new tab — Obsidian routes to our registered view
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
  }

  // ─── Settings ──────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
    // Ensure colors array exists
    if (!this.settings.highlightColors?.length) {
      this.settings.highlightColors = [...DEFAULT_COLORS];
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

// ─── Settings Tab ────────────────────────────────

class EpubPlusPlusSettingTab extends PluginSettingTab {
  plugin: EpubPlusPlusPlugin;

  constructor(app: App, plugin: EpubPlusPlusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "EPUB++ Settings" });

    // Note save path
    new Setting(containerEl)
      .setName("노트 저장 경로")
      .setDesc("하이라이트 노트가 저장될 폴더 경로")
      .addText((text) =>
        text
          .setPlaceholder("3_Resources/독서노트")
          .setValue(this.plugin.settings.noteSavePath)
          .onChange(async (value) => {
            this.plugin.settings.noteSavePath = value;
            await this.plugin.saveSettings();
          })
      );

    // Note template
    new Setting(containerEl)
      .setName("노트 템플릿")
      .setDesc("프론트매터 template 필드에 사용될 템플릿 이름")
      .addText((text) =>
        text
          .setPlaceholder("SQ3R-독서노트")
          .setValue(this.plugin.settings.noteTemplate)
          .onChange(async (value) => {
            this.plugin.settings.noteTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    // Highlight colors
    containerEl.createEl("h3", { text: "하이라이트 색상" });
    containerEl.createEl("p", {
      text: "색상을 커스터마이즈하세요. 이름, 라벨, HEX 값을 지정할 수 있습니다.",
      cls: "setting-item-description",
    });

    for (let i = 0; i < this.plugin.settings.highlightColors.length; i++) {
      const color = this.plugin.settings.highlightColors[i];
      const s = new Setting(containerEl);

      s.setName(`색상 ${i + 1}`);

      s.addText((text) =>
        text
          .setPlaceholder("이름 (영문)")
          .setValue(color.name)
          .onChange(async (val) => {
            this.plugin.settings.highlightColors[i].name = val;
            await this.plugin.saveSettings();
          })
      );

      s.addText((text) =>
        text
          .setPlaceholder("라벨")
          .setValue(color.label)
          .onChange(async (val) => {
            this.plugin.settings.highlightColors[i].label = val;
            await this.plugin.saveSettings();
          })
      );

      s.addColorPicker((cp) =>
        cp.setValue(color.value).onChange(async (val) => {
          this.plugin.settings.highlightColors[i].value = val;
          await this.plugin.saveSettings();
        })
      );

      // Remove button (keep min 2 colors)
      if (this.plugin.settings.highlightColors.length > 2) {
        s.addButton((btn) =>
          btn
            .setIcon("trash-2")
            .setTooltip("삭제")
            .onClick(async () => {
              this.plugin.settings.highlightColors.splice(i, 1);
              await this.plugin.saveSettings();
              this.display(); // re-render
            })
        );
      }
    }

    // Add color button
    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("+ 색상 추가")
        .setCta()
        .onClick(async () => {
          this.plugin.settings.highlightColors.push({
            name: `color${this.plugin.settings.highlightColors.length + 1}`,
            label: "새 색상",
            value: "#ff9999",
          });
          await this.plugin.saveSettings();
          this.display();
        })
    );

    // Reset colors
    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("기본값 복원").onClick(async () => {
        this.plugin.settings.highlightColors = [...DEFAULT_COLORS];
        await this.plugin.saveSettings();
        this.display();
      })
    );

    // ─── AI Settings ─────────────────────────────
    containerEl.createEl("h3", { text: "🤖 AI 질문 답변 (Claude Writer 연동)" });

    const claudeOk = isClaudeAvailable(this.app);

    if (!claudeOk) {
      containerEl.createEl("p", {
        text: "⚠️ Claude Writer 플러그인이 설치/활성화되어 있지 않습니다. AI 기능을 사용하려면 Claude Writer를 먼저 설치하세요.",
        cls: "setting-item-description",
      }).style.color = "var(--text-error)";
    }

    new Setting(containerEl)
      .setName("AI 답변 활성화")
      .setDesc("파란색 질문 하이라이트에 대해 Claude AI가 답변을 생성합니다 (Claude Writer 필요)")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableAI).onChange(async (val) => {
          this.plugin.settings.enableAI = val;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("AI 모델")
      .setDesc("haiku: 빠르고 저렴 | sonnet: 깊은 분석")
      .addDropdown((dd) =>
        dd
          .addOption("haiku", "Haiku (빠름)")
          .addOption("sonnet", "Sonnet (정밀)")
          .setValue(this.plugin.settings.aiModel)
          .onChange(async (val) => {
            this.plugin.settings.aiModel = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("질문 색상")
      .setDesc("이 색상의 하이라이트 + 메모가 있으면 AI에게 질문합니다")
      .addDropdown((dd) => {
        for (const c of this.plugin.settings.highlightColors) {
          dd.addOption(c.name, c.label);
        }
        dd.setValue(this.plugin.settings.questionColor).onChange(async (val) => {
          this.plugin.settings.questionColor = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("AI 타임아웃 (초)")
      .setDesc("질문 1개당 최대 대기 시간")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.aiTimeout / 1000))
          .onChange(async (val) => {
            const n = parseInt(val, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.aiTimeout = n * 1000;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
