import { MinHeap, type HeapItem } from "./minHeap";

export const PriorityLevel = {
  Immediate: 0,
  UserBlocking: 1,
  Normal: 2,
  Background: 3,
} as const;

export type PriorityLevel = (typeof PriorityLevel)[keyof typeof PriorityLevel];

// 测试阈值：Background 设为 800ms，任务总耗时约 1000ms，在实验中必定跨越超时线触发提权
const TIMEOUT_CONFIG: Record<PriorityLevel, number> = {
  [PriorityLevel.Immediate]: -1,
  [PriorityLevel.UserBlocking]: 250,
  [PriorityLevel.Normal]: 500,
  [PriorityLevel.Background]: 800,
};

export type TaskCallback = (didTimeout: boolean) => boolean | void;

export interface TaskOptions {
  priority?: PriorityLevel;
  signal?: AbortSignal;
}

export interface Task extends HeapItem {
  id: number;
  priority: PriorityLevel;
  startTime: number;
  expirationTime: number;
  callback: TaskCallback;
  signal?: AbortSignal;
  isCancelled: boolean;
  cancel: () => void;
}

export class TaskScheduler {
  private taskQueue = new MinHeap<Task>();
  private taskIdCounter = 1;
  private isHostCallbackScheduled = false;
  private isPerformingWork = false;
  private currentTask: Task | null = null;

  private channel: MessageChannel | null = null;
  public readonly isNativeYieldSupported: boolean;

  public onStarvationResolved?: (task: Task, waitTimeMs: number) => void;

  constructor() {
    this.isNativeYieldSupported =
      typeof window !== "undefined" &&
      "scheduler" in window &&
      typeof window.scheduler?.yield === "function";

    if (!this.isNativeYieldSupported) {
      this.channel = new MessageChannel();
      this.channel.port1.onmessage = () => this.performWorkUntilDeadline();
    }
  }

  postTask(callback: TaskCallback, options: TaskOptions = {}): Task {
    const priority = options.priority ?? PriorityLevel.Normal;
    const currentTime = performance.now();
    const timeout = TIMEOUT_CONFIG[priority];
    const expirationTime = currentTime + timeout;

    const task: Task = {
      id: this.taskIdCounter++,
      priority,
      startTime: currentTime,
      expirationTime,
      sortIndex: expirationTime,
      callback,
      signal: options.signal,
      isCancelled: false,
      cancel: () => {
        task.isCancelled = true;
      },
    };

    if (task.signal) {
      if (task.signal.aborted) {
        task.isCancelled = true;
      } else {
        task.signal.addEventListener(
          "abort",
          () => {
            task.isCancelled = true;
          },
          { once: true },
        );
      }
    }

    this.taskQueue.push(task);
    this.requestHostCallback();
    return task;
  }

  private requestHostCallback() {
    if (this.isHostCallbackScheduled || this.isPerformingWork) {
      return;
    }
    this.isHostCallbackScheduled = true;

    if (this.isNativeYieldSupported && window.scheduler?.yield) {
      window.scheduler.yield().then(() => this.performWorkUntilDeadline());
    } else {
      this.channel!.port2.postMessage(null);
    }
  }

  private performWorkUntilDeadline() {
    this.isHostCallbackScheduled = false;
    this.isPerformingWork = true;

    const startTime = performance.now();
    const frameBudget = 5;
    let hasMoreWork = true;

    try {
      this.currentTask = this.taskQueue.peek();

      while (this.currentTask !== null) {
        const currentTime = performance.now();

        // 1. 惰性过滤已取消任务
        if (this.currentTask.isCancelled || this.currentTask.signal?.aborted) {
          this.taskQueue.pop();
          this.currentTask = this.taskQueue.peek();
          continue;
        }

        // 2. 防饥饿超时判定
        const didTimeout = this.currentTask.expirationTime <= currentTime;

        if (didTimeout && this.onStarvationResolved) {
          this.onStarvationResolved(this.currentTask, currentTime - this.currentTask.startTime);
        }

        // 3. 只有未超时的任务在超过 5ms 时才会让出；超时的任务剥夺让出权，直接同步执行
        if (currentTime - startTime >= frameBudget && !didTimeout) {
          break;
        }

        const callback = this.currentTask.callback;
        const continuation = callback(didTimeout);

        if (continuation === true && !this.currentTask.isCancelled) {
          const topTask = this.taskQueue.peek();
          // 如果堆顶浮现了更高优先级的任务，让出当前切片让高优先行
          if (topTask && topTask.id !== this.currentTask.id) {
            break;
          }
        } else {
          if (this.taskQueue.peek() === this.currentTask) {
            this.taskQueue.pop();
          }
        }

        this.currentTask = this.taskQueue.peek();
      }

      hasMoreWork = this.taskQueue.size > 0;
    } finally {
      this.currentTask = null;
      this.isPerformingWork = false;

      if (hasMoreWork) {
        this.requestHostCallback();
      }
    }
  }
}
