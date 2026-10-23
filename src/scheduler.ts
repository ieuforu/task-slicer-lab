import { MinHeap, type HeapItem } from "./minHeap";

export const PriorityLevel = {
  Immediate: 0,
  UserBlocking: 1,
  Normal: 2,
  Background: 3,
} as const;

export type PriorityLevel = (typeof PriorityLevel)[keyof typeof PriorityLevel];

const TIMEOUT_CONFIG = {
  [PriorityLevel.Immediate]: -1,
  [PriorityLevel.UserBlocking]: 250,
  [PriorityLevel.Normal]: 5000,
  [PriorityLevel.Background]: 10000,
};

export type TaskCallback = (didTimeout: boolean) => boolean | void;

export interface Task extends HeapItem {
  id: number;
  priority: PriorityLevel;
  startTime: number;
  expirationTime: number;
  callback: TaskCallback;
}

export class TaskScheduler {
  private taskQueue = new MinHeap<Task>();
  private taskIdCounter = 1;
  private isHostCallbackScheduled = false;
  private isPerformingWork = false;
  private currentTask: Task | null = null;

  private channel: MessageChannel | null = null;
  public readonly isNativeYieldSupported: boolean;

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

  /**
   * 发布一个带优先级的任务
   */
  postTask(callback: TaskCallback, priority: PriorityLevel = PriorityLevel.Normal): Task {
    const currentTime = performance.now();
    const timeout = TIMEOUT_CONFIG[priority];
    const expirationTime = currentTime + timeout;

    const task: Task = {
      id: this.taskIdCounter++,
      priority,
      startTime: currentTime,
      expirationTime,
      sortIndex: expirationTime, // 最小堆以过期时间排序
      callback,
    };

    this.taskQueue.push(task);

    // 请求执行循环
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

  /**
   * 核心工作循环（对标 React workLoop）
   */
  private performWorkUntilDeadline() {
    this.isHostCallbackScheduled = false;
    this.isPerformingWork = true;

    const startTime = performance.now();
    const frameBudget = 5; // 5ms 时间切片预算
    let hasMoreWork = true;

    try {
      this.currentTask = this.taskQueue.peek();

      while (this.currentTask !== null) {
        const currentTime = performance.now();
        const didTimeout = this.currentTask.expirationTime <= currentTime;

        // 如果单切片耗时超过 5ms 且当前最高优任务未超时，主动让出主线程
        if (currentTime - startTime >= frameBudget && !didTimeout) {
          break;
        }

        const callback = this.currentTask.callback;
        const continuation = callback(didTimeout);

        // 如果回调返回 true，说明切片未跑完，保留堆顶续跑
        if (continuation === true) {
          // 重新检查当前堆顶：如果有更高优任务插队进来了，让出执行权
          const topTask = this.taskQueue.peek();
          if (topTask && topTask.id !== this.currentTask.id) {
            break;
          }
        } else {
          // 当前任务彻底完结，移出堆顶
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

      // 如果堆中还有剩余任务，继续调度下一轮让出循环
      if (hasMoreWork) {
        this.requestHostCallback();
      }
    }
  }
}
