<p align="center">
  <img src="icons/widgitron.png" alt="Widgitron Logo" width="120" style="border-radius: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.15);" />
</p>

<h1 align="center">Widgitron</h1>

<p align="center">
  <strong>A high-performance, modular desktop widget framework for researchers and developers.</strong>
</p>

<p align="center">
  <a href="https://github.com/starkmomo/widgitron/releases">
    <img src="https://img.shields.io/badge/Version-v0.2.3-8B5CF6?style=flat-square&labelColor=2E1065&logo=github&logoColor=white" alt="Version" />
  </a>
  <a href="https://www.rust-lang.org/">
    <img src="https://img.shields.io/badge/Rust-1.75%2B-F97316?style=flat-square&logo=rust&logoColor=white&labelColor=431407" alt="Rust" />
  </a>
  <a href="https://tauri.app/">
    <img src="https://img.shields.io/badge/Tauri-2.0-24C6C1?style=flat-square&logo=tauri&logoColor=white&labelColor=083344" alt="Tauri" />
  </a>
  <a href="https://react.dev/">
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white&labelColor=172554" alt="React" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-10B981?style=flat-square&labelColor=022C22" alt="License" />
  </a>
</p>

> [!TIP]
> Windows users can download the pre-compiled standalone executable directly from the [Releases](https://github.com/starkmomo/widgitron/releases) page.

Widgitron is a modern, cross-platform dashboard built with **Tauri**, **Rust**, and **React**. It provides a premium, glassmorphic UI for monitoring GPUs, conference deadlines, and arxiv research papers.

<p align="center">
  <img src="assets/quota_monitor.png" width="50%" />
  <img src="assets/gpu_monitor.png" width="46%" />
</p>
<p align="center">
  <img src="assets/deadline_demo.gif" width="49%" />
  <img src="assets/arxiv_radar_demo.gif" width="47%" />
</p>

## 🗺️ Roadmap

### ✅ Completed
- [x] Tauri 2.0 & Rust backend migration
- [x] Modern React-based Glassmorphism UI
- [x] GPU monitoring (Persistent SSH)
- [x] Slurm integration & Job ID tracking
- [x] Paper deadline countdown widget
- [x] Advanced widget theme customization
- [x] Arxiv Radar: paper card with swipe gestures
- [x] Agent quota monitor widget (Codex, Cursor, etc.)


## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/starkmomo/widgitron.git
cd widgitron

# Install dependencies
pnpm install
```

### Run

```bash
# Development mode
pnpm tauri dev

# Build production executable
pnpm tauri build
```

## 🤝 Contributing

Contributions welcome! Here's how:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-widget`)
3. Commit your changes (`git commit -m 'Add amazing widget'`)
4. Push to the branch (`git push origin feature/amazing-widget`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
