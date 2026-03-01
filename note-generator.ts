import { App, TFile } from "obsidian";
import { BookData, Highlight } from "./highlight-store";
import { getClaudeConfig, callClaude } from "./claude-bridge";

export interface NoteGeneratorOptions {
  savePath: string;
  groupByChapter: boolean;
  includeSourceLink: boolean;
  template: string;
  enableAI: boolean;
  questionColor: string;
  aiModel: string;
  aiTimeout: number;
  onProgress?: (current: number, total: number) => void;
}

export class NoteGenerator {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async generate(
    epubPath: string,
    bookData: BookData,
    options: NoteGeneratorOptions
  ): Promise<TFile> {
    const { title, author, highlights, progress } = bookData;
    const safeTitle = this.sanitizeFilename(title || "Untitled");
    const today = new Date().toISOString().slice(0, 10);
    const pct = Math.round(progress * 100);

    // ── Preserve existing AI answers before regeneration ──
    const filePath = `${options.savePath}/${safeTitle}.md`;
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    let preserved = new Map<string, string>();
    let createdDate = today;

    if (existingFile && existingFile instanceof TFile) {
      const existingContent = await this.app.vault.read(existingFile);
      preserved = this.extractPreservedBlocks(existingContent);
      // Preserve original created date
      const createdMatch = existingContent.match(/^created:\s*(.+)$/m);
      if (createdMatch) createdDate = createdMatch[1].trim();
    }

    // Collect questions (blue + has note)
    const questions = highlights.filter(
      (h) => h.color === options.questionColor && h.note.trim().length > 0
    );

    // Get AI answers if enabled (only for questions WITHOUT preserved answers)
    const aiAnswers = new Map<string, string>();
    if (options.enableAI && questions.length > 0) {
      const config = getClaudeConfig(this.app);
      if (config) {
        const model = options.aiModel || config.model || "haiku";
        const unanswered = questions.filter(
          (q) => !preserved.has(q.id) && !preserved.has(q.note)
        );
        let done = 0;

        for (const q of unanswered) {
          options.onProgress?.(done + 1, unanswered.length);
          try {
            const answer = await this.askClaude(
              config.claudePath,
              model,
              title || "Unknown",
              author || "Unknown",
              q.text,
              q.note,
              options.aiTimeout
            );
            aiAnswers.set(q.id, answer);
          } catch (err) {
            aiAnswers.set(q.id, `⚠️ AI 응답 실패: ${err}`);
          }
          done++;
        }
      }
    }

    // Count total AI answers (new + preserved)
    const totalAiAnswers = aiAnswers.size + [...preserved.keys()].filter(
      (k) => highlights.some((h) => h.id === k || h.note === k)
    ).length;

    // Group highlights by chapter
    const grouped = this.groupByChapter(highlights);

    // Build markdown
    let md = "";

    // Frontmatter
    md += "---\n";
    md += `tags: [독서노트, ${safeTitle}${author ? `, ${author}` : ""}]\n`;
    md += `created: ${createdDate}\n`;
    md += `modified: ${today}\n`;
    md += `status: active\n`;
    md += `category: resource\n`;
    md += `template: ${options.template}\n`;
    md += `device: home\n`;
    md += `source: "[[${epubPath}]]"\n`;
    md += `progress: ${pct}%\n`;
    md += `highlights: ${highlights.length}\n`;
    if (totalAiAnswers > 0) {
      md += `ai_answers: ${totalAiAnswers}\n`;
    }
    md += "---\n\n";

    // Title
    md += `# ${title || "Untitled"} — 독서 하이라이트\n\n`;
    let subtitle = `> 📚 ${author || "Unknown"} | 진행률 ${pct}% | 하이라이트 ${highlights.length}개`;
    if (totalAiAnswers > 0) {
      subtitle += ` | AI 답변 ${totalAiAnswers}개`;
    }
    md += subtitle + "\n\n";

    // Highlights by chapter
    if (options.groupByChapter) {
      for (const [chapter, hls] of grouped) {
        md += `## ${chapter}\n\n`;
        for (const hl of hls) {
          md += this.formatHighlight(
            hl,
            epubPath,
            options.includeSourceLink,
            options.questionColor,
            aiAnswers,
            preserved
          );
        }
      }
    } else {
      for (const hl of highlights) {
        md += this.formatHighlight(
          hl,
          epubPath,
          options.includeSourceLink,
          options.questionColor,
          aiAnswers,
          preserved
        );
      }
    }

    // Save
    await this.ensureFolder(options.savePath);

    if (existingFile && existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, md);
      return existingFile;
    } else {
      return await this.app.vault.create(filePath, md);
    }
  }

  private formatHighlight(
    hl: Highlight,
    epubPath: string,
    includeLink: boolean,
    questionColor: string,
    aiAnswers: Map<string, string>,
    preserved: Map<string, string>
  ): string {
    const colorEmoji = this.colorToEmoji(hl.color);
    const isQuestion =
      hl.color === questionColor && hl.note.trim().length > 0;

    // Invisible marker for merge tracking (hidden in Obsidian preview)
    let block = `%%hl:${hl.id}%%\n`;
    block += `> [!quote]+ ${colorEmoji}\n`;
    block += `> ${hl.text}\n`;

    if (includeLink) {
      block += `> — [[${epubPath}|원문 위치]]\n`;
    }

    if (isQuestion) {
      block += `>\n> ❓ **${hl.note}**\n`;
      block += "\n";

      // Priority: 1) new AI answer, 2) preserved answer (by ID), 3) preserved (by question text)
      const newAnswer = aiAnswers.get(hl.id);
      const preservedAnswer = preserved.get(hl.id) || preserved.get(hl.note);

      if (newAnswer) {
        block += `> [!tip]- 🤖 AI 답변\n`;
        for (const line of newAnswer.split("\n")) {
          block += `> ${line}\n`;
        }
      } else if (preservedAnswer) {
        block += preservedAnswer;
      }
    } else if (hl.note) {
      block += `>\n> 💭 ${hl.note}\n`;
    }

    block += "\n";
    return block;
  }

  /**
   * Extract preserved AI answer blocks from an existing note.
   * Returns Map keyed by highlight ID (%%hl:xxx%%) or question text (legacy fallback).
   * Values are the raw [!tip] block text ready for re-injection.
   */
  private extractPreservedBlocks(content: string): Map<string, string> {
    const preserved = new Map<string, string>();
    const lines = content.split("\n");

    let currentHlId = "";
    let currentQuestion = "";

    for (let i = 0; i < lines.length; i++) {
      // Detect %%hl:xxx%% marker
      const markerMatch = lines[i].match(/^%%hl:(.+?)%%$/);
      if (markerMatch) {
        currentHlId = markerMatch[1];
        currentQuestion = "";
        continue;
      }

      // Detect question line
      const qMatch = lines[i].match(/^>\s*❓\s*\*\*(.+?)\*\*/);
      if (qMatch) {
        currentQuestion = qMatch[1];
        continue;
      }

      // Detect [!tip] AI answer block
      if (lines[i].match(/^>\s*\[!tip\].*AI\s*답변/)) {
        // Collect the entire [!tip] block (lines starting with >)
        let tipBlock = lines[i] + "\n";
        let j = i + 1;
        while (j < lines.length && lines[j].startsWith(">")) {
          tipBlock += lines[j] + "\n";
          j++;
        }

        // Store by ID (preferred) and by question text (fallback)
        if (currentHlId) {
          preserved.set(currentHlId, tipBlock);
        }
        if (currentQuestion) {
          preserved.set(currentQuestion, tipBlock);
        }

        i = j - 1; // skip processed lines
      }
    }

    return preserved;
  }

  private async askClaude(
    claudePath: string,
    model: string,
    bookTitle: string,
    bookAuthor: string,
    passage: string,
    question: string,
    timeout: number
  ): Promise<string> {
    const systemPrompt = [
      `당신은 독서 도우미입니다.`,
      `책: "${bookTitle}" (${bookAuthor})`,
      ``,
      `독자가 책의 한 구절을 읽고 질문했습니다.`,
      `구절의 맥락을 고려하여 간결하게 답변해주세요.`,
      ``,
      `규칙:`,
      `- 2~3문단, 한국어로 답변`,
      `- 마크다운 서식 사용하지 마세요 (볼드, 헤더 등 금지)`,
      `- 인사말이나 머리말 없이 바로 답변`,
      `- 책의 맥락과 일반 지식을 결합하여 답변`,
    ].join("\n");

    const userText = [
      `📖 원문:`,
      passage,
      ``,
      `❓ 질문:`,
      question,
    ].join("\n");

    return callClaude(claudePath, model, systemPrompt, userText, timeout);
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
