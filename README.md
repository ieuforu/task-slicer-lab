# task-slicer-lab

> **已迁移 / Moved（2026-11-01）**
>
> 当前代码、文档与后续维护已移至 [frontend-labs / labs/task-slicer](https://github.com/ieuforu/frontend-labs/tree/main/labs/task-slicer)。请在新仓库提交 Issue 和 PR。
>
> 原仓库的提交历史已完整保留在新仓库；本仓库保留历史版本。下方是迁移前的说明，其中性能与生产可用性描述不代表当前验证结论，当前行为和限制请以新仓库文档为准。


A production-grade, zero-dependency cooperative main-thread task scheduler built from scratch with TypeScript. Features 5ms frame-budget time-slicing, Min-Heap priority queuing with absolute expiration deadlines, lazy cancellation via `AbortSignal`, and automatic fallback from native W3C `scheduler.yield()` to zero-delay `MessageChannel` macro-tasks.

---

## Architecture Overview

Browsers execute JavaScript, style calculations, layout, and paint sequentially on a single thread. Executing non-preemptive scripts longer than 50ms results in Long Tasks, causing dropped animation frames (jank) and frozen user inputs.

`task-slicer-lab` implements cooperative multitasking: tasks voluntarily yield execution back to the browser runtime at predictable intervals (5ms frame budget), enabling 120 FPS rendering and zero-latency user input handling during intensive computations.

```text
[ Browser Event Loop ]
      │
      ├──> [ Microtasks Queue ] (Promise.then, MutationObserver) - Ran to exhaustion
      │
      ├──> [ Task Scheduler Work Loop ]
      │        │
      │        ├── Peek Min-Heap (Highest priority / Lowest expiration)
      │        ├── Execute Work Chunk
      │        │
      │        └── Check Deadline:
      │                ├── elapsed < 5ms  ──> Continue chunking
      │                └── elapsed >= 5ms ──> Yield to Main Thread:
      │                                         ├── Native: scheduler.yield()
      │                                         └── Fallback: MessageChannel (Port2 -> Port1)
      │
      └──> [ Browser Rendering Pipeline ] (rAF -> Style -> Layout -> Paint -> Composite)
```

---

## Core Mechanics & Mathematics

### 1. Work Loop & 5ms Frame Budget

Instead of scheduling fixed-size chunk iterations, the scheduler measures real elapsed execution time:

$$T_{\text{slice}} = T_{\text{now}} - T_{\text{start}}$$

If $T_{\text{slice}} \ge 5\text{ms}$ and the task has not timed out, the inner execution loop yields control. A 5ms budget guarantees sufficient headroom within 16.6ms (60Hz) or 8.3ms (120Hz) frame intervals for layout, style recalc, and GPU composition.

### 2. Min-Heap Priority Queue & Expiration Times

Priorities map to timeout offsets added to current timestamps:

$$\text{expirationTime} = \text{currentTime} + \text{timeout}$$

| Priority Level | Timeout Offset       | Target Scenario                                 |
| :------------- | :------------------- | :---------------------------------------------- |
| `Immediate`    | `-1ms`               | Synchronous / non-deferrable mutations          |
| `UserBlocking` | `250ms`              | User interactions (typing, dragging, clicking)  |
| `Normal`       | `1000ms`             | Network response parsing, state synchronization |
| `Background`   | `2000ms` / `10000ms` | Heavy data processing, offline computations     |

Tasks are stored in a binary min-heap where each node at index $i$ satisfies:

$$\text{heap}[i].\text{sortIndex} \le \text{heap}[2i + 1].\text{sortIndex} \quad \text{and} \quad \text{heap}[i].\text{sortIndex} \le \text{heap}[2i + 2].\text{sortIndex}$$

- **Insert / Push**: Appends to array tail and sifts up in $O(\log N)$.
- **Extract / Pop**: Swaps root with tail, truncates, and sifts down in $O(\log N)$.
- **Peek**: Retrieves current highest-urgency task in $O(1)$.

### 3. Starvation Prevention (Forced Flushing)

High-frequency bursts of `UserBlocking` tasks can starve `Background` tasks. If an uncompleted task passes its deadline:

$$\text{currentTime} \ge \text{expirationTime} \implies \text{didTimeout} = \text{true}$$

The scheduler revokes cooperative yielding for that task, forcing a synchronous flush until completion to prevent infinite starvation.

### 4. Cancellation via AbortSignal & Lazy Pruning

Tasks accept standard DOM `AbortSignal` handles. To prevent expensive $O(N)$ searches inside the binary heap array, cancellations mark tasks with `isCancelled = true`. The work loop prunes cancelled nodes lazily when they reach the heap root in $O(\log N)$.

---

## Task Scheduler vs. React Fiber Scheduler

| Dimension              | `task-slicer-lab`                                           | React Scheduler (`packages/scheduler`)                      |
| :--------------------- | :---------------------------------------------------------- | :---------------------------------------------------------- |
| **Yielding Primitive** | Native `scheduler.yield()` with `MessageChannel` fallback   | `MessageChannel` postMessage (historical `rIC` deprecated)  |
| **Priority Queue**     | Array-backed Binary Min-Heap (`sortIndex = expirationTime`) | Array-backed Binary Min-Heap (`sortIndex = expirationTime`) |
| **Time Budget**        | 5ms adaptive deadline                                       | 5ms fixed frame interval                                    |
| **Task Cancellation**  | Standard `AbortController` / `AbortSignal`                  | Internal status flags (`task.callback = null`)              |
| **Dynamic Preemption** | Priority-based heap interruption on continuation return     | Priority-based fiber work re-assignment                     |
| **Framework Coupling** | Zero dependencies, universal browser runtime                | Coupled to React reconciler and fiber nodes                 |

---

## Getting Started

### Prerequisites

- Node.js (>= 18)
- pnpm (>= 8)

### Installation & Development

```bash
# Clone the repository
git clone [https://github.com/](https://github.com/)<your-username>/task-slicer-lab.git
cd task-slicer-lab

# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build with TypeScript typechecking
pnpm build
```

---

## API Usage

```typescript
import { TaskScheduler, PriorityLevel } from "./scheduler";

const scheduler = new TaskScheduler();

// 1. Post a long background task with cooperative time slicing
const controller = new AbortController();

scheduler.postTask(
  (didTimeout) => {
    while (hasMoreWork()) {
      performHeavyCalculationChunk();

      // Yield if slice deadline reached and not starved
      if (scheduler.shouldYield() && !didTimeout) {
        return true; // Return true to indicate continuation
      }
    }
    return false; // Task completed
  },
  {
    priority: PriorityLevel.Background,
    signal: controller.signal,
  },
);

// 2. Post a high-priority user-blocking task that interrupts background slices
scheduler.postTask(
  () => {
    handleImmediateUserInteraction();
    return false;
  },
  {
    priority: PriorityLevel.UserBlocking,
  },
);

// 3. Cancel task on demand
controller.abort();
```

---

## Project Structure

```text
.
├── index.html         # Instrumentation UI, FPS probe, and starvation controls
├── src/
│   ├── main.ts        # UI bindings, stress test loops, and state probes
│   ├── minHeap.ts     # Zero-dependency binary Min-Heap implementation
│   └── scheduler.ts   # Core cooperative work loop, yielding, and starvation engine
├── package.json
└── tsconfig.json      # Strict TS configuration (erasableSyntaxOnly compliant)
```

---

## License

MIT
