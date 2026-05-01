"""
agentu_mock — stripped-down agentu that runs in Pyodide (browser WASM).

Covers: Agent, Tool, ToolPermission, memory, cache, guardrails,
workflows (>> and &), evaluate, observe.

No subprocess, no network, no real LLM. Deterministic and self-contained.
"""

import asyncio
import hashlib
import inspect
import json
import time
import sqlite3
from enum import Enum
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


# ---------------------------------------------------------------------------
# Tool permissions
# ---------------------------------------------------------------------------

class ToolPermission(Enum):
    READONLY = "readonly"
    WRITE = "write"
    DANGEROUS = "dangerous"


# ---------------------------------------------------------------------------
# Tool wrapper
# ---------------------------------------------------------------------------

@dataclass
class Tool:
    func: Callable
    name: str = ""
    description: str = ""
    permission: ToolPermission = ToolPermission.READONLY

    def __post_init__(self):
        if not self.name:
            self.name = self.func.__name__
        if not self.description:
            self.description = (self.func.__doc__ or "").strip()

    def get_schema(self) -> dict:
        sig = inspect.signature(self.func)
        params = {}
        for pname, p in sig.parameters.items():
            ptype = "string"
            if p.annotation == int:
                ptype = "integer"
            elif p.annotation == float:
                ptype = "number"
            elif p.annotation == bool:
                ptype = "boolean"
            params[pname] = {"type": ptype}
        return {
            "name": self.name,
            "description": self.description,
            "parameters": params,
        }


# ---------------------------------------------------------------------------
# Observer
# ---------------------------------------------------------------------------

class Observer:
    def __init__(self, output="console"):
        self.output = output
        self.events: list[dict] = []
        self._start_time = time.time()

    def log(self, event_type: str, data: dict | None = None):
        event = {
            "type": event_type,
            "timestamp": time.time() - self._start_time,
            **(data or {}),
        }
        self.events.append(event)
        if self.output == "console":
            print(f"[observe] {event_type}: {json.dumps(data or {})}")

    def get_metrics(self) -> dict:
        tool_calls = sum(1 for e in self.events if e["type"] == "tool_call")
        errors = sum(1 for e in self.events if e["type"] == "error")
        duration = (time.time() - self._start_time) * 1000
        return {
            "tool_calls": tool_calls,
            "errors": errors,
            "total_duration_ms": round(duration, 1),
            "total_events": len(self.events),
        }


observe = Observer(output="silent")

def configure_observe(output="console"):
    global observe
    observe = Observer(output=output)


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

class Memory:
    def __init__(self):
        self._db = sqlite3.connect(":memory:")
        self._db.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                importance REAL DEFAULT 0.5,
                created_at REAL DEFAULT (strftime('%s','now'))
            )
        """)
        self._db.commit()

    def remember(self, content: str, importance: float = 0.5):
        self._db.execute(
            "INSERT INTO memories (content, importance) VALUES (?, ?)",
            (content, importance),
        )
        self._db.commit()

    def recall(self, query: str = "", limit: int = 5) -> list[dict]:
        if query:
            rows = self._db.execute(
                "SELECT content, importance FROM memories WHERE content LIKE ? ORDER BY importance DESC LIMIT ?",
                (f"%{query}%", limit),
            ).fetchall()
        else:
            rows = self._db.execute(
                "SELECT content, importance FROM memories ORDER BY importance DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [{"content": r[0], "importance": r[1]} for r in rows]

    def clear(self):
        self._db.execute("DELETE FROM memories")
        self._db.commit()


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

class Cache:
    def __init__(self, preset="basic", ttl=3600):
        self.preset = preset
        self.ttl = ttl
        self._store: dict[str, tuple[str, float]] = {}

    def _hash(self, prompt, namespace="default"):
        key = f"{namespace}:{prompt}"
        return hashlib.sha256(key.encode()).hexdigest()

    def get(self, prompt, namespace="default"):
        h = self._hash(prompt if isinstance(prompt, str) else json.dumps(prompt), namespace)
        if h in self._store:
            value, ts = self._store[h]
            if time.time() - ts < self.ttl:
                return value
            del self._store[h]
        return None

    def set(self, prompt, namespace, value):
        h = self._hash(prompt if isinstance(prompt, str) else json.dumps(prompt), namespace)
        self._store[h] = (value, time.time())

    def stats(self):
        return {"entries": len(self._store), "preset": self.preset}


# ---------------------------------------------------------------------------
# Guardrails
# ---------------------------------------------------------------------------

class Guardrail:
    name: str = "base"
    def check(self, output: str) -> tuple[bool, str]:
        return True, ""


class NoPII(Guardrail):
    name = "NoPII"
    PII_PATTERNS = ["@", "555-", "SSN", "social security", "credit card"]

    def check(self, output: str) -> tuple[bool, str]:
        for pattern in self.PII_PATTERNS:
            if pattern.lower() in output.lower():
                return False, f"PII detected: contains '{pattern}'"
        return True, ""


class NoHallucination(Guardrail):
    name = "NoHallucination"
    HALLUCINATION_PHRASES = ["as an ai", "i don't have access", "i cannot"]

    def check(self, output: str) -> tuple[bool, str]:
        for phrase in self.HALLUCINATION_PHRASES:
            if phrase in output.lower():
                return False, f"Hallucination pattern: '{phrase}'"
        return True, ""


# ---------------------------------------------------------------------------
# Mock LLM
# ---------------------------------------------------------------------------

class MockLLM:
    """Deterministic mock LLM for codelab exercises."""

    def __init__(self, responses=None):
        self._responses = responses or ["I found the answer for you."]
        self._index = 0
        self._correction_count = 0

    async def complete(self, messages, tools=None):
        response = self._responses[self._index % len(self._responses)]
        self._index += 1
        # If tools are available and prompt mentions a tool name, simulate tool call
        if tools:
            user_msg = messages[-1].get("content", "") if messages else ""
            for tool in tools:
                if tool["name"].lower() in user_msg.lower():
                    return {
                        "type": "tool_call",
                        "tool": tool["name"],
                        "arguments": {},
                        "content": response,
                    }
        return {"type": "text", "content": response}

    def correct(self, violation: str):
        """Simulate self-correction by moving to next response."""
        self._correction_count += 1
        self._index += 1


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class Agent:
    def __init__(self, name: str, model: str = "mock", **kwargs):
        self.name = name
        self.model = model
        self._tools: dict[str, Tool] = {}
        self._memory = Memory()
        self._cache: Cache | None = None
        self._guardrails: list[Guardrail] = []
        self._max_corrections = 2
        self._allow_dangerous = False
        self._observer = Observer(output="silent")
        self._llm = MockLLM()
        self._rules: str = ""

    @property
    def observer(self):
        return self._observer

    # -- Builder methods --

    def with_tools(self, tools=None, defer=None):
        for t in (tools or []):
            if isinstance(t, Tool):
                self._tools[t.name] = t
            elif callable(t):
                tool = Tool(func=t)
                self._tools[tool.name] = tool
        # defer just adds them the same way in the mock
        for t in (defer or []):
            if isinstance(t, Tool):
                self._tools[t.name] = t
            elif callable(t):
                tool = Tool(func=t)
                self._tools[tool.name] = tool
        return self

    def with_sandbox(self, read_tools=None, write_tools=None, timeout=10):
        for t in (read_tools or []):
            tool = Tool(func=t, permission=ToolPermission.READONLY) if callable(t) else t
            self._tools[tool.name] = tool
        for t in (write_tools or []):
            tool = Tool(func=t, permission=ToolPermission.WRITE) if callable(t) else t
            self._tools[tool.name] = tool
        return self

    def with_cache(self, preset="basic", **kwargs):
        self._cache = Cache(preset=preset, **kwargs)
        return self

    def with_guardrails(self, output_guardrails=None, max_corrections=2):
        self._guardrails = output_guardrails or []
        self._max_corrections = max_corrections
        return self

    def with_permissions(self, allow_dangerous=False):
        self._allow_dangerous = allow_dangerous
        return self

    def with_rules(self, rules_file: str):
        self._rules = f"[Rules loaded from {rules_file}]"
        return self

    def with_mock_responses(self, responses: list[str]):
        """Codelab helper: set deterministic LLM responses."""
        self._llm = MockLLM(responses)
        return self

    # -- Memory --

    def remember(self, content: str, importance: float = 0.5):
        self._memory.remember(content, importance)
        self._observer.log("memory_store", {"content": content[:50], "importance": importance})

    def recall(self, query: str = "", limit: int = 5) -> list[dict]:
        results = self._memory.recall(query, limit)
        self._observer.log("memory_recall", {"query": query, "results": len(results)})
        return results

    # -- Execution --

    async def call(self, tool_name: str, params: dict = None) -> Any:
        params = params or {}
        if tool_name not in self._tools:
            raise ValueError(f"Tool '{tool_name}' not found. Available: {list(self._tools.keys())}")

        tool = self._tools[tool_name]

        # Permission check
        if tool.permission == ToolPermission.DANGEROUS and not self._allow_dangerous:
            self._observer.log("tool_blocked", {"tool": tool_name, "reason": "DANGEROUS permission"})
            raise PermissionError(f"Tool '{tool_name}' has DANGEROUS permission and is blocked. Use .with_permissions(allow_dangerous=True)")

        self._observer.log("tool_call", {"tool": tool_name, "params": params, "permission": tool.permission.value})

        try:
            result = tool.func(**params)
            if asyncio.iscoroutine(result):
                result = await result
            self._observer.log("tool_result", {"tool": tool_name, "success": True})
            return result
        except Exception as e:
            self._observer.log("error", {"tool": tool_name, "error": str(e)})
            raise

    async def infer(self, prompt: str) -> Any:
        """LLM-routed execution (mock in codelab)."""
        self._observer.log("inference_start", {"prompt": prompt[:80]})

        # Check cache
        if self._cache:
            cached = self._cache.get(prompt, self.name)
            if cached:
                self._observer.log("cache_hit", {"prompt": prompt[:40]})
                return cached

        # Build messages
        messages = []
        if self._rules:
            messages.append({"role": "system", "content": self._rules})
        messages.append({"role": "user", "content": prompt})

        # Get tool schemas
        tool_schemas = [t.get_schema() for t in self._tools.values()]

        # Call mock LLM
        response = await self._llm.complete(messages, tools=tool_schemas)

        result = response.get("content", "")

        # If it's a tool call, execute it
        if response.get("type") == "tool_call":
            tool_name = response["tool"]
            args = response.get("arguments", {})
            try:
                result = await self.call(tool_name, args)
            except Exception as e:
                result = f"Tool error: {e}"

        # Apply guardrails
        for attempt in range(self._max_corrections + 1):
            all_passed = True
            for guard in self._guardrails:
                passed, violation = guard.check(str(result))
                if not passed:
                    all_passed = False
                    self._observer.log("self_correction", {
                        "guardrail": guard.name,
                        "violation": violation,
                        "attempt": attempt + 1,
                    })
                    self._llm.correct(violation)
                    response = await self._llm.complete(messages, tools=tool_schemas)
                    result = response.get("content", "")
                    break
            if all_passed:
                break

        # Cache result
        if self._cache:
            self._cache.set(prompt, self.name, result)

        self._observer.log("inference_end", {"result_length": len(str(result))})
        return result

    # -- Workflow support --

    def __call__(self, prompt: str) -> "WorkflowStep":
        return WorkflowStep(self, prompt)

    # -- Info --

    def list_tools(self) -> list[dict]:
        return [t.get_schema() for t in self._tools.values()]


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------

class WorkflowStep:
    def __init__(self, agent: Agent, prompt: str):
        self.agent = agent
        self.prompt = prompt
        self._transform = None

    def __rshift__(self, other):
        """Sequential: step1 >> step2"""
        if isinstance(other, WorkflowStep):
            return SequentialWorkflow([self, other])
        elif isinstance(other, SequentialWorkflow):
            other.steps.insert(0, self)
            return other
        return NotImplemented

    def __and__(self, other):
        """Parallel: step1 & step2"""
        if isinstance(other, WorkflowStep):
            return ParallelWorkflow([self, other])
        elif isinstance(other, ParallelWorkflow):
            other.steps.append(self)
            return other
        return NotImplemented

    async def run(self, prev_result=None):
        prompt = self.prompt
        if callable(prompt):
            prompt = prompt(prev_result)
        return await self.agent.infer(prompt)


class SequentialWorkflow:
    def __init__(self, steps: list):
        self.steps = steps

    def __rshift__(self, other):
        if isinstance(other, WorkflowStep):
            self.steps.append(other)
            return self
        elif isinstance(other, SequentialWorkflow):
            self.steps.extend(other.steps)
            return self
        return NotImplemented

    async def run(self, checkpoint=None, workflow_id=None):
        result = None
        for i, step in enumerate(self.steps):
            print(f"  Step {i+1}/{len(self.steps)}: {step.agent.name}")
            result = await step.run(prev_result=result)
        return result


class ParallelWorkflow:
    def __init__(self, steps: list):
        self.steps = steps

    def __and__(self, other):
        if isinstance(other, WorkflowStep):
            self.steps.append(other)
            return self
        return NotImplemented

    def __rshift__(self, other):
        if isinstance(other, WorkflowStep):
            return SequentialWorkflow([self, other])
        return NotImplemented

    async def run(self, checkpoint=None, workflow_id=None):
        results = []
        for step in self.steps:
            r = await step.run()
            results.append(r)
        print(f"  Parallel: {len(self.steps)} steps completed")
        return results


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

@dataclass
class EvalFailure:
    query: str
    expected: Any
    actual: Any
    reason: str


@dataclass
class EvalResults:
    total: int = 0
    passed: int = 0
    accuracy: float = 0.0
    avg_turns: float = 1.0
    duration: float = 0.0
    failures: list = field(default_factory=list)

    def __repr__(self):
        status = "PASS" if self.accuracy == 100 else "PARTIAL"
        return f"EvalResults({status}: {self.passed}/{self.total} passed, {self.accuracy}% accuracy, {self.duration:.2f}s)"

    def to_json(self):
        return json.dumps({
            "total": self.total,
            "passed": self.passed,
            "accuracy": self.accuracy,
            "duration": self.duration,
            "failures": [
                {"query": f.query, "expected": str(f.expected), "actual": str(f.actual), "reason": f.reason}
                for f in self.failures
            ],
        }, indent=2)


async def evaluate(agent: Agent, test_cases: list[dict], use_llm_judge=False) -> EvalResults:
    start = time.time()
    results = EvalResults(total=len(test_cases))

    for case in test_cases:
        query = case["ask"]
        expected = case["expect"]
        validator = case.get("validator")
        expect_tool = case.get("expect_tool")

        try:
            actual = await agent.infer(query)

            if validator:
                passed = validator(expected, actual)
            elif isinstance(expected, (int, float)):
                passed = actual == expected or str(expected) in str(actual)
            else:
                passed = str(expected).lower() in str(actual).lower()

            if passed:
                results.passed += 1
            else:
                results.failures.append(EvalFailure(
                    query=query, expected=expected, actual=actual,
                    reason=f"Expected '{expected}', got '{actual}'",
                ))
        except Exception as e:
            results.failures.append(EvalFailure(
                query=query, expected=expected, actual=None,
                reason=f"Error: {e}",
            ))

    results.duration = time.time() - start
    results.accuracy = round((results.passed / results.total) * 100, 1) if results.total else 0
    return results


# ---------------------------------------------------------------------------
# Convenience: make 'from agentu import ...' work in codelab
# ---------------------------------------------------------------------------

# Aliases so codelab code uses real import names
__all__ = [
    "Agent", "Tool", "ToolPermission",
    "NoPII", "NoHallucination",
    "evaluate", "EvalResults",
    "observe", "configure_observe",
    "Memory", "Cache",
]
