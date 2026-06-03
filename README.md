# Widgitron

![Version](https://img.shields.io/badge/version-0.2.2-blue)
![Rust](https://img.shields.io/badge/rust-1.75+-brown)
![Tauri](https://img.shields.io/badge/tauri-2.0-blue)
![React](https://img.shields.io/badge/react-19-blue)
![License](https://img.shields.io/badge/license-MIT-orange)

<img src="icons/widgitron.png" alt="Widgitron Logo" width="150">

**A high-performance, modular desktop widget framework for researchers and developers.**

> [!TIP]
> Windows users can download the pre-compiled standalone executable directly from the [Releases](https://github.com/caizhuojiang/widgitron/releases) page.

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
git clone https://github.com/caizhuojiang/widgitron.git
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

## 📊 Built-in Widgets

### GPU Monitor

Intelligent remote GPU monitoring optimized for HPC environments:
- 📡 **HPC Compliant**: Uses persistent SSH to minimize load on login nodes.
- 🚀 **Slurm Support**: Real-time job tracking and Job ID management.

### Paper Deadline Monitor

Keep track of conference deadlines with high-precision countdowns:
- ⏳ **Real-time Countdowns**: Precise tracking down to the second.
- 🎯 **Smart Filtering**: Filter by conference types or research areas.

### Arxiv Radar

Stay ahead of the curve with real-time research monitoring:
- 🔍 **Keyword Filtering**: Targeted tracking of specific research topics (e.g., LLM, VLA).
- 📁 **Smart Libraries**: Organize papers into "Saved" for future reading or "Discarded" to clear clutter.
- 📱 **Gesture Controls**: Swipe right to save, left to discard, and up to open the PDF.

## 🤝 Contributing

Contributions welcome! Here's how:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-widget`)
3. Commit your changes (`git commit -m 'Add amazing widget'`)
4. Push to the branch (`git push origin feature/amazing-widget`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
