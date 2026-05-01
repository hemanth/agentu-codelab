import { lessons } from "./lessons.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pyodide = null;
let editor = null;
let currentLesson = 0;
let completed = JSON.parse(localStorage.getItem("agentu-codelab-completed") || "[]");
let isRunning = false;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const loadingEl = $("loading");
const loadingText = $("loading-text");
const sidebarEl = $("sidebar-lessons");
const searchInput = $("search-input");
const lessonNum = $("lesson-num");
const lessonTitle = $("lesson-title");
const lessonDesc = $("lesson-desc");
const outputEl = $("output");
const outputStatus = $("output-status");
const exerciseText = $("exercise-text");
const hintText = $("hint-text");
const hintToggle = $("hint-toggle");
const progressLabel = $("progress-label");
const progressFill = $("progress-fill");
const editorStatus = $("editor-status");
const btnRun = $("btn-run");
const btnReset = $("btn-reset");
const btnSolution = $("btn-solution");
const btnPrev = $("btn-prev");
const btnNext = $("btn-next");

// ---------------------------------------------------------------------------
// Simple markdown → HTML
// ---------------------------------------------------------------------------

function renderMarkdown(text) {
  let html = text
    // Code blocks (```...```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs: split by double newline
  html = html
    .split(/\n\n+/)
    .map(block => {
      block = block.trim();
      if (!block) return "";
      if (block.startsWith("<pre>") || block.startsWith("<ul>")) return block;
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Pyodide init
// ---------------------------------------------------------------------------

async function initPyodide() {
  loadingText.textContent = "Loading Python runtime…";
  pyodide = await loadPyodide();

  loadingText.textContent = "Loading Python packages…";
  await pyodide.loadPackage("sqlite3");

  loadingText.textContent = "Loading agentu module…";

  const mockResp = await fetch("./agentu_mock.py");
  const mockCode = await mockResp.text();

  pyodide.FS.writeFile("/home/pyodide/agentu.py", mockCode);
  pyodide.runPython(`import sys; sys.path.insert(0, '/home/pyodide')`);
  pyodide.runPython(`import agentu`);

  loadingText.textContent = "Loading editor…";
}

// ---------------------------------------------------------------------------
// Monaco init
// ---------------------------------------------------------------------------

function initMonaco() {
  return new Promise((resolve) => {
    require.config({
      paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" },
    });
    require(["vs/editor/editor.main"], function () {
      monaco.editor.defineTheme("agentu-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6b7280", fontStyle: "italic" },
          { token: "keyword", foreground: "2dd4bf" },
          { token: "string", foreground: "34d399" },
          { token: "number", foreground: "fbbf24" },
          { token: "type", foreground: "67e8f9" },
        ],
        colors: {
          "editor.background": "#0f172a",
          "editor.foreground": "#e2e8f0",
          "editor.lineHighlightBackground": "#1e293b",
          "editorCursor.foreground": "#2dd4bf",
          "editor.selectionBackground": "#334155",
          "editorLineNumber.foreground": "#475569",
          "editorLineNumber.activeForeground": "#2dd4bf",
        },
      });

      editor = monaco.editor.create($("editor-container"), {
        language: "python",
        theme: "agentu-dark",
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        minimap: { enabled: false },
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: "all",
        tabSize: 4,
        wordWrap: "on",
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Run Python code — fixed for Pyodide async
// ---------------------------------------------------------------------------

async function runCode() {
  if (isRunning || !pyodide) return;
  isRunning = true;
  btnRun.disabled = true;
  btnRun.textContent = "Running…";
  outputEl.className = "";
  outputEl.textContent = "";
  outputStatus.textContent = "";

  const code = editor.getValue();

  // Pyodide handles top-level await natively with runPythonAsync.
  // We redirect stdout to capture print() output.
  const wrappedCode = `
import sys as _sys, io as _io
_capture = _io.StringIO()
_sys.stdout = _capture

async def _codelab_run():
${code.split("\n").map((l) => "    " + l).join("\n")}

await _codelab_run()

_sys.stdout = _sys.__stdout__
_capture.getvalue()
`;

  try {
    const result = await pyodide.runPythonAsync(wrappedCode);
    const output = result || "(no output)";
    outputEl.textContent = output;
    outputStatus.textContent = "✓ success";
    outputStatus.className = "output-status-ok";
    outputEl.className = "";

    // Mark completed
    if (!completed.includes(currentLesson)) {
      completed.push(currentLesson);
      localStorage.setItem("agentu-codelab-completed", JSON.stringify(completed));
      updateSidebar();
      updateProgress();
    }
  } catch (err) {
    let msg = err.message || String(err);
    // Extract the actual Python error (last line that looks like an error)
    const lines = msg.split("\n");
    const meaningful = lines.filter(
      (l) => l.trim() && !l.startsWith("    ") && !l.includes("_codelab_run")
    );
    const pyError = meaningful.pop() || msg;
    outputEl.textContent = pyError;
    outputEl.className = "has-error";
    outputStatus.textContent = "✗ error";
    outputStatus.className = "output-status-err";
  } finally {
    isRunning = false;
    btnRun.disabled = false;
    btnRun.textContent = "Run";
  }
}

// ---------------------------------------------------------------------------
// Render lesson
// ---------------------------------------------------------------------------

function renderLesson(index) {
  currentLesson = index;
  const lesson = lessons[index];

  lessonNum.textContent = `Lesson ${index + 1} of ${lessons.length}`;
  lessonTitle.textContent = lesson.title;
  lessonDesc.innerHTML = renderMarkdown(lesson.description);

  editor.setValue(lesson.starterCode);
  outputEl.textContent = "";
  outputEl.className = "";
  outputEl.innerHTML = '<span class="output-empty">Hit Run or Ctrl+Enter to execute</span>';
  outputStatus.textContent = "";
  outputStatus.className = "";
  editorStatus.textContent = "Ctrl + Enter to run";

  exerciseText.innerHTML = renderMarkdown(lesson.exercise);
  hintText.textContent = lesson.hint;
  hintText.classList.remove("show");
  hintToggle.textContent = "Show hint";

  btnPrev.disabled = index === 0;
  btnNext.disabled = false;
  btnNext.textContent = index === lessons.length - 1 ? "Complete" : "Next \u2192";

  updateSidebar();
  $("main").scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Sidebar + search
// ---------------------------------------------------------------------------

function buildSidebar() {
  sidebarEl.innerHTML = "";
  lessons.forEach((lesson, i) => {
    const item = document.createElement("div");
    item.className = "sidebar-item";
    item.dataset.index = i;
    item.innerHTML = `<span class="dot"></span><span class="sidebar-num">${i + 1}.</span><span>${lesson.title}</span>`;
    item.addEventListener("click", () => renderLesson(i));
    sidebarEl.appendChild(item);
  });
  updateSidebar();
}

function updateSidebar() {
  document.querySelectorAll(".sidebar-item").forEach((item, i) => {
    item.classList.toggle("active", i === currentLesson);
    item.classList.toggle("completed", completed.includes(i));
  });
}

function updateProgress() {
  const pct = Math.round((completed.length / lessons.length) * 100);
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `${completed.length}/${lessons.length} complete`;
  $("progress-pct").textContent = `${pct}%`;
}

// Search filter
searchInput.addEventListener("input", () => {
  const q = searchInput.value.toLowerCase();
  document.querySelectorAll(".sidebar-item").forEach((item, i) => {
    const lesson = lessons[i];
    const match =
      !q ||
      lesson.title.toLowerCase().includes(q) ||
      lesson.description.toLowerCase().includes(q);
    item.classList.toggle("hidden", !match);
  });
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

btnRun.addEventListener("click", runCode);

btnReset.addEventListener("click", () => {
  editor.setValue(lessons[currentLesson].starterCode);
  outputEl.innerHTML = '<span class="output-empty">Hit Run or Ctrl+Enter to execute</span>';
  outputEl.className = "";
  outputStatus.textContent = "";
});

btnSolution.addEventListener("click", () => {
  const sol = lessons[currentLesson].solution;
  if (editor.getValue() === sol) {
    editor.setValue(lessons[currentLesson].starterCode);
    btnSolution.textContent = "Show solution";
  } else {
    editor.setValue(sol);
    btnSolution.textContent = "Back to starter";
  }
});

hintToggle.addEventListener("click", () => {
  const showing = hintText.classList.toggle("show");
  hintToggle.textContent = showing ? "Hide hint" : "Show hint";
});

btnPrev.addEventListener("click", () => {
  if (currentLesson > 0) renderLesson(currentLesson - 1);
});

btnNext.addEventListener("click", () => {
  if (currentLesson < lessons.length - 1) {
    renderLesson(currentLesson + 1);
  } else {
    // Last lesson — mark complete and show congrats
    if (!completed.includes(currentLesson)) {
      completed.push(currentLesson);
      localStorage.setItem("agentu-codelab-completed", JSON.stringify(completed));
      updateSidebar();
    }
    $("congrats-overlay").classList.remove("hidden");
  }
});

// Restart from congrats screen
$("congrats-restart").addEventListener("click", () => {
  completed = [];
  localStorage.removeItem("agentu-codelab-completed");
  $("congrats-overlay").classList.add("hidden");
  renderLesson(0);
});

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.closest("#editor-container")) return;
  if (e.key === "ArrowLeft" && currentLesson > 0) renderLesson(currentLesson - 1);
  if (e.key === "ArrowRight" && currentLesson < lessons.length - 1) renderLesson(currentLesson + 1);
});

// ---------------------------------------------------------------------------
// Boot — landing page first, then load runtime on click
// ---------------------------------------------------------------------------

const landingEl = document.getElementById("landing");
const startBtn = document.getElementById("start-codelab");
let booted = false;

async function launchCodelab(startLesson) {
  if (booted) {
    // Already booted, just navigate
    renderLesson(startLesson);
    return;
  }

  // Dismiss landing
  if (landingEl) {
    landingEl.style.opacity = "0";
    landingEl.style.transform = "translateY(-20px)";
    landingEl.style.pointerEvents = "none";
    setTimeout(() => { if (landingEl.parentNode) landingEl.parentNode.removeChild(landingEl); }, 600);
  }

  // Show loading
  loadingEl.style.display = "flex";
  loadingEl.style.opacity = "1";

  try {
    await initPyodide();
    await initMonaco();

    buildSidebar();
    updateProgress();
    renderLesson(startLesson);
    btnRun.disabled = false;
    booted = true;

    // Hide loading
    loadingEl.style.opacity = "0";
    setTimeout(() => { if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl); }, 500);
  } catch (err) {
    loadingText.textContent = "Failed: " + (err.message || err);
    console.error("Boot error:", err);
  }
}

// "Start learning" button → lesson 0
if (startBtn) {
  startBtn.addEventListener("click", () => launchCodelab(0));
}

// Feature cards → jump to specific lesson
document.querySelectorAll(".feature-card[data-lesson]").forEach((card) => {
  card.style.cursor = "pointer";
  card.addEventListener("click", () => {
    const idx = parseInt(card.dataset.lesson, 10);
    launchCodelab(idx);
  });
});

