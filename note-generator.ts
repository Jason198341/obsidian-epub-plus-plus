import { App, TFile, TFolder } from "obsidian";
import { BookData, Highlight } from "./highlight-store";

export interface NoteGeneratorOptions {
  savePath: string;
  groupByChapter: boolean;
  includeSourceLink: boolean;
  template: string;
}

export class NoteGenerator {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /** Generate a markdown reading note from highlights */
  async generate(
    epubPath: string,
    bookData: BookData,
    options: NoteGeneratorOptions
  ): Promise<TFile> {
    const { title, author, highlights, progress } = bookData;
    const safeTitle = this.sanitizeFilename(title || "Untitled");
    const today = new Date().toISOString().slice(0, 10);
    const pct = Math.round(progress * 100);

    // Group highlights by chapter
    const grouped = this.groupByChapter(highlights);

    // Build markdown content
    let md = "";

    // Frontmatter
    md += "---\n";
    md += `tags: [독서노트, ${safeTitle}${author ? `, ${author}` : ""}]\n`;
    md += `created: ${today}\n`;
    md += `modified: ${today}\n`;
    md += `status: active\n`;
    md += `category: resource\n`;
    md += `template: ${options.template}\n`;
    md += `device: home\n`;
    md += `source: "[[${epubPath}]]"\n`;
    md += `progress: ${pct}%\n`;
    md += `highlights: ${highlights.length}\n`;
    md += "---\n\n";

    // Title
    md += `# ${title || "Untitled"} — 독서 하이라이트\n\n`;
    md += `> 📚 ${author || "Unknown"} | 진행률 ${pct}% | 하이라이트 ${highlights.length}개\n\n`;

    // Highlights grouped by chapter
    if (options.groupByChapter) {
      for (const [chapter, hls] of grouped) {
        md += `## ${chapter}\n\n`;
        for (const hl of hls) {
          md += this.formatHighlight(hl, epubPath, options.includeSourceLink);
        }
      }
    } else {
      for (const hl of highlights) {
        md += this.formatHighlight(hl, epubPath, options.includeSourceLink);
      }
    }

    // Ensure save directory exists
    await this.ensureFolder(options.savePath);

    // Create or update file
    const filePath = `${options.savePath}/${safeTitle}.md`;
    const existing = this.app.vault.getAbstractFileByPath(filePath);

    if (existing && existing instanceof TFile) {
      await this.app.vault.modify(existing, md);
      return existing;
    } else {
      return await this.app.vault.create(filePath, md);
    }
  }

  private formatHighlight(
    hl: Highlight,
    epubPath: string,
    includeLink: boolean
  ): string {
    const colorEmoji = this.colorToEmoji(hl.color);
    let block = `> [!quote]+ ${colorEmoji}\n`;
    block += `> ${hl.text}\n`;

    if (hl.note) {
      block += `>\n> 💭 ${hl.note}\n`;
    }

    if (includeLink) {
      block += `> — [[${epubPath}|원문 위치]]\n`;
    }

    block += "\n";
    return block;
  }

  private colorToEmoji(color: string): string {
    const map: Record<string, string> = {
      yellow: "🟡 핵심",
      green: "🟢 동의",
      blue: "🔵 질문",
      purple: "🟣 연결",
    };
    return map[color] || `🔸 ${color}`;
  }

  private groupByChapter(highlights: Highlight[]): Map<string, Highlight[]> {
    const map = new Map<string, Highlight[]>();
    for (const hl of highlights) {
      const ch = hl.chapter || "미분류";
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch)!.push(hl);
    }
    return map;
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim();
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) {
      await this.app.vault.createFolder(path);
    }
  }
}
