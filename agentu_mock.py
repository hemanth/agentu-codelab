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
import uuid
import sqlite3
from enum import Enum
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol, runtime_checkable


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
    permission: ToolPermission = ToolPermission.WRITE
    reads_private: bool = False
    ingests_untrusted: bool = False
    communicates_externally: bool = False

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

    def remember(self, content: str, importance: float = 0.5,
                  memory_type: str = "fact", entities: list = None,
                  topics: list = None, source: str = None,
                  summary: str = None, consolidated: bool = False, **kwargs):
        self._db.execute(
            "INSERT INTO memories (content, importance) VALUES (?, ?)",
            (content, importance),
        )
        self._db.commit()

    def recall(self, query: str = "", limit: int = 5,
               memory_type: str = None, include_short_term: bool = False,
               **kwargs) -> list[dict]:
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
        return [{"content": r[0], "importance": r[1], "entities": [], "topics": []} for r in rows]

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
    def __init__(self, name: str, model: str = "mock", codemode: bool = False,
                 enable_rationale_recording: bool = False,
                 enable_memory: bool = False,
                 auto_extract_memory: bool = True, **kwargs):
        self.name = name
        self.model = model
        self.memory_enabled = enable_memory
        self.auto_extract_memory = auto_extract_memory
        self.system_prompt = kwargs.get("system_prompt", "")
        self.temperature = kwargs.get("temperature", 1.0)
        self.context = ""
        self._tools: dict[str, Tool] = {}
        self._memory = Memory()
        self._cache: Cache | None = None
        self._guardrails: list[Guardrail] = []
        self._max_corrections = 2
        self._allow_dangerous = False
        self._observer = Observer(output="silent")
        self._llm = MockLLM()
        self._rules: str = ""
        self._codemode = codemode
        self._hooks: dict = {"pre_tool": None, "post_tool": None, "on_stop": None}
        self._context_config: "ContextConfig | None" = None
        self._schedule_config: "ScheduleConfig | None" = None
        self._scheduler: "Scheduler | None" = None
        self._subagent_configs: list = []
        self._child_agents: list = []
        self._worktree: "WorktreeManager | None" = None
        self._otel_config: dict | None = None
        self._backend: Any = None
        self._vectors_path: str | None = None
        self._inbox_path: str | None = None
        self._inbox_poll_interval: int = 10
        self._enable_rationale_recording = enable_rationale_recording
        if enable_rationale_recording:
            self._setup_rationale_tool()

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
        # Deferred tools are registered with a search_tools function
        self._deferred_tools = []
        for t in (defer or []):
            if isinstance(t, Tool):
                self._tools[t.name] = t
                self._deferred_tools.append(t)
            elif callable(t):
                tool = Tool(func=t)
                self._tools[tool.name] = tool
                self._deferred_tools.append(tool)
        if defer:
            self._add_search_tool()
        return self

    def _add_search_tool(self):
        """Add a tool-search function for deferred tools."""
        deferred = self._deferred_tools
        def search_tools(query: str) -> str:
            """Search through available deferred tools by name/description."""
            matches = []
            for t in deferred:
                q = query.lower()
                if q in t.name.lower() or q in t.description.lower():
                    matches.append({"name": t.name, "description": t.description})
            if not matches:
                # Fallback: return all deferred tools
                matches = [{"name": t.name, "description": t.description} for t in deferred]
            return json.dumps(matches, indent=2)
        self._tools["search_tools"] = Tool(func=search_tools)

    def _setup_rationale_tool(self):
        """Add a record_rationale tool for rationale recording."""
        memory = self._memory
        def record_rationale(rationale: str) -> str:
            """Record the agent's rationale for its decisions."""
            memory.remember(f"[rationale] {rationale}", importance=0.8)
            return f"Rationale recorded: {rationale[:60]}..."
        self._tools["record_rationale"] = Tool(func=record_rationale)

    def record_rationale(self, action: str, reasoning: str = "", alternatives: list = None):
        """Record a rationale entry directly."""
        entry = f"[rationale] Action: {action}"
        if reasoning:
            entry += f" | Reasoning: {reasoning}"
        if alternatives:
            entry += f" | Alternatives: {', '.join(alternatives)}"
        self._memory.remember(entry, importance=0.8)
        self._observer.log("rationale_recorded", {"action": action[:60]})

    def with_codemode(self):
        """Enable code generation mode."""
        self._codemode = True
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
        self.cache_enabled = True
        return self

    def with_guardrails(self, output_guardrails=None, max_corrections=2):
        self._guardrails = output_guardrails or []
        self._max_corrections = max_corrections
        return self

    def with_permissions(self, allow_dangerous=False):
        self._allow_dangerous = allow_dangerous
        return self

    def with_rules(self, rules_file: str):
        self.context = f"=== Project Rules ===\n# Project Rules\n- Always respond in JSON format\n- Never reveal API keys or secrets\n- Keep responses under 200 words\n- Use metric units only\n=== End Rules ==="
        self._rules = rules_file
        return self

    def set_context(self, context: str):
        self.context = context

    def use_middleware(self, middleware_list: list):
        """Add middleware to the processing pipeline."""
        self._middleware_stack = []
        self._middleware_chain = True
        for mw in middleware_list:
            self._middleware_stack.append(f"<Middleware: {mw}>")
        return self

    def with_notifier(self, targets: list = None, title: str = None):
        """Add notification middleware."""
        self._middleware_chain = True
        self._middleware_stack = getattr(self, '_middleware_stack', [])
        self._middleware_stack.append(f"<NotifyMiddleware: {title or 'default'}>")
        return self

    def with_mock_responses(self, responses: list[str]):
        """Codelab helper: set deterministic LLM responses."""
        self._llm = MockLLM(responses)
        return self

    def with_agents(self, agents: list) -> "Agent":
        """Give this agent access to other agents as callable tools."""
        import asyncio as _asyncio

        for agent in agents:
            agent_name = getattr(agent, "name", str(agent))
            tool_names = ", ".join(t.name for t in agent._tools.values())
            agent_desc = (
                getattr(agent, "system_prompt", "") or
                f"Agent '{agent_name}' with tools: {tool_names}"
            )

            async def _call_agent(task: str, _agent=agent) -> str:
                return await _agent.infer(task)

            _call_agent.__name__ = f"call_{agent_name}"
            _call_agent.__doc__ = (
                f"Delegate a task to the {agent_name} agent.\n\n"
                f"{agent_desc}\n\n"
                f"Args:\n    task: What to ask {agent_name} to do."
            )
            tool = Tool(func=_call_agent)
            self._tools[tool.name] = tool

        self._child_agents.extend(agents)
        return self

    def with_consolidation(self, every: int = 30) -> "Agent":
        """Enable background memory consolidation."""
        def consolidate_memories(insight: str, related_topics: list = None,
                                  source_summaries: list = None) -> dict:
            """Consolidate memories into a high-importance insight."""
            self._memory.remember(
                f"[consolidated] {insight}",
                importance=0.95,
                memory_type="consolidation",
            )
            return {"status": "consolidated", "insight": insight}

        tool = Tool(func=consolidate_memories)
        self._tools[tool.name] = tool
        return self

    def with_inbox(self, path: str, poll_interval: int = 10) -> "Agent":
        """Watch a directory for incoming files."""
        self._inbox_path = path
        self._inbox_poll_interval = poll_interval
        return self

    async def with_plugins(self, plugins) -> "Agent":
        """Load one or more Agent Plugins (v1.0.0 spec) in mock environment."""
        self._plugins = getattr(self, "_plugins", [])
        if isinstance(plugins, (list, tuple)):
            self._plugins.extend(plugins)
        else:
            self._plugins.append(plugins)
        return self

    async def with_plugin(self, plugins) -> "Agent":
        """Alias for `with_plugins()`."""
        return await self.with_plugins(plugins)

    async def _poll_inbox(self):
        """Poll inbox once (stub for codelab)."""
        import os
        if not self._inbox_path:
            return
        processed_dir = os.path.join(self._inbox_path, ".processed")
        os.makedirs(processed_dir, exist_ok=True)
        for fname in os.listdir(self._inbox_path):
            fpath = os.path.join(self._inbox_path, fname)
            if os.path.isfile(fpath):
                content = open(fpath).read()
                self._memory.remember(f"[inbox] {fname}: {content[:200]}", importance=0.7)
                os.rename(fpath, os.path.join(processed_dir, fname))

    # -- Memory --

    def remember(self, content: str, importance: float = 0.5,
                  memory_type: str = "fact", entities: list = None,
                  topics: list = None, source: str = None,
                  summary: str = None, **kwargs):
        self._memory.remember(content, importance, memory_type=memory_type,
                              entities=entities, topics=topics, source=source)
        self._observer.log("memory_store", {"content": content[:50], "importance": importance})

    def recall(self, query: str = "", limit: int = 5,
               memory_type: str = None, include_short_term: bool = False) -> list[dict]:
        results = self._memory.recall(query, limit)
        self._observer.log("memory_recall", {"query": query, "results": len(results)})
        return results

    def get_memory_stats(self) -> dict:
        """Return memory usage stats."""
        all_mems = self._memory.recall(limit=1000)
        return {"short_term_size": 0, "long_term_size": len(all_mems)}

    # -- Execution --

    async def run(self, prompt: str = "") -> str:
        """Run agent with a prompt (simulates LLM call)."""
        self._observer.log("run", {"prompt": prompt[:80]})
        result = await self._llm.complete([{"role": "user", "content": prompt}])
        return result

    async def call(self, tool_name: str, params: dict = None) -> Any:
        params = params or {}
        if tool_name not in self._tools:
            raise ValueError(f"Tool '{tool_name}' not found. Available: {list(self._tools.keys())}")

        tool = self._tools[tool_name]

        # Permission check
        if tool.permission == ToolPermission.DANGEROUS and not self._allow_dangerous:
            self._observer.log("tool_blocked", {"tool": tool_name, "reason": "DANGEROUS permission"})
            raise PermissionError(f"Tool '{tool_name}' has DANGEROUS permission and is blocked. Use .with_permissions(allow_dangerous=True)")

        # Pre-tool hook — call with (tool_name, params) or (tool_name, params, context)
        if self._hooks.get("pre_tool"):
            hook_fn = self._hooks["pre_tool"]
            sig = inspect.signature(hook_fn)
            n_params = len(sig.parameters)
            context = {"agent": self.name, "call_count": len(self._observer.events)}
            if n_params >= 3:
                hook_result = hook_fn(tool_name, params, context)
            else:
                hook_result = hook_fn(tool_name, params)
            if asyncio.iscoroutine(hook_result):
                hook_result = await hook_result
            if isinstance(hook_result, HookResult) and hook_result.action == HookAction.DENY:
                self._observer.log("hook_deny", {"tool": tool_name, "reason": hook_result.reason or "denied by pre_tool hook"})
                return f"Tool '{tool_name}' denied by hook: {hook_result.reason or 'no reason'}"
            elif isinstance(hook_result, HookResult) and hook_result.action == HookAction.MODIFY:
                if hook_result.modified_params:
                    params = hook_result.modified_params

        self._observer.log("tool_call", {"tool": tool_name, "params": params, "permission": tool.permission.value})

        try:
            result = tool.func(**params)
            if asyncio.iscoroutine(result):
                result = await result
            self._observer.log("tool_result", {"tool": tool_name, "success": True})

            # Post-tool hook — call with (tool_name, params, result) or (tool_name, result)
            if self._hooks.get("post_tool"):
                post_fn = self._hooks["post_tool"]
                post_sig = inspect.signature(post_fn)
                if len(post_sig.parameters) >= 3:
                    post_result = post_fn(tool_name, params, result)
                else:
                    post_result = post_fn(tool_name, result)
                if asyncio.iscoroutine(post_result):
                    post_result = await post_result
                if post_result is not None:
                    result = post_result

            return result
        except Exception as e:
            self._observer.log("error", {"tool": tool_name, "error": str(e)})
            raise

    async def infer(self, prompt: str, output_type: Any = None, images: list = None) -> Any:
        """LLM-routed execution (mock in codelab)."""
        # OTel span tracking
        if self._otel_config:
            self._observer.log("otel_span_start", {
                "service": self._otel_config.get("service_name", "unknown"),
                "span": "infer",
                "prompt_length": len(prompt),
            })

        self._observer.log("inference_start", {"prompt": prompt[:80]})

        # Multi-modal: build content parts if images provided
        if images:
            parts = build_content_parts(prompt, images)
            self._observer.log("multimodal", {"text_parts": 1, "image_parts": len(images)})

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

            # Code mode: wrap tool call in code block
            if self._codemode:
                code = f"result = {tool_name}({', '.join(f'{k}={v!r}' for k, v in args.items())})"
                try:
                    tool_result = await self.call(tool_name, args)
                except Exception as e:
                    tool_result = f"Error: {e}"
                result = {
                    "tool_used": tool_name,
                    "code": code,
                    "parameters": {"code": code},
                    "result": tool_result,
                    "tools_called": [tool_name],
                }
                self._observer.log("inference_end", {"result_length": len(str(result)), "codemode": True})
                return result

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

        # Structured output: parse and validate
        if output_type is not None:
            result = StructuredOutput.parse(result, output_type)

        # Cache result
        if self._cache:
            self._cache.set(prompt, self.name, result)

        self._observer.log("inference_end", {"result_length": len(str(result))})

        # OTel span end
        if self._otel_config:
            self._observer.log("otel_span_end", {
                "service": self._otel_config.get("service_name", "unknown"),
                "span": "infer",
            })

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
            name = step.agent.name if hasattr(step, 'agent') else f"parallel({len(step.steps)} steps)"
            print(f"  Step {i+1}/{len(self.steps)}: {name}")
            if isinstance(step, ParallelWorkflow):
                result = await step.run()
            else:
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
# Skills
# ---------------------------------------------------------------------------

class Skill:
    """Progressive-loading domain skill."""
    def __init__(self, name: str, description: str, instructions=None, resources=None):
        self.name = name
        self.description = description
        self._instructions = instructions if isinstance(instructions, str) else f"[Instructions for {name}]"
        self._resources = {}
        if resources:
            for k, v in resources.items():
                self._resources[k] = v if isinstance(v, str) else f"[Resource: {k}]"

    def load_instructions(self) -> str:
        return self._instructions

    def load_resource(self, name: str) -> str:
        if name not in self._resources:
            raise KeyError(f"Resource '{name}' not found. Available: {list(self._resources.keys())}")
        return self._resources[name]

    def list_resources(self) -> list[str]:
        return list(self._resources.keys())


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

class Session:
    """Stateful conversation session."""
    def __init__(self, agent: "Agent", session_id: str, metadata: dict = None):
        self.agent = agent
        self.session_id = session_id
        self.metadata = metadata or {}
        self.turn_count = 0
        self._history: list[dict] = []
        self._checkpoints: dict[str, dict] = {}

    async def send(self, message: str) -> dict:
        self.turn_count += 1
        self._history.append({"role": "user", "content": message, "turn": self.turn_count})
        result = await self.agent.infer(message)
        self._history.append({"role": "assistant", "content": str(result), "turn": self.turn_count})
        return {
            "result": result,
            "session_info": {
                "session_id": self.session_id,
                "turn": self.turn_count,
                "memory_stats": {"entries": len(self.agent._memory.recall())},
            },
        }

    def get_history(self, limit: int = 10) -> list:
        @dataclass
        class Entry:
            content: str
            role: str
        return [Entry(content=h["content"], role=h["role"]) for h in self._history[-limit:]]

    def checkpoint(self, fork: bool = False):
        """Save a checkpoint of the current session state. If fork=True, create and return a new Session."""
        cp_id = f"cp_{self.session_id}_{self.turn_count}_{uuid.uuid4().hex[:6]}"
        snapshot = {
            "session_id": self.session_id,
            "turn_count": self.turn_count,
            "history": list(self._history),
            "metadata": dict(self.metadata),
        }
        self._checkpoints[cp_id] = snapshot
        CheckpointStore._global_store[cp_id] = snapshot
        if fork:
            fork_id = f"fork_{cp_id}"
            fork_session = Session(
                agent=self.agent,
                session_id=fork_id,
                metadata={**self.metadata, "forked_from": self.session_id},
            )
            fork_session.turn_count = self.turn_count
            fork_session._history = list(self._history)
            fork_snapshot = {
                "session_id": fork_id,
                "turn_count": self.turn_count,
                "history": list(self._history),
                "metadata": fork_session.metadata,
            }
            CheckpointStore._global_store[fork_id] = fork_snapshot
            return fork_session
        return cp_id


class SessionManager:
    """Manages multiple concurrent sessions."""
    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._counter = 0

    def create_session(self, agent: "Agent", metadata: dict = None) -> Session:
        self._counter += 1
        sid = f"session_{self._counter:04d}"
        session = Session(agent=agent, session_id=sid, metadata=metadata)
        self._sessions[sid] = session
        return session

    def get_session(self, session_id: str) -> Session:
        if session_id not in self._sessions:
            raise KeyError(f"Session '{session_id}' not found")
        return self._sessions[session_id]

    def list_sessions(self) -> list[str]:
        return list(self._sessions.keys())

    def delete_session(self, session_id: str):
        self._sessions.pop(session_id, None)

    def save_all(self):
        pass  # No-op in codelab mock

    def resume(self, session_id: str, agent: "Agent") -> Session:
        """Resume a session from a checkpoint."""
        if session_id in self._sessions:
            return self._sessions[session_id]
        # Try loading from CheckpointStore
        snapshot = CheckpointStore._global_store.get(session_id)
        if snapshot:
            session = Session(agent=agent, session_id=session_id, metadata=snapshot.get("metadata", {}))
            session.turn_count = snapshot.get("turn_count", 0)
            session._history = list(snapshot.get("history", []))
            self._sessions[session_id] = session
            return session
        raise KeyError(f"Session or checkpoint '{session_id}' not found")


# ---------------------------------------------------------------------------
# Agent: add with_skills support
# ---------------------------------------------------------------------------

# Patch Agent to support skills and extended features
_original_init = Agent.__init__

def _patched_init(self, name, model="mock", **kwargs):
    _original_init(self, name, model, **kwargs)
    self._skills: list[Skill] = []
    self.tools = []  # alias for compatibility
    self._deferred_tools: list[Tool] = []

Agent.__init__ = _patched_init

def _with_skills(self, skills):
    self._skills = skills or []
    # Add get_skill_resource tool
    def get_skill_resource(skill_name: str, resource_name: str) -> str:
        """Load a resource from a skill."""
        for s in self._skills:
            if s.name == skill_name:
                return s.load_resource(resource_name)
        return f"Skill '{skill_name}' not found"
    self._tools["get_skill_resource"] = Tool(func=get_skill_resource)
    return self

Agent.with_skills = _with_skills


# ---------------------------------------------------------------------------
# MCP Integration (mock)
# ---------------------------------------------------------------------------

class MCPServer:
    """Mock MCP server connection."""
    def __init__(self, url_or_config: str):
        self.source = url_or_config
        self.connected = True
        # Simulate discovering tools from the MCP server
        if "filesystem" in url_or_config.lower() or "mcp_config" in url_or_config:
            self._tools = [
                {"name": "read_file", "description": "Read file contents"},
                {"name": "write_file", "description": "Write content to a file"},
                {"name": "list_directory", "description": "List directory contents"},
            ]
        elif "database" in url_or_config.lower():
            self._tools = [
                {"name": "query", "description": "Run a SQL query"},
                {"name": "insert", "description": "Insert a row"},
            ]
        elif "search" in url_or_config.lower():
            self._tools = [
                {"name": "web_search", "description": "Search the web"},
                {"name": "image_search", "description": "Search for images"},
            ]
        else:
            self._tools = [
                {"name": f"mcp_tool_{i}", "description": f"Tool from {url_or_config}"}
                for i in range(1, 4)
            ]

    def get_tools(self):
        return self._tools


def _with_mcp(self, servers):
    """Connect to MCP servers and import their tools."""
    self._mcp_servers = []
    for srv in (servers or []):
        # Support dict with url + headers (auth)
        if isinstance(srv, dict):
            url = srv.get("url", str(srv))
            headers = srv.get("headers", {})
            mcp = MCPServer(url)
            mcp.auth_headers = headers
        else:
            mcp = MCPServer(srv)
            mcp.auth_headers = {}
        self._mcp_servers.append(mcp)
        # Register discovered MCP tools
        for tool_info in mcp.get_tools():
            def _make_fn(name, desc):
                def fn(**kwargs):
                    return f"[MCP:{name}] executed with {kwargs}"
                fn.__name__ = name
                fn.__doc__ = desc
                return fn
            func = _make_fn(tool_info["name"], tool_info["description"])
            self._tools[tool_info["name"]] = Tool(func=func)
    return self

Agent.with_mcp = _with_mcp


# ---------------------------------------------------------------------------
# REST API / serve() (mock)
# ---------------------------------------------------------------------------

class AgentServer:
    """Mock agent server for codelab."""
    def __init__(self, agent, host="0.0.0.0", port=8000, **kwargs):
        self.agent = agent
        self.host = host
        self.port = port
        self.routes = {
            "GET  /":          "Agent info",
            "GET  /health":    "Health check",
            "GET  /tools":     "List tools",
            "POST /execute":   "Execute tool",
            "POST /process":   "LLM inference",
            "WS   /ws":        "WebSocket streaming",
            "POST /stream":    "SSE streaming",
            "GET  /dashboard": "Observability UI",
        }

    def describe(self):
        """Print route table."""
        print(f"agentu server: {self.agent.name}")
        print(f"  http://{self.host}:{self.port}\n")
        print("Routes:")
        for route, desc in self.routes.items():
            print(f"  {route:20s} {desc}")
        print(f"\nTools: {len(self.agent._tools)}")
        print(f"Transports: HTTP, WebSocket, SSE")

    def run(self):
        """In codelab, just prints the config instead of actually starting."""
        self.describe()
        print("\n[codelab] Server described (not actually started in browser)")


def serve(agent, host="0.0.0.0", port=8000, **kwargs):
    """Serve an agent as a REST API (mock in codelab)."""
    server = AgentServer(agent, host=host, port=port, **kwargs)
    server.run()
    return server


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------

class HookAction(Enum):
    ALLOW = "allow"
    DENY = "deny"
    MODIFY = "modify"


@dataclass
class HookResult:
    action: HookAction = HookAction.ALLOW
    reason: str = ""
    modified_params: dict | None = None


def _with_hooks(self, pre_tool=None, post_tool=None, on_stop=None):
    """Register lifecycle hooks on the agent."""
    self._hooks = {
        "pre_tool": pre_tool,
        "post_tool": post_tool,
        "on_stop": on_stop,
    }
    return self

Agent.with_hooks = _with_hooks


# ---------------------------------------------------------------------------
# Structured Outputs
# ---------------------------------------------------------------------------

class StructuredOutput:
    """Simple structured output parser for mock codelab."""

    @staticmethod
    def parse(result: Any, output_type: Any) -> Any:
        """Parse result into structured output type.

        If result is already a dict and output_type is a dataclass, try to construct it.
        Otherwise, attempt JSON parsing and field mapping.
        """
        # If result is already a dict, try constructing the output_type
        if isinstance(result, dict):
            data = result
        elif isinstance(result, str):
            # Try JSON parse
            try:
                data = json.loads(result)
            except (json.JSONDecodeError, TypeError):
                # Build a mock object from the type's fields
                data = {}
                if hasattr(output_type, '__dataclass_fields__'):
                    for fname, fld in output_type.__dataclass_fields__.items():
                        if fld.type == str or fld.type == 'str':
                            data[fname] = result[:100] if result else ""
                        elif fld.type == int or fld.type == 'int':
                            data[fname] = 0
                        elif fld.type == float or fld.type == 'float':
                            data[fname] = 0.0
                        elif fld.type == bool or fld.type == 'bool':
                            data[fname] = False
                        elif fld.type == list or fld.type == 'list':
                            data[fname] = []
                        else:
                            data[fname] = result
        else:
            data = {}

        # Try constructing the output_type
        if hasattr(output_type, '__dataclass_fields__'):
            try:
                fields = {k: data.get(k) for k in output_type.__dataclass_fields__ if k in data}
                return output_type(**fields)
            except Exception:
                pass
        # For non-dataclass types, return SimpleNamespace for attribute access
        import types as _types
        return _types.SimpleNamespace(**data) if isinstance(data, dict) and data else data


# ---------------------------------------------------------------------------
# Multi-modal Support
# ---------------------------------------------------------------------------

def detect_mime_type(source: str) -> str:
    """Detect MIME type from a file path or URL."""
    source_lower = source.lower()
    if source_lower.endswith(".png"):
        return "image/png"
    elif source_lower.endswith(".jpg") or source_lower.endswith(".jpeg"):
        return "image/jpeg"
    elif source_lower.endswith(".gif"):
        return "image/gif"
    elif source_lower.endswith(".webp"):
        return "image/webp"
    elif source_lower.endswith(".svg"):
        return "image/svg+xml"
    elif source_lower.endswith(".pdf"):
        return "application/pdf"
    elif source_lower.startswith("data:"):
        # data URI
        return source.split(";")[0].split(":")[1]
    return "application/octet-stream"


def resolve_image(source: str) -> dict:
    """Resolve an image source to a content part dict."""
    mime = detect_mime_type(source)
    if source.startswith("http://") or source.startswith("https://"):
        return {"type": "image_url", "url": source, "mime_type": mime}
    elif source.startswith("data:"):
        return {"type": "image_data", "data": source, "mime_type": mime}
    else:
        # Treat as file path (mock: just reference it)
        return {"type": "image_file", "path": source, "mime_type": mime}


def build_content_parts(text: str, images: list[str] = None) -> list[dict]:
    """Build multi-modal content parts from text and images."""
    parts = [{"type": "text", "text": text}]
    for img in (images or []):
        img_part = resolve_image(img)
        img_part.setdefault("type", "image_url")
        parts.append(img_part)
    return parts


# ---------------------------------------------------------------------------
# Safety: Lethal Trifecta + Spotlighting
# ---------------------------------------------------------------------------

@dataclass
class TrifectaReport:
    """Report from lethal trifecta safety check."""
    has_trifecta: bool = False
    reads_private_tools: list[str] = field(default_factory=list)
    ingests_untrusted_tools: list[str] = field(default_factory=list)
    communicates_externally_tools: list[str] = field(default_factory=list)
    message: str = ""
    risk_level: str = "low"
    recommendation: str = ""

    def __repr__(self):
        return f"TrifectaReport(has_trifecta={self.has_trifecta}, risk={self.risk_level}, flags=[R:{len(self.reads_private_tools)}, I:{len(self.ingests_untrusted_tools)}, C:{len(self.communicates_externally_tools)}])"


def check_lethal_trifecta(tools: list[Tool]) -> TrifectaReport:
    """Check if a set of tools forms the lethal trifecta:
    reads_private + ingests_untrusted + communicates_externally.
    """
    reads = [t.name for t in tools if t.reads_private]
    ingests = [t.name for t in tools if t.ingests_untrusted]
    communicates = [t.name for t in tools if t.communicates_externally]

    flags = sum([bool(reads), bool(ingests), bool(communicates)])
    has = flags == 3

    if flags == 3:
        risk = "critical"
        msg = ("LETHAL TRIFECTA detected — this agent's tool-set combines "
               f"private-data access ({', '.join(reads)}), "
               f"untrusted input ({', '.join(ingests)}), and "
               f"external communication ({', '.join(communicates)}). "
               "An indirect-prompt-injection attack could exfiltrate private data. "
               "Consider splitting these capabilities across separate agents.")
        rec = msg
    elif flags == 2:
        risk = "high"
        msg = "Two of three trifecta flags present. Review tool permissions carefully."
        rec = msg
    elif flags == 1:
        risk = "medium"
        msg = "One trifecta flag present. Generally safe but monitor usage."
        rec = msg
    else:
        risk = "low"
        msg = "No trifecta flags detected. Tool set appears safe."
        rec = msg

    return TrifectaReport(
        has_trifecta=has,
        reads_private_tools=reads,
        ingests_untrusted_tools=ingests,
        communicates_externally_tools=communicates,
        message=msg,
        risk_level=risk,
        recommendation=rec,
    )


def spotlight_untrusted(result: str) -> str:
    """Wrap untrusted content in spotlight tags to prevent injection."""
    return f"<untrusted_content>{result}</untrusted_content>"


# ---------------------------------------------------------------------------
# Context Management
# ---------------------------------------------------------------------------

@dataclass
class ContextConfig:
    """Configuration for context window management."""
    max_tokens: int = 128000
    compaction: str = "truncate"  # "truncate", "summarize", "sliding"
    reserve_output: int = 4096
    keep_recent: int = 5


def estimate_tokens(text: str) -> int:
    """Estimate token count for a string (~4 chars per token)."""
    return max(1, len(text) // 4)


async def compact_context(history: list[dict], config: ContextConfig) -> list[dict]:
    """Compact conversation history to fit within token budget."""
    budget = config.max_tokens - config.reserve_output
    total = sum(estimate_tokens(h.get("content", "")) for h in history)

    if total <= budget:
        return history

    if config.compaction == "truncate":
        # Keep system messages and recent messages, truncate old results
        compacted = []
        system_msgs = [h for h in history if h.get("role") == "system"]
        other_msgs = [h for h in history if h.get("role") != "system"]
        compacted.extend(system_msgs)

        # Keep last N messages that fit
        remaining = budget - sum(estimate_tokens(h.get("content", "")) for h in system_msgs)
        kept = []
        for msg in reversed(other_msgs):
            msg_tokens = estimate_tokens(msg.get("content", ""))
            if remaining >= msg_tokens:
                kept.insert(0, msg)
                remaining -= msg_tokens
            else:
                # Truncate this message
                truncated_content = msg.get("content", "")[:remaining * 4]
                kept.insert(0, {**msg, "content": f"[truncated] {truncated_content}..."})
                break

        compacted.extend(kept)
        return compacted

    elif config.compaction == "summarize":
        # Mock: keep first and last, summarize middle
        if len(history) <= 2:
            return history
        summary = {"role": "system", "content": f"[Summary of {len(history) - 2} previous messages]"}
        return [history[0], summary, history[-1]]

    elif config.compaction == "sliding":
        # Keep only last N messages that fit
        kept = []
        remaining = budget
        for msg in reversed(history):
            tokens = estimate_tokens(msg.get("content", ""))
            if remaining >= tokens:
                kept.insert(0, msg)
                remaining -= tokens
            else:
                break
        return kept

    return history


def _with_context(self, max_tokens=128000, compaction="truncate"):
    """Configure context window management."""
    self._context_config = ContextConfig(max_tokens=max_tokens, compaction=compaction)
    return self

Agent.with_context = _with_context


# ---------------------------------------------------------------------------
# Ralph Mode (autonomous loop)
# ---------------------------------------------------------------------------

async def _ralph(self, prompt_file: str = "", max_iterations: int = 5,
                 timeout_minutes: float = 30.0, on_iteration: Callable = None,
                 prompt: str = "") -> dict:
    """Run agent in autonomous 'ralph' loop.

    Simulates iterative task completion with checkpoint checking.
    """
    self._observer.log("ralph_start", {
        "prompt_file": prompt_file,
        "max_iterations": max_iterations,
        "timeout_minutes": timeout_minutes,
    })

    prompt = prompt or prompt_file or "Complete the task."
    checkpoints = []
    iterations_done = 0
    stopped_by = "max_iterations"

    for i in range(max_iterations):
        iterations_done = i + 1
        self._observer.log("ralph_iteration", {"iteration": iterations_done})

        # Simulate work
        result = await self.infer(f"[iteration {iterations_done}] {prompt}")

        # Record checkpoint
        cp = f"checkpoint_{iterations_done}"
        checkpoints.append(cp)

        # Callback
        if on_iteration:
            on_iteration(iterations_done, result)

        # Simulate early completion: if the result contains 'complete' or 'done'
        if isinstance(result, str) and any(w in result.lower() for w in ["complete", "done", "finished"]):
            stopped_by = "task_complete"
            break

    self._observer.log("ralph_end", {
        "iterations": iterations_done,
        "stopped_by": stopped_by,
    })

    return {
        "iterations": iterations_done,
        "stopped_by": stopped_by,
        "checkpoints_completed": checkpoints,
        "prompt": prompt[:100],
    }

Agent.ralph = _ralph


# ---------------------------------------------------------------------------
# Scheduled Automations
# ---------------------------------------------------------------------------

@dataclass
class ScheduleConfig:
    """Configuration for scheduled agent runs."""
    every: str | None = None       # e.g. "5m", "1h", "daily"
    cron: str | None = None        # e.g. "0 9 * * 1-5"
    prompt: str = ""


@dataclass
class Finding:
    """A finding from a scheduled agent run."""
    timestamp: float
    content: str
    severity: str = "info"  # "info", "warning", "critical"
    run_id: int = 0


class Scheduler:
    """Mock scheduler for automated agent runs."""
    def __init__(self, agent: "Agent", config: ScheduleConfig = None):
        self.agent = agent
        self.config = config or getattr(agent, '_schedule_config', None) or ScheduleConfig()
        self.running = False
        self._findings: list[Finding] = []
        self._run_count = 0

    async def start(self):
        """Start the scheduled automation (mock: runs once immediately)."""
        self.running = True
        self._run_count += 1
        result = await self.agent.infer(self.config.prompt)
        self._findings.append(Finding(
            timestamp=time.time(),
            content=str(result),
            severity="info",
            run_id=self._run_count,
        ))
        self.agent._observer.log("schedule_run", {
            "run_id": self._run_count,
            "schedule": self.config.every or self.config.cron,
        })

    async def stop(self):
        """Stop the scheduled automation."""
        self.running = False
        self.agent._observer.log("schedule_stop", {"total_runs": self._run_count})

    def findings(self) -> list[Finding]:
        """Return all findings from scheduled runs."""
        return list(self._findings)


def _with_schedule(self, every=None, cron=None, prompt=""):
    """Configure scheduled automation."""
    self._schedule_config = ScheduleConfig(every=every, cron=cron, prompt=prompt)
    self._scheduler = Scheduler(self, self._schedule_config)
    return self


async def _agent_start(self):
    """Start scheduled automation."""
    if self._scheduler:
        await self._scheduler.start()


async def _agent_stop(self):
    """Stop scheduled automation."""
    if self._scheduler:
        await self._scheduler.stop()


def _agent_findings(self):
    """Get findings from scheduled runs."""
    if self._scheduler:
        return self._scheduler.findings()
    return []


Agent.with_schedule = _with_schedule
Agent.start = _agent_start
Agent.stop = _agent_stop
Agent.findings = _agent_findings


# ---------------------------------------------------------------------------
# Sub-agents (Maker-Checker)
# ---------------------------------------------------------------------------

@dataclass
class SubAgentConfig:
    """Configuration for a sub-agent."""
    name: str
    model: str = "mock"
    role: str = "worker"  # "worker", "judge", "specialist"
    instructions: str = ""


def _with_subagents(self, configs: list[SubAgentConfig]):
    """Configure sub-agents for maker-checker pattern."""
    self._subagent_configs = configs
    return self


async def _delegate(self, task: str, judges: int = 1) -> dict:
    """Delegate a task to sub-agents with maker-checker pattern."""
    self._observer.log("delegate_start", {"task": task[:80], "judges": judges})

    # Maker produces result
    maker_result = await self.infer(f"[maker] {task}")

    # Judges evaluate
    judgments = []
    for i in range(judges):
        judgment = {
            "judge": f"judge_{i+1}",
            "approved": True,
            "confidence": 0.85 + (i * 0.05),
            "feedback": f"Result looks correct for: {task[:40]}...",
        }
        judgments.append(judgment)

    approved = all(j["approved"] for j in judgments)
    self._observer.log("delegate_end", {"approved": approved, "judges": len(judgments)})

    return {
        "result": maker_result,
        "approved": approved,
        "judgments": judgments,
        "review": judgments[0]["feedback"] if judgments else "",
        "corrections": [] if approved else ["Revise the output based on judge feedback."],
    }


async def _best_of(self, n: int, prompt: str) -> dict:
    """Run N attempts and select the best result."""
    self._observer.log("best_of_start", {"n": n, "prompt": prompt[:80]})

    candidates = []
    for i in range(n):
        result = await self.infer(f"[attempt {i+1}/{n}] {prompt}")
        score = 0.7 + (i * 0.1)  # Mock scoring: later attempts score higher
        candidates.append({"attempt": i + 1, "result": result, "score": round(score, 2)})

    best = max(candidates, key=lambda c: c["score"])
    self._observer.log("best_of_end", {"best_attempt": best["attempt"], "best_score": best["score"]})

    return {
        "best": best,
        "candidates": candidates,
        "total_attempts": n,
    }


Agent.with_subagents = _with_subagents
Agent.delegate = _delegate
Agent.best_of = _best_of


# ---------------------------------------------------------------------------
# Worktree Isolation
# ---------------------------------------------------------------------------

class WorktreeManager:
    """Mock worktree manager for isolated agent workspaces."""
    def __init__(self, agent_name: str = "", base_path: str = "/tmp/worktrees",
                 branch: str = "main", cleanup: bool = True):
        self.agent_name = agent_name
        self.base_path = base_path
        self.branch = branch
        self.cleanup = cleanup
        self.worktree_id = f"wt_{agent_name or 'anon'}_{uuid.uuid4().hex[:8]}"
        self.created_at = time.time()
        self._files: dict[str, str] = {}
        self.active = True

    def create_file(self, path: str, content: str):
        self._files[path] = content

    def read_file(self, path: str) -> str:
        if path not in self._files:
            raise FileNotFoundError(f"File '{path}' not in worktree")
        return self._files[path]

    def list_files(self) -> list[str]:
        return list(self._files.keys())

    def cleanup_files(self):
        self._files.clear()
        self.active = False

    def __repr__(self):
        return f"WorktreeManager(id={self.worktree_id}, branch={self.branch}, files={len(self._files)}, active={self.active})"


def _with_worktree(self):
    """Enable worktree isolation for the agent."""
    self._worktree = WorktreeManager(agent_name=self.name)
    self._observer.log("worktree_created", {"worktree_id": self._worktree.worktree_id})
    return self

Agent.with_worktree = _with_worktree


# ---------------------------------------------------------------------------
# Declarative Config
# ---------------------------------------------------------------------------

@classmethod
def _from_config(cls, config_path_or_dict) -> "Agent":
    """Construct an Agent from a config dict or YAML-like string."""
    if isinstance(config_path_or_dict, dict):
        config = config_path_or_dict
    elif isinstance(config_path_or_dict, str):
        # Simple YAML-like parser (key: value per line)
        config = {}
        for line in config_path_or_dict.strip().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if ":" in line:
                key, value = line.split(":", 1)
                key = key.strip()
                value = value.strip()
                # Basic type coercion
                if value.lower() == "true":
                    value = True
                elif value.lower() == "false":
                    value = False
                elif value.isdigit():
                    value = int(value)
                config[key] = value
    else:
        raise TypeError(f"Expected dict or str, got {type(config_path_or_dict)}")

    name = config.pop("name", "agent")
    model = config.pop("model", "mock")
    agent = cls(name=name, model=model, **{k: v for k, v in config.items()
                                           if k in ("codemode", "enable_rationale_recording")})

    # Apply known config keys
    if "cache" in config:
        agent.with_cache(preset=config["cache"])
    if "max_tokens" in config:
        agent.with_context(max_tokens=int(config["max_tokens"]))
    if "rules" in config:
        agent.with_rules(config["rules"])

    return agent

Agent.from_config = _from_config


# ---------------------------------------------------------------------------
# Tool Search (SearchAgent for deferred tools)
# ---------------------------------------------------------------------------

class SearchAgent:
    """Agent specialized in searching through deferred tools."""
    def __init__(self, tools: list[Tool] = None):
        self._tools = tools or []

    def search_tool(self, query: str) -> list[dict]:
        """Search through tools by name/description similarity."""
        query_lower = query.lower()
        query_words = set(query_lower.split())
        results = []
        for t in self._tools:
            name_words = set(t.name.lower().replace("_", " ").split())
            desc_words = set(t.description.lower().split())
            all_words = name_words | desc_words
            overlap = len(query_words & all_words)
            # Also check substring match
            if query_lower in t.name.lower() or query_lower in t.description.lower():
                overlap += 2
            if overlap > 0:
                results.append({
                    "name": t.name,
                    "description": t.description,
                    "relevance": overlap,
                })
        results.sort(key=lambda r: r["relevance"], reverse=True)
        return results

    def add_tools(self, tools: list[Tool]):
        self._tools.extend(tools)


# ---------------------------------------------------------------------------
# Task Queue
# ---------------------------------------------------------------------------

class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TaskInfo:
    """Information about a queued task."""
    task_id: str
    prompt: str
    status: TaskStatus = TaskStatus.PENDING
    result: Any = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    completed_at: float | None = None


class TaskQueue:
    """Background task queue for agent work."""
    def __init__(self, max_concurrent: int = 5):
        self._tasks: dict[str, TaskInfo] = {}
        self._counter = 0
        self.max_concurrent = max_concurrent

    def submit(self, prompt) -> str:
        """Submit a task (string prompt or callable) and return its ID."""
        self._counter += 1
        task_id = f"task_{self._counter:04d}"
        prompt_str = prompt if isinstance(prompt, str) else f"<callable task {self._counter}>"
        self._tasks[task_id] = TaskInfo(task_id=task_id, prompt=prompt_str)
        self._tasks[task_id]._callable = prompt if callable(prompt) else None
        return task_id

    async def process(self, agent: "Agent", task_id: str) -> TaskInfo:
        """Process a single task."""
        if task_id not in self._tasks:
            raise KeyError(f"Task '{task_id}' not found")
        task = self._tasks[task_id]
        task.status = TaskStatus.RUNNING
        try:
            if hasattr(task, '_callable') and task._callable:
                result = task._callable()
                if asyncio.iscoroutine(result):
                    result = await result
                task.result = result
            else:
                task.result = await agent.infer(task.prompt)
            task.status = TaskStatus.COMPLETED
            task.completed_at = time.time()
        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error = str(e)
            task.completed_at = time.time()
        return task

    async def process_all(self, agent: "Agent") -> list[TaskInfo]:
        """Process all pending tasks."""
        results = []
        for task_id, task in list(self._tasks.items()):
            if task.status == TaskStatus.PENDING:
                results.append(await self.process(agent, task_id))
        return results

    async def get_status(self, task_id: str) -> TaskInfo:
        if task_id not in self._tasks:
            raise KeyError(f"Task '{task_id}' not found")
        return self._tasks[task_id]

    async def list_tasks(self, status: TaskStatus = None) -> list[TaskInfo]:
        if status:
            return [t for t in self._tasks.values() if t.status == status]
        return list(self._tasks.values())

    async def cancel(self, task_id: str):
        if task_id in self._tasks:
            self._tasks[task_id].status = TaskStatus.CANCELLED


# ---------------------------------------------------------------------------
# Session Checkpoint Store
# ---------------------------------------------------------------------------

class CheckpointStore:
    """Global store for session checkpoints."""
    _global_store: dict[str, dict] = {}

    @classmethod
    def save(cls, checkpoint_id: str, data: dict):
        cls._global_store[checkpoint_id] = data

    @classmethod
    def load(cls, checkpoint_id: str) -> dict:
        if checkpoint_id not in cls._global_store:
            raise KeyError(f"Checkpoint '{checkpoint_id}' not found")
        return cls._global_store[checkpoint_id]

    @classmethod
    def list_checkpoints(cls) -> list[str]:
        return list(cls._global_store.keys())

    @classmethod
    def clear(cls):
        cls._global_store.clear()


# ---------------------------------------------------------------------------
# OpenTelemetry (mock)
# ---------------------------------------------------------------------------

def _with_otel(self, service_name: str = "agentu", endpoint: str = "http://localhost:4318"):
    """Enable mock OpenTelemetry tracing."""
    self._otel_config = {
        "service_name": service_name,
        "endpoint": endpoint,
    }
    self._otel_enabled = True
    self._otel_service_name = service_name
    self._observer.log("otel_configured", {
        "service_name": service_name,
        "endpoint": endpoint,
    })
    return self


def _get_otel_spans(self) -> list[dict]:
    """Return collected OTel spans from observer events."""
    spans = []
    for e in self._observer.events:
        if e["type"].startswith("otel_"):
            spans.append(e)
        elif e["type"] in ("tool_call", "inference_start", "inference_end"):
            spans.append({
                "name": e["type"],
                "service": getattr(self, '_otel_service_name', 'agentu'),
                **e,
            })
    return spans


Agent.with_otel = _with_otel
Agent.get_otel_spans = _get_otel_spans


# ---------------------------------------------------------------------------
# Semantic Cache / SemanticIndex
# ---------------------------------------------------------------------------

class SemanticIndex:
    """Simple semantic index using word-overlap similarity."""
    def __init__(self):
        self._entries: list[tuple[str, Any]] = []

    def add(self, text: str, value: Any):
        self._entries.append((text, value))

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        """Search by word-overlap similarity."""
        query_words = set(query.lower().split())
        scored = []
        for text, value in self._entries:
            entry_words = set(text.lower().split())
            if not entry_words:
                continue
            overlap = len(query_words & entry_words)
            similarity = overlap / max(len(query_words | entry_words), 1)
            scored.append({"text": text, "value": value, "similarity": round(similarity, 3)})
        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return scored[:top_k]

    def clear(self):
        self._entries.clear()

    def __len__(self):
        return len(self._entries)


# Enhance Cache to support preset='smart' with semantic similarity
_original_cache_get = Cache.get

def _smart_cache_get(self, prompt, namespace="default"):
    # Try exact match first
    exact = _original_cache_get(self, prompt, namespace)
    if exact is not None:
        return exact
    # If preset is 'smart', try word-overlap similarity
    if self.preset == "smart":
        prompt_words = set(prompt.lower().split()) if isinstance(prompt, str) else set()
        best_match = None
        best_score = 0.0
        for key, (value, ts) in self._store.items():
            if time.time() - ts >= self.ttl:
                continue
            # We can't reverse the hash, so store prompts separately
            if hasattr(self, '_prompt_map') and key in self._prompt_map:
                stored_prompt = self._prompt_map[key]
                stored_words = set(stored_prompt.lower().split())
                if stored_words:
                    overlap = len(prompt_words & stored_words)
                    score = overlap / max(len(prompt_words | stored_words), 1)
                    if score > 0.7 and score > best_score:
                        best_score = score
                        best_match = value
        return best_match
    return None

Cache.get = _smart_cache_get

_original_cache_set = Cache.set

def _smart_cache_set(self, prompt, namespace, value):
    _original_cache_set(self, prompt, namespace, value)
    if self.preset == "smart":
        if not hasattr(self, '_prompt_map'):
            self._prompt_map = {}
        h = self._hash(prompt if isinstance(prompt, str) else json.dumps(prompt), namespace)
        self._prompt_map[h] = prompt if isinstance(prompt, str) else json.dumps(prompt)

Cache.set = _smart_cache_set


# ---------------------------------------------------------------------------
# Storage Backends
# ---------------------------------------------------------------------------

@runtime_checkable
class StorageBackend(Protocol):
    """Protocol for storage backends."""
    def get(self, key: str) -> Any: ...
    def set(self, key: str, value: Any) -> None: ...
    def delete(self, key: str) -> None: ...
    def list_keys(self) -> list[str]: ...


class InMemoryBackend:
    """Simple in-memory storage backend (async-compatible)."""
    def __init__(self):
        self._data: dict[str, Any] = {}

    async def get(self, key: str) -> Any:
        return self._data.get(key)

    async def set(self, key: str, value: Any) -> None:
        self._data[key] = value

    async def delete(self, key: str) -> None:
        self._data.pop(key, None)

    async def list_keys(self, prefix: str = "") -> list[str]:
        if prefix:
            return [k for k in self._data.keys() if k.startswith(prefix)]
        return list(self._data.keys())

    def __repr__(self):
        return f"InMemoryBackend(keys={len(self._data)})"


def _with_backend(self, url_or_backend):
    """Set the storage backend for the agent."""
    if isinstance(url_or_backend, str):
        # Mock: parse URL and use in-memory backend
        self._backend = InMemoryBackend()
        self._observer.log("backend_configured", {"url": url_or_backend})
    else:
        self._backend = url_or_backend
        self._observer.log("backend_configured", {"type": type(url_or_backend).__name__})
    return self


def _with_vectors(self, path: str):
    """Configure vector storage path."""
    self._vectors_path = path
    self._observer.log("vectors_configured", {"path": path})
    return self

Agent.with_backend = _with_backend
Agent.with_vectors = _with_vectors


# ---------------------------------------------------------------------------
# Convenience: make 'from agentu import ...' work in codelab
# ---------------------------------------------------------------------------

__all__ = [
    # Core
    "Agent", "Tool", "ToolPermission",
    # Guardrails
    "NoPII", "NoHallucination",
    # Evaluation
    "evaluate", "EvalResults",
    # Observability
    "observe", "configure_observe", "Observer",
    # Memory & Cache
    "Memory", "Cache",
    # Skills
    "Skill",
    # Sessions
    "SessionManager", "Session",
    # MCP
    "MCPServer",
    # Serve
    "serve", "AgentServer",
    # Hooks
    "HookAction", "HookResult",
    # Structured Outputs
    "StructuredOutput",
    # Multi-modal
    "detect_mime_type", "resolve_image", "build_content_parts",
    # Safety
    "TrifectaReport", "check_lethal_trifecta", "spotlight_untrusted",
    # Context Management
    "ContextConfig", "estimate_tokens", "compact_context",
    # Scheduling
    "Scheduler", "ScheduleConfig", "Finding",
    # Sub-agents
    "SubAgentConfig",
    # Worktree
    "WorktreeManager",
    # Tool Search
    "SearchAgent",
    # Task Queue
    "TaskQueue", "TaskStatus", "TaskInfo",
    # Checkpoint
    "CheckpointStore",
    # Semantic Cache
    "SemanticIndex",
    # Storage Backends
    "StorageBackend", "InMemoryBackend",
    # MockLLM
    "MockLLM",
]
