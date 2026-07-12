# Graphics Programmer Portfolio & Write-ups Website

A high-performance, dark-themed, glassmorphic portfolio and blog website custom-tailored for a Graphics and Game Programmer (like Sujay Shah). It includes an interactive 3D-like vertex mesh background, expandable project drawers with source code previews, and an integrated client-side Markdown rendering engine.

## 🚀 Features

* **3D Vertex Mesh Background:** An interactive, canvas-driven background grid representing an engine vertex shader, responding to mouse inputs and screen sizing.
* **Responsive SPA Design:** Single Page Application (SPA) architecture utilizing simple URL hashes (`#home`, `#experience`, `#projects`, `#writeups`) for routing.
* **Expandable Work Experience:** Smooth timeline accordion showcasing Qualcomm driver engineering, Visual Concepts, RunGames, and Confetti Interactive.
* **Project Drawers:** Clickable action sheets showing deep architecture briefs, implementation checklists, and syntax-highlighted C++/GLSL code.
* **Client-Side Markdown Blog:** Loads posts from raw `.md` files dynamically, compiles them on-the-fly using `marked.js`, and highlights syntax using `Prism.js`.
* **Zero-Dependencies (Deployment Friendly):** Entirely static web project that can be hosted on GitHub Pages, Netlify, Vercel, or a simple HTTP server.

---

## 🛠️ How to Run Locally

Because the blog system fetches Markdown files (`/posts/*.md`) dynamically via the browser's `fetch` API, running the project by directly double-clicking `index.html` will fail due to browser **CORS (Cross-Origin Resource Sharing)** restrictions for `file://` protocols.

To run it locally, launch a lightweight development server. Here are the easiest methods:

### Method 1: Python (Built-in)
If you have Python installed, run this command in your terminal from this directory:
```bash
# Python 3
python -m http.server 8000
```
Then visit: [http://localhost:8000](http://localhost:8000)

### Method 2: Node.js (npx)
If you have Node.js installed, you can use the `serve` package:
```bash
npx serve .
```
Then visit the URL displayed in your terminal (typically [http://localhost:3000](http://localhost:3000)).

---

## ✍️ How to Write New Blog Posts / Write-ups

Adding new write-ups is designed to be simple and require no programming knowledge:

1. **Create a Markdown file:**
   Save a new file in the `posts/` directory (e.g., `posts/my-new-trick.md`) and write your post in standard Markdown.
   
2. **Register it in `posts.json`:**
   Open the root `posts.json` file and append a metadata block for your new post:
   ```json
   {
     "id": "my-new-trick",
     "title": "A Cool Rendering Trick in HLSL",
     "description": "A short summary explaining what this trick is and why it helps performance.",
     "date": "July 15, 2026",
     "readTime": "4 min read",
     "tags": ["DirectX 12", "Performance", "Shaders"],
     "filePath": "posts/my-new-trick.md"
   }
   ```

3. **Enjoy!**
   The website will dynamically load, search, filter, and compile your new post immediately!

### GitHub-Style Alerts Supported
You can add GitHub-style alerts in your markdown posts:
* `> [!NOTE]` — Cyan info box
* `> [!TIP]` — Green tips box
* `> [!IMPORTANT]` — Cyan highlight
* `> [!WARNING]` — Orange warning box
* `> [!CAUTION]` — Red alert box
