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
print(f"✅ search: {result}")

# WRITE: works but logged
result = await agent.call("save_file", {"name": "report.txt", "content": "Q2 results..."})
print(f"✅ save_file: {result}")

# DANGEROUS: blocked!
try:
    await agent.call("delete_all")
except PermissionError as e:
    print(f"🚫 delete_all: {e}")
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
print(f"✅ delete_all (allowed): {result}")
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
    print(f"  ⭐ [{m['importance']}] {m['content']}")

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
];
