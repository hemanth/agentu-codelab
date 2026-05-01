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
const sidebarEl = $("sidebar");
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
// Pyodide init
// ---------------------------------------------------------------------------

async function initPyodide() {
  loadingText.textContent = "Loading Python runtime…";
  pyodide = await loadPyodide();

  loadingText.textContent = "Loading agentu module…";

  // Fetch the mock module
  const mockResp = await fetch("./agentu_mock.py");
  const mockCode = await mockResp.text();

  // Register it as 'agentu' so `from agentu import ...` works
  pyodide.FS.writeFile("/home/pyodide/agentu.py", mockCode);
  pyodide.runPython(`import sys; sys.path.insert(0, '/home/pyodide')`);

  // Verify
  pyodide.runPython(`import agentu; print("agentu loaded")`);

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
          { token: "keyword", foreground: "c084fc" },
          { token: "string", foreground: "34d399" },
          { token: "number", foreground: "fbbf24" },
          { token: "type", foreground: "818cf8" },
        ],
        colors: {
          "editor.background": "#0f172a",
          "editor.foreground": "#e2e8f0",
          "editor.lineHighlightBackground": "#1e293b",
          "editorCursor.foreground": "#818cf8",
          "editor.selectionBackground": "#334155",
          "editorLineNumber.foreground": "#475569",
          "editorLineNumber.activeForeground": "#818cf8",
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

      // Ctrl/Cmd+Enter to run
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);

      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Run Python code
// ---------------------------------------------------------------------------

async function runCode() {
  if (isRunning || !pyodide) return;
  isRunning = true;
  btnRun.disabled = true;
  btnRun.textContent = "⏳ Running…";
  outputEl.className = "";
  outputEl.textContent = "";
  outputStatus.textContent = "";

  const code = editor.getValue();

  // Wrap in async since agentu uses `await`
  const wrappedCode = `
import sys, io
_stdout = io.StringIO()
sys.stdout = _stdout

async def _codelab_main():
${code.split("\n").map((l) => "    " + l).join("\n")}

import asyncio
asyncio.get_event_loop().run_until_complete(_codelab_main())

sys.stdout = sys.__stdout__
_stdout.getvalue()
`;

  try {
    const result = await pyodide.runPythonAsync(wrappedCode);
    outputEl.textContent = result || "(no output)";
    outputStatus.textContent = "✓ success";
    outputEl.className = "";

    // Mark lesson as completed
    if (!completed.includes(currentLesson)) {
      completed.push(currentLesson);
      localStorage.setItem("agentu-codelab-completed", JSON.stringify(completed));
      updateSidebar();
      updateProgress();
    }
  } catch (err) {
    // Clean up the error message
    let msg = err.message || String(err);
    // Extract just the last meaningful error line
    const lines = msg.split("\n");
    const pyError = lines.filter((l) => l.trim() && !l.startsWith("  ") && !l.includes("_codelab_main")).pop() || msg;
    outputEl.textContent = pyError;
    outputEl.className = "has-error";
    outputStatus.textContent = "✗ error";
  } finally {
    isRunning = false;
    btnRun.disabled = false;
    btnRun.textContent = "▶ Run";
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
  lessonDesc.textContent = lesson.description;

  editor.setValue(lesson.starterCode);
  outputEl.textContent = "";
  outputEl.className = "";
  outputEl.innerHTML = '<span class="output-empty">Run your code to see output here</span>';
  outputStatus.textContent = "";
  editorStatus.textContent = "Ctrl+Enter to run";

  exerciseText.innerHTML = lesson.exercise.replace(
    /\*\*(.*?)\*\*/g, "<strong>$1</strong>"
  ).replace(/\*(.*?)\*/g, "<em>$1</em>").replace(/`(.*?)`/g, "<code>$1</code>");

  hintText.textContent = lesson.hint;
  hintText.classList.remove("show");
  hintToggle.textContent = "Show hint";

  btnPrev.disabled = index === 0;
  btnNext.disabled = index === lessons.length - 1;
  btnNext.textContent = index === lessons.length - 1 ? "🎉 Complete!" : "Next →";

  updateSidebar();

  // Scroll to top
  $("main").scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function buildSidebar() {
  sidebarEl.innerHTML = "";
  lessons.forEach((lesson, i) => {
    const item = document.createElement("div");
    item.className = "sidebar-item";
    item.dataset.index = i;
    item.innerHTML = `<span class="dot"></span><span>${lesson.title}</span>`;
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
  const pct = (completed.length / lessons.length) * 100;
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `${completed.length} / ${lessons.length}`;
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

btnRun.addEventListener("click", runCode);

btnReset.addEventListener("click", () => {
  editor.setValue(lessons[currentLesson].starterCode);
  outputEl.innerHTML = '<span class="output-empty">Run your code to see output here</span>';
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
  if (currentLesson < lessons.length - 1) renderLesson(currentLesson + 1);
});

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || e.target.closest("#editor-container")) return;
  if (e.key === "ArrowLeft" && currentLesson > 0) renderLesson(currentLesson - 1);
  if (e.key === "ArrowRight" && currentLesson < lessons.length - 1) renderLesson(currentLesson + 1);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    await Promise.all([initPyodide(), initMonaco()]);
    buildSidebar();
    updateProgress();
    renderLesson(0);
    btnRun.disabled = false;
    loadingEl.classList.add("hidden");
    setTimeout(() => loadingEl.remove(), 500);
  } catch (err) {
    loadingText.textContent = `Failed to load: ${err.message}`;
    console.error(err);
  }
}

boot();
