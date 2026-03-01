import { App, TFile } from "obsidian";

export interface Highlight {
  id: string;
  cfi: string;
  text: string;
  color: string;
  note: string;
  chapter: string;
  created: string;
}

export interface BookData {
  bookId: string;
  title: string;
  author: string;
  highlights: Highlight[];
  lastPosition: string;
  progress: number;
  totalLocations: number;
  lastOpened: string;
}

function emptyBookData(): BookData {
  return {
    bookId: "",
    title: "",
    author: "",
    highlights: [],
    lastPosition: "",
    progress: 0,
    totalLocations: 0,
    lastOpened: new Date().toISOString(),
  };
}

export class HighlightStore {
  private app: App;
  private cache: Map<string, BookData> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  /** Sidecar path: same folder as EPUB, .highlights.json suffix */
  private sidecarPath(epubPath: string): string {
    return epubPath + ".highlights.json";
  }

  async load(epubPath: string): Promise<BookData> {
    const cached = this.cache.get(epubPath);
    if (cached) return cached;

    const path = this.sidecarPath(epubPath);
    const file = this.app.vault.getAbstractFileByPath(path);

    let data: BookData;
    if (file && file instanceof TFile) {
      try {
        const raw = await this.app.vault.read(file);
        data = JSON.parse(raw) as BookData;
      } catch {
        data = emptyBookData();
      }
    } else {
      data = emptyBookData();
    }

    this.cache.set(epubPath, data);
    return data;
  }

  async save(epubPath: string, data: BookData): Promise<void> {
    this.cache.set(epubPath, data);
    const path = this.sidecarPath(epubPath);
    const json = JSON.stringify(data, null, 2);

    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && file instanceof TFile) {
      await this.app.vault.modify(file, json);
    } else {
      await this.app.vault.create(path, json);
    }
  }

  async addHighlight(
    epubPath: string,
    cfi: string,
    text: string,
    color: string,
    chapter: string
  ): Promise<Highlight> {
    const data = await this.load(epubPath);
    const hl: Highlight = {
      id: `h_${Date.now()}`,
      cfi,
      text,
      color,
      note: "",
      chapter,
      created: new Date().toISOString(),
    };
    data.highlights.push(hl);
    await this.save(epubPath, data);
    return hl;
  }

  async removeHighlight(epubPath: string, id: string): Promise<void> {
    const data = await this.load(epubPath);
    data.highlights = data.highlights.filter((h) => h.id !== id);
    await this.save(epubPath, data);
  }

  async updateHighlightNote(
    epubPath: string,
    id: string,
    note: string
  ): Promise<void> {
    const data = await this.load(epubPath);
    const hl = data.highlights.find((h) => h.id === id);
    if (hl) {
      hl.note = note;
      await this.save(epubPath, data);
    }
  }

  async updateHighlightColor(
    epubPath: string,
    id: string,
    color: string
  ): Promise<void> {
    const data = await this.load(epubPath);
    const hl = data.highlights.find((h) => h.id === id);
    if (hl) {
      hl.color = color;
      await this.save(epubPath, data);
    }
  }

  async updatePosition(
    epubPath: string,
    cfi: string,
    progress: number,
    totalLocations: number
  ): Promise<void> {
    const data = await this.load(epubPath);
    data.lastPosition = cfi;
    data.progress = progress;
    data.totalLocations = totalLocations;
    data.lastOpened = new Date().toISOString();
    await this.save(epubPath, data);
  }

  async setBookMeta(
    epubPath: string,
    title: string,
    author: string,
    bookId: string
  ): Promise<void> {
    const data = await this.load(epubPath);
    data.title = title;
    data.author = author;
    data.bookId = bookId;
    await this.save(epubPath, data);
  }
}
