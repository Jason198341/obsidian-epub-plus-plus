# EPUB++

> Read. Highlight. Done. — Everything else is automatic.

EPUB++ is an Obsidian plugin that turns your EPUB reading highlights into organized notes automatically.

## Features

- **Read EPUBs natively** — Open `.epub` files directly in Obsidian
- **Highlight with colors** — Select text and mark it with customizable colors
- **Auto-generate notes** — One click to create structured reading notes from all your highlights
- **Remember your place** — Automatically saves reading position and progress
- **Dark mode support** — Seamlessly adapts to your Obsidian theme
- **Table of contents** — Navigate chapters with built-in TOC sidebar
- **Highlight panel** — Browse, search, and manage all highlights in one place

## How It Works

```
📚 Open EPUB → ✏️ Highlight text → 📝 Click "Generate Note" → Done!
```

Your highlights are automatically:
- Grouped by chapter
- Formatted with source links
- Saved as a Markdown note with proper frontmatter
- Ready for Obsidian's graph view, backlinks, and Dataview

## Installation

### From Obsidian Community Plugins
1. Open Settings → Community Plugins → Browse
2. Search "EPUB++"
3. Click Install → Enable

### Manual Installation
1. Download `main.js`, `styles.css`, `manifest.json` from the [latest release](https://github.com/jasonmoon-dev/obsidian-epub-plus-plus/releases)
2. Create folder: `your-vault/.obsidian/plugins/epub-plus-plus/`
3. Copy the 3 files into that folder
4. Restart Obsidian → Enable the plugin

## Usage

1. Drop an `.epub` file into your vault
2. Click the file — it opens in the EPUB++ reader
3. Select text → choose a highlight color
4. Click **📝 노트 생성** to generate a reading note

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Note save path | Where reading notes are saved | `3_Resources/독서노트` |
| Note template | Frontmatter template name | `SQ3R-독서노트` |
| Highlight colors | Customize colors, labels, add/remove | 4 colors (yellow, green, blue, purple) |

## Highlight Colors

Default colors (fully customizable):
- 🟡 **Yellow** — Key concepts
- 🟢 **Green** — Agreement
- 🔵 **Blue** — Questions
- 🟣 **Purple** — Connections

## Generated Note Format

```markdown
---
tags: [독서노트, Book Title, Author]
template: SQ3R-독서노트
progress: 65%
highlights: 12
---

# Book Title — Reading Highlights

> 📚 Author | Progress 65% | 12 highlights

## Chapter 1

> [!quote]+ 🟡 핵심
> Your highlighted text here
> — [[book.epub|Source]]
```

## Tech Stack

- [epub.js](https://github.com/futurepress/epub.js) — EPUB rendering & CFI-based positioning
- Obsidian `TextFileView` — Native file integration
- JSON sidecar — Highlight persistence (never modifies your EPUB)

## License

MIT

---

## More Projects by Jason Moon

| Project | Description |
|---------|-------------|
| [Prompt Garden](https://promptgarden.online) | Visual prompt engineering workspace with node-based editor |
| [EngReading](https://engreading.com) | English reading comprehension through 7-Set verb mastery |
| [Agentopia](https://agentopia.online) | AI agent battle arena with ELO ranking |
| [RunDNA](https://rundna.online) | Smart running dashboard with Strava integration |
| [Claude Writer](https://github.com/Jason198341/obsidian-claude-writer) | AI writing assistant for Obsidian powered by Claude |

**[jasonmoon.dev](https://jasonmoon.dev)** — Full portfolio & blog
