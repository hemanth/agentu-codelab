/**
 * agentu codelab — lesson content
 *
 * Each lesson has: title, description, starter code, exercise, hint, solution
 */

export const lessons = [
  // -----------------------------------------------------------------------
  // Lesson 1: Your first agent
  // -----------------------------------------------------------------------
  {
    id: "first-agent",
    title: "Your first agent",
    description: `
Create an agent, give it tools, and call them directly with \`agent.call()\`.

An **agent** is just a named runtime that holds tools and can execute them.
A **tool** is any Python function. The agent wraps it with permissions, observability, and sandboxing.

\`agent.call("tool_name", {params})\` runs a tool directly — no LLM needed.
    `.trim(),
    starterCode: `from agentu import Agent

def add(x: int, y: int) -> int:
    """Add two numbers."""
    return x + y

def multiply(x: int, y: int) -> int:
    """Multiply two numbers."""
    return x * y

agent = Agent("calculator").with_tools([add, multiply])

# Direct tool execution — no LLM needed
result = await agent.call("add", {"x": 5, "y": 3})
print(f"5 + 3 = {result}")

result = await agent.call("multiply", {"x": 4, "y": 7})
print(f"4 × 7 = {result}")

# List available tools
print("\\nAvailable tools:")
for tool in agent.list_tools():
    print(f"  {tool['name']}: {tool['description']}")
`,
    exercise: `**Exercise:** Add a \`subtract\` and a \`divide\` tool. Call both and print the results.

*Bonus: What happens if you call a tool that doesn't exist?*`,
    hint: "Define `subtract(x: int, y: int)` the same way as `add`, then pass it to `.with_tools()`. For divide, handle division by zero!",
    solution: `from agentu import Agent

def add(x: int, y: int) -> int:
    """Add two numbers."""
    return x + y

def multiply(x: int, y: int) -> int:
    """Multiply two numbers."""
    return x * y

def subtract(x: int, y: int) -> int:
    """Subtract y from x."""
    return x - y

def divide(x: int, y: int) -> float:
    """Divide x by y."""
    if y == 0:
        raise ValueError("Cannot divide by zero")
    return x / y

agent = Agent("calculator").with_tools([add, multiply, subtract, divide])

result = await agent.call("subtract", {"x": 10, "y": 3})
print(f"10 - 3 = {result}")

result = await agent.call("divide", {"x": 15, "y": 4})
print(f"15 ÷ 4 = {result}")

# This will raise an error:
try:
    await agent.call("power", {"x": 2, "y": 3})
except ValueError as e:
    print(f"\\nExpected error: {e}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 2: Tool permissions
  // -----------------------------------------------------------------------
  {
    id: "tool-permissions",
    title: "Tool permissions",
    description: `
Not all tools are created equal. A search function is harmless. A delete function is not.

agentu has three permission levels:
- **READONLY** — always allowed, no side effects (default)
- **WRITE** — allowed but logged, has side effects
- **DANGEROUS** — blocked by default, must be explicitly allowed

This gives you fine-grained control over what an agent can do.
    `.trim(),
    starterCode: `from agentu import Agent, Tool, ToolPermission

def search(query: str) -> str:
    """Search the database."""
    return f"Results for '{query}': item_1, item_2, item_3"

def save_file(name: str, content: str) -> str:
    """Save a file."""
    return f"Saved '{name}' ({len(content)} bytes)"

def delete_all() -> str:
    """Delete all records. Destructive!"""
    return "All records deleted!"

agent = Agent("bot").with_tools([
    Tool(search, permission=ToolPermission.READONLY),
    Tool(save_file, permission=ToolPermission.WRITE),
    Tool(delete_all, permission=ToolPermission.DANGEROUS),
])

# READONLY: always works
result = await agent.call("search", {"query": "laptops"})
print(f"[ok] search: {result}")

# WRITE: works but logged
result = await agent.call("save_file", {"name": "report.txt", "content": "Q2 results..."})
print(f"[ok] save_file: {result}")

# DANGEROUS: blocked!
try:
    await agent.call("delete_all")
except PermissionError as e:
    print(f"[blocked] delete_all: {e}")
`,
    exercise: `**Exercise:** Allow the dangerous tool by adding \`.with_permissions(allow_dangerous=True)\` and run \`delete_all\` successfully.

*Think about it: why would you want this gate? When would you enable it?*`,
    hint: "Chain `.with_permissions(allow_dangerous=True)` after `.with_tools(...)`. The builder pattern returns `self` so you can keep chaining.",
    solution: `from agentu import Agent, Tool, ToolPermission

def search(query: str) -> str:
    """Search the database."""
    return f"Results for '{query}': item_1, item_2, item_3"

def delete_all() -> str:
    """Delete all records. Destructive!"""
    return "All records deleted!"

agent = Agent("bot").with_tools([
    Tool(search, permission=ToolPermission.READONLY),
    Tool(delete_all, permission=ToolPermission.DANGEROUS),
]).with_permissions(allow_dangerous=True)

result = await agent.call("delete_all")
print(f"[ok] delete_all (allowed): {result}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 3: Memory
  // -----------------------------------------------------------------------
  {
    id: "memory",
    title: "Memory",
    description: `
Agents can remember things across interactions using \`.remember()\` and \`.recall()\`.

Memory is SQLite-backed, searchable, and sorted by importance.

- \`agent.remember(content, importance=0.9)\` — store a fact
- \`agent.recall(query)\` — search memories by keyword
- Importance (0.0–1.0) determines recall priority
    `.trim(),
    starterCode: `from agentu import Agent

agent = Agent("assistant")

# Store some memories with different importance
agent.remember("Customer prefers email communication", importance=0.9)
agent.remember("Last order was #1042 for a blue mug", importance=0.7)
agent.remember("Customer timezone is PST", importance=0.5)
agent.remember("Customer birthday is March 15", importance=0.3)

# Recall by keyword
print("=== Communication preferences ===")
memories = agent.recall("communication")
for m in memories:
    print(f"  [{m['importance']}] {m['content']}")

print("\\n=== Order history ===")
memories = agent.recall("order")
for m in memories:
    print(f"  [{m['importance']}] {m['content']}")

print("\\n=== All memories (by importance) ===")
memories = agent.recall()
for m in memories:
    print(f"  [{m['importance']}] {m['content']}")
`,
    exercise: `**Exercise:** Build a personal assistant that remembers meeting notes. Store 5 different meeting summaries with varying importance, then recall only the high-priority ones (importance > 0.7).`,
    hint: "You can filter in Python after recall: `[m for m in agent.recall() if m['importance'] > 0.7]`",
    solution: `from agentu import Agent

agent = Agent("meeting-bot")

agent.remember("Q3 planning: launch date set for Sept 1", importance=0.95)
agent.remember("1:1 with Sarah: promotion discussion", importance=0.8)
agent.remember("Team standup: no blockers today", importance=0.3)
agent.remember("Board meeting: funding approved for new hire", importance=0.9)
agent.remember("Lunch chat: weekend plans", importance=0.1)

print("=== High-priority meetings ===")
all_memories = agent.recall()
important = [m for m in all_memories if m["importance"] > 0.7]
for m in important:
    print(f"  * [{m['importance']}] {m['content']}")

print(f"\\n{len(important)} high-priority out of {len(all_memories)} total")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 4: Caching
  // -----------------------------------------------------------------------
  {
    id: "caching",
    title: "Caching",
    description: `
Skip redundant LLM calls by caching responses. Works with strings and full conversations.

Presets:
- **basic** — exact match (SHA-256 hash)
- **smart** — semantic matching (cosine similarity)
- **offline** — filesystem backup
- **distributed** — Redis-backed

Cache keys are: \`hash(prompt + namespace + temperature)\`.
Same prompt to the same agent = instant response from cache.
    `.trim(),
    starterCode: `from agentu import Agent
import time

agent = Agent("assistant").with_cache(preset="basic").with_mock_responses([
    "Python is a high-level programming language.",
    "This should never appear (cache hit).",
])

# First call: hits the LLM (mock)
start = time.time()
result1 = await agent.infer("What is Python?")
t1 = (time.time() - start) * 1000
print(f"Call 1: {result1}")
print(f"  Time: {t1:.1f}ms")

# Second call: same prompt = cache hit!
start = time.time()
result2 = await agent.infer("What is Python?")
t2 = (time.time() - start) * 1000
print(f"\\nCall 2: {result2}")
print(f"  Time: {t2:.1f}ms")

print(f"\\nSame result? {result1 == result2}")
print(f"Cache stats: {agent._cache.stats()}")
`,
    exercise: `**Exercise:** Create an agent with cache, make 3 different queries, then repeat them. Count how many cache hits vs misses you get.`,
    hint: "You'll need 3 different mock responses (one per unique query). The second round should all be cache hits.",
    solution: `from agentu import Agent

agent = Agent("research").with_cache().with_mock_responses([
    "AI is transforming every industry.",
    "ML is a subset of AI focused on learning from data.",
    "Crypto uses blockchain for decentralized finance.",
])

queries = ["What is AI?", "What is ML?", "What is Crypto?"]

print("=== First round (cache misses) ===")
for q in queries:
    r = await agent.infer(q)
    print(f"  {q} → {r[:40]}...")

print("\\n=== Second round (cache hits) ===")
for q in queries:
    r = await agent.infer(q)
    print(f"  {q} → {r[:40]}...")

print(f"\\nCache entries: {agent._cache.stats()['entries']}")
print("All 3 second-round calls were instant cache hits!")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 5: Guardrails
  // -----------------------------------------------------------------------
  {
    id: "guardrails",
    title: "Guardrails & self-correction",
    description: `
Guardrails validate LLM output and trigger automatic retries when violations are detected.

When an output guardrail fails:
1. The violation is logged
2. The feedback is sent back to the LLM
3. The LLM tries again (up to \`max_corrections\`)

Built-in guardrails:
- **NoPII** — blocks output containing emails, phone numbers, SSNs
- **NoHallucination** — blocks "as an AI" and similar hedging patterns
    `.trim(),
    starterCode: `from agentu import Agent, NoPII, NoHallucination

# Mock LLM that first leaks PII, then corrects itself
agent = Agent("assistant").with_guardrails(
    output_guardrails=[NoPII()],
    max_corrections=2,
).with_mock_responses([
    "The customer email is alice@corp.com and phone is 555-1234.",  # ← PII! Will be caught
    "Contact info is on file. I can look it up for you.",          # ← Clean, no PII
    "Sure, the customer prefers email communication.",             # ← Also clean
])

print("=== With NoPII guardrail ===")
result = await agent.infer("What is the customer's contact info?")
print(f"Final output: {result}")
print(f"\\nSelf-corrections: {agent._llm._correction_count}")

# Check the observer for correction events
corrections = [e for e in agent.observer.events if e["type"] == "self_correction"]
for c in corrections:
    print(f"  Caught: {c['violation']} (attempt {c['attempt']})")
`,
    exercise: `**Exercise:** Add the \`NoHallucination\` guardrail alongside \`NoPII\`. Create mock responses where the first response says "As an AI, I cannot access that data" and the second is a clean answer.`,
    hint: "Pass both guardrails: `output_guardrails=[NoPII(), NoHallucination()]`. The mock responses should trigger NoHallucination first.",
    solution: `from agentu import Agent, NoPII, NoHallucination

agent = Agent("assistant").with_guardrails(
    output_guardrails=[NoPII(), NoHallucination()],
    max_corrections=3,
).with_mock_responses([
    "As an AI, I cannot access personal data.",  # ← NoHallucination catches this
    "The data includes alice@corp.com.",           # ← NoPII catches this
    "The customer data is available in the CRM.",  # ← Clean!
])

result = await agent.infer("Show me the customer data")
print(f"Final output: {result}")
print(f"Self-corrections: {agent._llm._correction_count}")

corrections = [e for e in agent.observer.events if e["type"] == "self_correction"]
print(f"\\nGuardrail violations caught: {len(corrections)}")
for c in corrections:
    print(f"  {c['guardrail']}: {c['violation']}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 6: Workflows
  // -----------------------------------------------------------------------
  {
    id: "workflows",
    title: "Workflows",
    description: `
Chain agents with operators:
- \`>>\` — **sequential** (one after another, output flows forward)
- \`&\` — **parallel** (all at once, results collected)
- Combine them: \`(a & b & c) >> d\` — fan-out then fan-in

Use lambdas to transform data between steps:
\`\`\`python
step1 >> analyst(lambda prev: f"Analyze: {prev}")
\`\`\`
    `.trim(),
    starterCode: `from agentu import Agent

def research(topic: str) -> dict:
    """Research a topic."""
    return {"topic": topic, "findings": f"Key insights about {topic}"}

def analyze(data: str) -> dict:
    """Analyze data."""
    return {"analysis": f"Analysis of: {data}", "confidence": 0.85}

def summarize(text: str) -> dict:
    """Summarize text."""
    return {"summary": f"Summary: {text[:50]}..."}

researcher = Agent("researcher").with_tools([research]).with_mock_responses(["AI trends: transformers, agents, multimodal"])
analyst = Agent("analyst").with_tools([analyze]).with_mock_responses(["Key finding: agents are the next platform shift"])
writer = Agent("writer").with_tools([summarize]).with_mock_responses(["Report: AI agents represent a fundamental shift in computing"])

print("=== Sequential workflow (>>) ===")
workflow = (
    researcher("Research AI trends")
    >> analyst("Analyze the findings")
    >> writer("Write a summary")
)
result = await workflow.run()
print(f"Result: {result}\\n")

print("=== Parallel workflow (&) ===")
workflow = (
    researcher("AI trends")
    & researcher("ML trends")
    & researcher("Crypto trends")
)
results = await workflow.run()
print(f"Got {len(results)} parallel results")
for i, r in enumerate(results):
    print(f"  [{i+1}] {r}")
`,
    exercise: `**Exercise:** Build a workflow that researches 3 topics in parallel, then pipes all results to an analyst for comparison. Use the \`(a & b & c) >> d\` pattern.`,
    hint: "The parallel results become the input to the sequential step. Use: `(researcher('A') & researcher('B') & researcher('C')) >> analyst('Compare all')`",
    solution: `from agentu import Agent

researcher = Agent("researcher").with_mock_responses([
    "AI: transformer architectures dominate",
    "Robotics: humanoid robots advancing rapidly",
    "Biotech: mRNA platforms expanding beyond vaccines",
])
analyst = Agent("analyst").with_mock_responses([
    "Cross-sector analysis: AI enables breakthroughs in both robotics and biotech"
])

print("=== Fan-out then fan-in ===")
workflow = (
    researcher("AI trends")
    & researcher("Robotics trends")
    & researcher("Biotech trends")
) >> analyst("Compare all three sectors")

result = await workflow.run()
print(f"\\nFinal analysis: {result}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 7: Evaluation
  // -----------------------------------------------------------------------
  {
    id: "evaluation",
    title: "Evaluation",
    description: `
Test your agents with structured test cases:

\`\`\`python
test_cases = [
    {"ask": "What's 5 + 3?", "expect": 8},
    {"ask": "Weather in SF?", "expect": "sunny"},
]
results = await evaluate(agent, test_cases)
\`\`\`

Matching strategies:
- **Exact** — numbers and exact strings
- **Substring** — expected appears somewhere in actual
- **Custom validator** — \`lambda expected, actual: ...\`
- **LLM-as-judge** — semantic similarity (requires real LLM)
    `.trim(),
    starterCode: `from agentu import Agent, Tool, evaluate

def add(x: int, y: int) -> int:
    """Add two numbers."""
    return x + y

def get_weather(city: str) -> str:
    """Get weather for a city."""
    return f"The weather in {city} is sunny and 72°F"

agent = Agent("test-agent").with_tools([
    Tool(add), Tool(get_weather)
]).with_mock_responses([
    "8",       # for "5 + 3"
    "30",      # for "10 + 20"
    "sunny",   # for weather
    "72",      # for NYC weather
    "150",     # for 100 + 50
])

test_cases = [
    {"ask": "What is 5 plus 3?", "expect": "8"},
    {"ask": "Add 10 and 20", "expect": "30"},
    {"ask": "Weather in San Francisco?", "expect": "sunny"},
    {"ask": "NYC weather?", "expect": "72"},
    {
        "ask": "What's 100 plus 50?",
        "expect": 100,
        "validator": lambda expected, actual: int(actual) > expected
    },
]

print(f"Running {len(test_cases)} test cases...\\n")
results = await evaluate(agent, test_cases)

print(results)
print(f"\\nAccuracy: {results.accuracy}%")
print(f"Duration: {results.duration:.3f}s")

if results.failures:
    print(f"\\nFailures:")
    for f in results.failures:
        print(f"  ✗ {f.query}: {f.reason}")

print(f"\\nJSON export:\\n{results.to_json()}")
`,
    exercise: `**Exercise:** Write a test suite for a "calculator agent" with at least 6 test cases. Include edge cases (division by zero, negative numbers) and at least one custom validator.`,
    hint: "For division by zero, you can use a validator that checks if the error message contains 'zero'. Custom validators take `(expected, actual)` and return `bool`.",
    solution: `from agentu import Agent, Tool, evaluate

def add(x: int, y: int) -> int:
    return x + y

def subtract(x: int, y: int) -> int:
    return x - y

agent = Agent("calc").with_tools([
    Tool(add), Tool(subtract)
]).with_mock_responses([
    "8", "-5", "0", "1000000", "42", "positive",
])

test_cases = [
    {"ask": "5 + 3", "expect": "8"},
    {"ask": "3 - 8", "expect": "-5"},
    {"ask": "0 + 0", "expect": "0"},
    {"ask": "999999 + 1", "expect": "1000000"},
    {"ask": "The answer to everything", "expect": "42"},
    {
        "ask": "Is 5 + 3 positive?",
        "expect": "yes",
        "validator": lambda exp, act: "positive" in str(act).lower() or "yes" in str(act).lower()
    },
]

results = await evaluate(agent, test_cases)
print(results)
print(f"\\n{results.to_json()}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 8: Observability
  // -----------------------------------------------------------------------
  {
    id: "observability",
    title: "Observability",
    description: `
Every tool call, LLM request, self-correction, and error is tracked automatically.

Events captured:
\`tool_call\` · \`tool_blocked\` · \`tool_result\` · \`self_correction\` · \`inference_start\` · \`inference_end\` · \`error\` · \`memory_store\` · \`memory_recall\` · \`cache_hit\`

Access metrics with \`agent.observer.get_metrics()\` — tool calls, errors, duration.
Access raw events with \`agent.observer.events\`.
    `.trim(),
    starterCode: `from agentu import Agent, Tool, ToolPermission, NoPII

def search(query: str) -> str:
    """Search the database."""
    return f"Found 3 results for '{query}'"

def delete_item(id: str) -> str:
    """Delete an item."""
    return f"Deleted {id}"

agent = Agent("observed-bot").with_tools([
    Tool(search, permission=ToolPermission.READONLY),
    Tool(delete_item, permission=ToolPermission.DANGEROUS),
]).with_guardrails(
    output_guardrails=[NoPII()],
    max_corrections=1,
).with_mock_responses([
    "Contact alice@example.com for details.",  # PII — will be caught
    "The search results are ready for review.", # Clean
])

# Generate some events
await agent.call("search", {"query": "laptops"})

try:
    await agent.call("delete_item", {"id": "item_42"})
except PermissionError:
    pass  # Expected — DANGEROUS is blocked

agent.remember("User prefers dark mode", importance=0.8)
agent.recall("preferences")

await agent.infer("Show me the contact info")

# Now inspect the observer
print("=== Metrics ===")
metrics = agent.observer.get_metrics()
for k, v in metrics.items():
    print(f"  {k}: {v}")

print(f"\\n=== Event log ({len(agent.observer.events)} events) ===")
for event in agent.observer.events:
    etype = event["type"]
    ts = f"{event['timestamp']:.3f}s"
    detail = {k: v for k, v in event.items() if k not in ("type", "timestamp")}
    print(f"  [{ts}] {etype}: {detail}")
`,
    exercise: `**Exercise:** Create an agent that performs a mix of operations (tool calls, memory, cache, guardrails). Then write a summary function that counts events by type and prints a report.`,
    hint: "Use `from collections import Counter` and `Counter(e['type'] for e in agent.observer.events)` to count event types.",
    solution: `from agentu import Agent, Tool, NoPII
from collections import Counter

def greet(name: str) -> str:
    return f"Hello, {name}!"

agent = Agent("full-demo").with_tools([
    Tool(greet)
]).with_cache().with_guardrails(
    output_guardrails=[NoPII()],
).with_mock_responses(["Greetings!", "Welcome aboard!", "Nice to meet you!"])

# Generate diverse events
await agent.call("greet", {"name": "Alice"})
await agent.call("greet", {"name": "Bob"})
agent.remember("Alice prefers morning meetings", importance=0.9)
agent.remember("Bob works remotely", importance=0.6)
agent.recall("Alice")
await agent.infer("Say hello")
await agent.infer("Say hello")  # cache hit

# Summary report
events = agent.observer.events
counts = Counter(e["type"] for e in events)

print("=== Observability Report ===")
print(f"Total events: {len(events)}")
print(f"\\nBy type:")
for etype, count in counts.most_common():
    print(f"  {etype}: {count}")
print(f"\\nMetrics: {agent.observer.get_metrics()}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 9: Sandbox
  // -----------------------------------------------------------------------
  {
    id: "sandbox",
    title: "Sandbox execution",
    description: `
\`with_sandbox()\` separates tools into **read** and **write** buckets with automatic permission tagging.

Instead of manually setting permissions on each tool, you declare intent:

\`\`\`python
agent.with_sandbox(
    read_tools=[search, lookup],   # READONLY
    write_tools=[save, update],    # WRITE
    timeout=10                     # Max execution time
)
\`\`\`

This is the recommended pattern for production agents — it enforces least-privilege by default.
    `.trim(),
    starterCode: `from agentu import Agent, Tool, ToolPermission

def read_database(query: str) -> str:
    """Read from database (safe)."""
    return f"Query result for '{query}': [row1, row2, row3]"

def read_config(key: str) -> str:
    """Read config value (safe)."""
    configs = {"theme": "dark", "lang": "en", "region": "US"}
    return configs.get(key, "not found")

def write_log(message: str) -> str:
    """Write to log file (side effect)."""
    return f"Logged: {message}"

def update_record(id: str, data: str) -> str:
    """Update a database record (side effect)."""
    return f"Updated record {id}: {data}"

# Sandbox separates read vs write automatically
agent = Agent("sandboxed-bot").with_sandbox(
    read_tools=[read_database, read_config],
    write_tools=[write_log, update_record],
    timeout=10,
)

# Read tools work freely
result = await agent.call("read_database", {"query": "SELECT * FROM users"})
print(f"Read: {result}")

result = await agent.call("read_config", {"key": "theme"})
print(f"Config: {result}")

# Write tools also work (WRITE permission, not DANGEROUS)
result = await agent.call("write_log", {"message": "User logged in"})
print(f"Write: {result}")

# Show permission levels
print("\\nTool permissions:")
for tool in agent.list_tools():
    t = agent._tools[tool["name"]]
    print(f"  {tool['name']}: {t.permission.value}")
`,
    exercise: `**Exercise:** Create a file manager agent with \`read_file\`, \`list_dir\` as read tools and \`write_file\`, \`delete_file\` as write tools. Then add \`delete_file\` as a DANGEROUS tool instead and show it gets blocked.`,
    hint: "Use `with_sandbox()` for read/write, then manually add a `Tool(delete_file, permission=ToolPermission.DANGEROUS)` via `with_tools()`.",
    solution: `from agentu import Agent, Tool, ToolPermission

def read_file(path: str) -> str:
    return f"Contents of {path}: Hello world!"

def list_dir(path: str) -> str:
    return f"Files in {path}: a.txt, b.txt, c.txt"

def write_file(path: str, content: str) -> str:
    return f"Wrote {len(content)} bytes to {path}"

def delete_file(path: str) -> str:
    return f"DELETED {path}"

agent = Agent("file-mgr").with_sandbox(
    read_tools=[read_file, list_dir],
    write_tools=[write_file],
).with_tools([
    Tool(delete_file, permission=ToolPermission.DANGEROUS)
])

await agent.call("read_file", {"path": "/data/config.json"})
await agent.call("list_dir", {"path": "/data"})
await agent.call("write_file", {"path": "/tmp/out.txt", "content": "hello"})
print("Read and write tools work fine!")

try:
    await agent.call("delete_file", {"path": "/data/config.json"})
except PermissionError as e:
    print(f"\\nBlocked: {e}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 10: Sessions
  // -----------------------------------------------------------------------
  {
    id: "sessions",
    title: "Sessions",
    description: `
Sessions give agents **stateful, multi-turn conversations** where context is preserved automatically.

- \`SessionManager()\` — manages multiple concurrent sessions
- \`session.send(message)\` — send a message and get a response
- \`session.get_history()\` — retrieve conversation history
- Each session tracks turns, memory stats, and metadata
- Multiple users get **isolated** sessions (no cross-contamination)
    `.trim(),
    starterCode: `from agentu import Agent, Tool, SessionManager

def get_weather(city: str) -> str:
    """Get weather for a city."""
    return f"The weather in {city} is sunny and 72F"

def set_reminder(task: str, time: str) -> str:
    """Set a reminder."""
    return f"Reminder set: '{task}' at {time}"

agent = Agent("assistant").with_tools([
    Tool(get_weather), Tool(set_reminder)
]).with_mock_responses([
    "It's sunny and 72F in San Francisco!",
    "It's rainy and 55F in Seattle!",
    "Reminder set for tomorrow at 9am!",
])

manager = SessionManager()

# Create a session for user Alice
session = manager.create_session(agent, metadata={"user": "alice"})
print(f"Session created: {session.session_id}")

# Multi-turn conversation
r1 = await session.send("What's the weather in SF?")
print(f"\\nTurn {r1['session_info']['turn']}: {r1['result']}")

r2 = await session.send("What about Seattle?")
print(f"Turn {r2['session_info']['turn']}: {r2['result']}")

r3 = await session.send("Remind me to check weather tomorrow")
print(f"Turn {r3['session_info']['turn']}: {r3['result']}")

# Conversation history
print(f"\\n=== History ({session.turn_count} turns) ===")
for entry in session.get_history():
    print(f"  [{entry.role}] {entry.content}")

# Session management
print(f"\\nActive sessions: {manager.list_sessions()}")
print(f"Memory stats: {r3['session_info']['memory_stats']}")
`,
    exercise: `**Exercise:** Create 2 sessions for different users (Alice and Bob). Send different messages to each. Then verify their histories are isolated — Alice shouldn't see Bob's messages.`,
    hint: "Create two sessions with `manager.create_session()`. Each session has its own `.get_history()` — verify they contain different content.",
    solution: `from agentu import Agent, SessionManager

agent = Agent("assistant").with_mock_responses([
    "I love pizza too, Alice!",
    "Sushi is great, Bob!",
    "You mentioned pizza earlier!",
    "You mentioned sushi earlier!",
])

manager = SessionManager()
alice = manager.create_session(agent, metadata={"user": "alice"})
bob = manager.create_session(agent, metadata={"user": "bob"})

await alice.send("I love pizza")
await bob.send("I prefer sushi")

r_alice = await alice.send("What did I say?")
r_bob = await bob.send("What did I say?")

print(f"Alice's session ({alice.session_id}):")
for e in alice.get_history():
    print(f"  [{e.role}] {e.content}")

print(f"\\nBob's session ({bob.session_id}):")
for e in bob.get_history():
    print(f"  [{e.role}] {e.content}")

print(f"\\nActive sessions: {len(manager.list_sessions())}")
print("Sessions are fully isolated!")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 11: Skills
  // -----------------------------------------------------------------------
  {
    id: "skills",
    title: "Skills & rules",
    description: `
**Skills** give agents domain expertise with **progressive loading** (3 levels):

1. **Metadata** — always loaded, near-zero context cost (~100 chars)
2. **Instructions** — loaded only when the skill is triggered
3. **Resources** — loaded on-demand for specific sub-tasks

This avoids context bloat — a skill with 10KB of instructions only costs ~100 chars until activated.

**Rules** (\`.with_rules()\`) load an \`AGENTS.md\` file as system prompt constraints.
    `.trim(),
    starterCode: `from agentu import Agent, Skill

# Create a skill with 3-level content
pdf_skill = Skill(
    name="pdf-processing",
    description="Extract text, tables, and forms from PDF files",
    instructions="""
## PDF Processing Guide

### Text Extraction
Use PyMuPDF for fast text extraction:
- fitz.open(path) to load
- page.get_text() for raw text
- page.get_text("blocks") for structured blocks

### Table Extraction  
Use camelot or tabula for table detection.

### Form Filling
Use PyPDF2 for AcroForm fields.
    """.strip(),
    resources={
        "forms": "AcroForm guide: Use reader.get_fields() to enumerate fields, then writer.update_page_form_field_values()",
        "ocr": "For scanned PDFs: use pytesseract + pdf2image for OCR pipeline",
    },
)

# Attach skill to agent
agent = Agent("pdf-assistant").with_skills([pdf_skill])

# Level 1: Metadata (always available, cheap)
print("=== Level 1: Metadata (always loaded) ===")
print(f"  Skill: {pdf_skill.name}")
print(f"  Description: {pdf_skill.description}")
print(f"  Context cost: ~{len(pdf_skill.description)} chars")

# Level 2: Instructions (loaded on activation)
print("\\n=== Level 2: Instructions (on-demand) ===")
instructions = pdf_skill.load_instructions()
print(f"  Size: {len(instructions)} chars")
print(f"  Preview: {instructions[:80]}...")

# Level 3: Resources (loaded for specific tasks)
print("\\n=== Level 3: Resources (on-demand) ===")
print(f"  Available: {pdf_skill.list_resources()}")
forms = pdf_skill.load_resource("forms")
print(f"  Forms guide: {forms[:60]}...")

# Cost analysis
total = len(pdf_skill.description) + len(instructions) + sum(
    len(pdf_skill.load_resource(r)) for r in pdf_skill.list_resources()
)
print(f"\\n=== Context savings ===")
print(f"  Always loaded: ~{len(pdf_skill.description)} chars")
print(f"  Full content: ~{total} chars")
print(f"  Savings: {100*(1 - len(pdf_skill.description)/total):.0f}%")
`,
    exercise: `**Exercise:** Create a "data-analysis" skill with instructions for pandas/SQL and resources for "visualization" and "statistics". Attach it to an agent and demonstrate the 3-level loading.`,
    hint: "Create `Skill(name='data-analysis', description='...', instructions='...', resources={'visualization': '...', 'statistics': '...'})` and show loading at each level.",
    solution: `from agentu import Agent, Skill

data_skill = Skill(
    name="data-analysis",
    description="Analyze datasets with pandas, SQL, and statistical methods",
    instructions="Use pandas for DataFrames. Key methods: read_csv(), groupby(), merge(), pivot_table(). For SQL: use sqlalchemy engine.",
    resources={
        "visualization": "Use matplotlib for static, plotly for interactive. Always label axes. Use fig, ax = plt.subplots().",
        "statistics": "scipy.stats for hypothesis testing. Use ttest_ind for comparing groups, pearsonr for correlation.",
    },
)

agent = Agent("analyst").with_skills([data_skill])

print(f"Skill: {data_skill.name}")
print(f"Description: {data_skill.description}")
print(f"\\nInstructions ({len(data_skill.load_instructions())} chars):")
print(f"  {data_skill.load_instructions()[:80]}...")
print(f"\\nResources: {data_skill.list_resources()}")
for r in data_skill.list_resources():
    content = data_skill.load_resource(r)
    print(f"  {r}: {content[:50]}...")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 12: LLM inference
  // -----------------------------------------------------------------------
  {
    id: "inference",
    title: "LLM inference",
    description: `
\`agent.infer(prompt)\` routes a natural language query through the LLM, which can:

1. Respond directly with text
2. Call one or more tools automatically
3. Chain multiple tool calls to answer complex questions

In this codelab, we use a **mock LLM** (\`.with_mock_responses()\`) to simulate deterministic responses. In production, you'd use:

\`\`\`python
Agent("bot", model="qwen3:latest")     # Ollama
Agent("bot", model="gpt-4o")           # OpenAI
Agent("bot", model="claude-sonnet-4-20250514") # Anthropic
\`\`\`

The full pipeline: **prompt → rules → LLM → guardrails → cache → result**
    `.trim(),
    starterCode: `from agentu import Agent, Tool, NoPII

def lookup_order(order_id: str) -> dict:
    """Look up order details."""
    orders = {
        "ORD-001": {"status": "shipped", "tracking": "1Z999AA1"},
        "ORD-002": {"status": "processing", "tracking": None},
    }
    return orders.get(order_id, {"error": "Not found"})

def cancel_order(order_id: str, reason: str) -> dict:
    """Cancel an order."""
    return {"success": True, "order_id": order_id, "reason": reason}

# Full-featured agent with all the pieces
agent = Agent("support", model="mock") \\
    .with_tools([Tool(lookup_order), Tool(cancel_order)]) \\
    .with_cache(preset="basic") \\
    .with_guardrails(output_guardrails=[NoPII()]) \\
    .with_rules("AGENTS.md") \\
    .with_mock_responses([
        "Order ORD-001 is shipped with tracking 1Z999AA1.",
        "Order ORD-002 is still processing, no tracking yet.",
        "Order ORD-001 is shipped with tracking 1Z999AA1.",  # cache hit won't reach this
    ])

# First inference
r1 = await agent.infer("Where is my order ORD-001?")
print(f"Query 1: {r1}")

# Different query
r2 = await agent.infer("What about ORD-002?")
print(f"Query 2: {r2}")

# Same query as #1 — cache hit!
r3 = await agent.infer("Where is my order ORD-001?")
print(f"Query 3 (cached): {r3}")
print(f"Same result? {r1 == r3}")

# Check what happened
print(f"\\nCache stats: {agent._cache.stats()}")
print(f"Observer events: {len(agent.observer.events)}")
cache_hits = [e for e in agent.observer.events if e['type'] == 'cache_hit']
print(f"Cache hits: {len(cache_hits)}")
`,
    exercise: `**Exercise:** Build a customer support agent with \`lookup_order\`, \`cancel_order\`, and \`refund_order\` tools. Add cache, guardrails, and rules. Simulate a 3-turn conversation using \`.infer()\` and show the full observer trace.`,
    hint: "Chain all builders: `.with_tools([...]).with_cache().with_guardrails(...).with_rules(...)`. Use `.with_mock_responses()` for deterministic output.",
    solution: `from agentu import Agent, Tool, NoPII

def lookup_order(order_id: str) -> dict:
    return {"status": "delivered", "total": 49.99}

def cancel_order(order_id: str, reason: str) -> dict:
    return {"cancelled": True, "refund": "pending"}

def refund_order(order_id: str) -> dict:
    return {"refunded": True, "amount": 49.99}

agent = Agent("cs-bot") \\
    .with_tools([Tool(lookup_order), Tool(cancel_order), Tool(refund_order)]) \\
    .with_cache() \\
    .with_guardrails(output_guardrails=[NoPII()]) \\
    .with_rules("AGENTS.md") \\
    .with_mock_responses([
        "Your order ORD-100 was delivered successfully.",
        "Order cancelled. Refund is pending.",
        "Refund of 49.99 processed to your account.",
    ])

queries = [
    "Where is order ORD-100?",
    "Cancel order ORD-100, wrong item",
    "Process refund for ORD-100",
]

for q in queries:
    result = await agent.infer(q)
    print(f"Q: {q}\\nA: {result}\\n")

# Full trace
print("=== Observer trace ===")
for e in agent.observer.events:
    print(f"  {e['type']}: {dict((k,v) for k,v in e.items() if k not in ('type','timestamp'))}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 13: MCP Integration
  // -----------------------------------------------------------------------
  {
    id: "mcp",
    title: "MCP integration",
    description: `
**Model Context Protocol (MCP)** lets agents discover and use tools from external servers.

Instead of defining tools in code, you connect to MCP servers that expose them dynamically:

\`\`\`python
agent = Agent("bot").with_mcp([
    "~/.agentu/mcp_config.json",
    "http://localhost:3000",
])
\`\`\`

**Authentication** \u2014 agentu supports three auth modes for remote MCP servers:

\`\`\`python
# Bearer token
agent.with_mcp([{
    "url": "https://api.example.com/mcp",
    "headers": {"Authorization": "Bearer sk-abc123"}
}])

# API key
agent.with_mcp([{
    "url": "https://api.example.com/mcp",
    "headers": {"X-API-Key": "my-key"}
}])

# Custom headers
agent.with_mcp([{
    "url": "https://internal.corp/mcp",
    "headers": {"X-Org-Id": "team-42", "X-Token": "secret"}
}])
\`\`\`

Auth headers are sent with every JSON-RPC request (initialize, tools/list, tools/call). MCP sessions are tracked via \`mcp-session-id\` headers automatically.

Transports: **HTTP** (default), **SSE** (streaming), **STDIO** (local subprocess).

MCP config file format:
\`\`\`json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
\`\`\`
    `.trim(),
    starterCode: `from agentu import Agent, Tool, SessionManager

# 1. Connect via config file (local servers)
agent = Agent("file-assistant").with_mcp([
    "~/.agentu/mcp_config.json",   # filesystem MCP server
]).with_mock_responses([
    "I found 3 files in the directory.",
    "File contents: Hello World",
    "File written successfully.",
])

# See what tools were discovered
print("=== Discovered MCP tools ===")
for tool in agent.list_tools():
    print(f"  {tool['name']}: {tool['description']}")

# Call MCP tools directly
print("\\n=== Direct tool calls ===")
result = await agent.call("list_directory", {"path": "/tmp"})
print(f"list_directory: {result}")

result = await agent.call("read_file", {"path": "/tmp/notes.txt"})
print(f"read_file: {result}")

# 2. Connect with authentication (remote servers)
print("\\n=== Authenticated MCP connection ===")
auth_agent = Agent("secure-bot").with_mcp([
    # Bearer token auth
    {"url": "https://api.example.com/mcp",
     "headers": {"Authorization": "Bearer sk-abc123"}},
    # API key auth
    {"url": "https://db.example.com/mcp",
     "headers": {"X-API-Key": "my-key-456"}},
])

print(f"Authenticated agent has {len(auth_agent.list_tools())} tools:")
for tool in auth_agent.list_tools():
    print(f"  {tool['name']}: {tool['description']}")

# 3. Use with sessions for stateful MCP interactions
print("\\n=== Stateful MCP session ===")
manager = SessionManager()
session = manager.create_session(agent, metadata={"user": "demo"})

r1 = await session.send("List files in /tmp")
print(f"Turn 1: {r1['result']}")

r2 = await session.send("Read the first file")
print(f"Turn 2: {r2['result']}")

print(f"\\nSession turns: {session.turn_count}")
`,
    exercise: `**Exercise:** Connect to two MCP servers (a "database" server and a "search" server). List all discovered tools from both, then call one tool from each server.`,
    hint: "Use `.with_mcp(['database-server', 'search-server'])`. The mock auto-generates tools based on the server name containing 'database' or 'search'.",
    solution: `from agentu import Agent

agent = Agent("multi-mcp").with_mcp([
    "database-server",
    "search-server",
])

print("Discovered tools from 2 MCP servers:")
for tool in agent.list_tools():
    print(f"  {tool['name']}: {tool['description']}")

print(f"\\nTotal: {len(agent.list_tools())} tools\\n")

# Call one from each server
r1 = await agent.call("query", {"sql": "SELECT * FROM users"})
print(f"Database: {r1}")

r2 = await agent.call("web_search", {"query": "agentu framework"})
print(f"Search: {r2}")
`,
  },

  // -----------------------------------------------------------------------
  // Lesson 14: REST API
  // -----------------------------------------------------------------------
  {
    id: "serve",
    title: "REST API",
    description: `
\`serve()\` turns any agent into a production REST API with three transports:

- **HTTP** \u2014 \`POST /process\` (inference), \`POST /execute\` (tool call)
- **WebSocket** \u2014 \`/ws\` (bidirectional streaming with sessions)
- **SSE** \u2014 \`POST /stream\` (server-sent events)

Plus built-in endpoints for memory, health checks, and an observability dashboard.

\`\`\`python
from agentu import Agent, serve
agent = Agent("bot").with_tools([...])
serve(agent, port=8000)
\`\`\`

In production, the server runs on Uvicorn + FastAPI. In this codelab, we mock the server to show the route table and configuration.
    `.trim(),
    starterCode: `from agentu import Agent, Tool, serve

def search(query: str) -> str:
    """Search the knowledge base."""
    return f"Results for '{query}': doc_1, doc_2"

def create_ticket(title: str, priority: str) -> dict:
    """Create a support ticket."""
    return {"id": "TKT-001", "title": title, "priority": priority}

# Build a full-featured agent
agent = Agent("support-api") \\
    .with_tools([Tool(search), Tool(create_ticket)]) \\
    .with_cache(preset="basic") \\
    .with_rules("AGENTS.md")

# Serve it as a REST API
print("=== Starting agent server ===\\n")
server = serve(agent, host="0.0.0.0", port=8000)

# In production, clients would call these endpoints:
print("\\n=== Example client requests ===")
print("""
# HTTP: Execute a tool
curl -X POST localhost:8000/execute \\\\
  -H 'Content-Type: application/json' \\\\
  -d '{"tool_name": "search", "parameters": {"query": "billing"}}'

# HTTP: LLM inference
curl -X POST localhost:8000/process \\\\
  -d '{"input": "help me with billing"}'

# WebSocket: Streaming
wscat -c ws://localhost:8000/ws
> {"input": "search for billing docs"}

# SSE: Server-sent events
curl -N -X POST localhost:8000/stream \\\\
  -d '{"input": "summarize the results"}'
""")
`,
    exercise: `**Exercise:** Build an agent with 3 tools, connect an MCP server, and serve it. Print the full route table and count total tools (local + MCP).`,
    hint: "Chain `.with_tools([...]).with_mcp([...])` then call `serve()`. The route table is printed automatically.",
    solution: `from agentu import Agent, Tool, serve

def add(x: int, y: int) -> int:
    return x + y

def subtract(x: int, y: int) -> int:
    return x - y

def multiply(x: int, y: int) -> int:
    return x * y

agent = Agent("calc-api") \\
    .with_tools([Tool(add), Tool(subtract), Tool(multiply)]) \\
    .with_mcp(["filesystem-server"]) \\
    .with_cache()

print(f"Local tools: 3")
print(f"MCP tools: {len(agent.list_tools()) - 3}")
print(f"Total tools: {len(agent.list_tools())}\\n")

serve(agent, port=9000)
`,
  },
];
