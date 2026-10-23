import { TaskScheduler, PriorityLevel, type Task } from "./scheduler";

const btnBg = document.getElementById("btn-bg") as HTMLButtonElement;
const btnUrgent = document.getElementById("btn-urgent") as HTMLButtonElement;
const btnCancel = document.getElementById("btn-cancel") as HTMLButtonElement;
const btnStarve = document.getElementById("btn-starve") as HTMLButtonElement;

const progressFill = document.getElementById("progress") as HTMLDivElement;
const statusText = document.getElementById("status") as HTMLDivElement;
const logContainer = document.getElementById("log") as HTMLDivElement;
const fpsVal = document.getElementById("fps-val") as HTMLDivElement;

const spinnerCanvas = document.getElementById("raf-spinner") as HTMLCanvasElement;
const sCtx = spinnerCanvas.getContext("2d")!;
const scheduler = new TaskScheduler();

let starvationAlertLogged = false;

// 监听防饥饿提权事件
scheduler.onStarvationResolved = (task, waitTimeMs) => {
  if (!starvationAlertLogged) {
    starvationAlertLogged = true;
    log(
      `⚠️ [防饥饿触发] Task #${task.id} 耗时/等待已达 ${waitTimeMs.toFixed(0)}ms (超过 800ms 阈值)，剥夺让出权强制同步冲刷到底！`,
    );
  }
};

let angle = 0;
let lastFrameTime = performance.now();
let frameCount = 0;

function animateMonitor(now: number) {
  frameCount++;
  if (now - lastFrameTime >= 500) {
    const currentFps = Math.round((frameCount * 1000) / (now - lastFrameTime));
    fpsVal.textContent = `${currentFps} FPS`;
    fpsVal.style.color = currentFps < 30 ? "#ef4444" : "#38bdf8";
    frameCount = 0;
    lastFrameTime = now;
  }

  angle += 0.08;
  sCtx.clearRect(0, 0, 48, 48);
  sCtx.save();
  sCtx.translate(24, 24);
  sCtx.rotate(angle);

  sCtx.beginPath();
  sCtx.arc(0, 0, 18, 0, Math.PI * 1.4);
  sCtx.lineWidth = 4;
  sCtx.strokeStyle = "#38bdf8";
  sCtx.lineCap = "round";
  sCtx.stroke();
  sCtx.restore();

  requestAnimationFrame(animateMonitor);
}
requestAnimationFrame(animateMonitor);

function log(msg: string) {
  logContainer.textContent =
    `[${new Date().toLocaleTimeString()}] ${msg}\n` + logContainer.textContent;
}

let globalSink = 0;
function heavyWorkUnit(i: number): number {
  let acc = i;
  for (let j = 0; j < 3000; j++) {
    acc = ((acc ^ j) * 1664525 + 1013904223) | 0;
  }
  return acc;
}

const TOTAL_UNITS = 300_000;
let backgroundIndex = 0;
let currentBgTask: Task | null = null;
let bgAbortController: AbortController | null = null;

// 1. 启动后台切片任务
btnBg.addEventListener("click", () => {
  if (backgroundIndex > 0 && backgroundIndex < TOTAL_UNITS) {
    log("后台任务正在运行中...");
    return;
  }

  backgroundIndex = 0;
  starvationAlertLogged = false;
  progressFill.style.width = "0%";
  bgAbortController = new AbortController();

  log(`[Background] 任务入队 (优先级: Background, 阈值: 800ms)...`);
  const t0 = performance.now();

  currentBgTask = scheduler.postTask(
    (didTimeout) => {
      const sliceStart = performance.now();

      while (backgroundIndex < TOTAL_UNITS) {
        globalSink += heavyWorkUnit(backgroundIndex);
        backgroundIndex++;

        // didTimeout 为 true 时剥夺让出权，直接一口气冲完
        if (performance.now() - sliceStart >= 5 && !didTimeout) {
          const ratio = backgroundIndex / TOTAL_UNITS;
          progressFill.style.width = `${(ratio * 100).toFixed(1)}%`;
          statusText.textContent = `后台切片推进中: ${(ratio * 100).toFixed(0)}%`;
          return true;
        }
      }

      const elapsed = performance.now() - t0;
      progressFill.style.width = "100%";
      statusText.textContent = `执行完成，总耗时: ${elapsed.toFixed(1)} ms`;
      log(`[Background] 任务全部执行完毕，总耗时 ${elapsed.toFixed(1)} ms`);
      currentBgTask = null;
      bgAbortController = null;
      return false;
    },
    {
      priority: PriorityLevel.Background,
      signal: bgAbortController.signal,
    },
  );
});

// 2. 突发单次高优操作插队
btnUrgent.addEventListener("click", () => {
  log(`⚡ [UserBlocking] 单次高优用户任务突发插队！`);
  scheduler.postTask(
    () => {
      const t0 = performance.now();
      let acc = 0;
      for (let i = 0; i < 2000; i++) acc += heavyWorkUnit(i);
      globalSink += acc;
      const cost = performance.now() - t0;
      log(`⚡⚡ [UserBlocking] 高优任务处理完毕！耗时: ${cost.toFixed(2)} ms`);
      return false;
    },
    { priority: PriorityLevel.UserBlocking },
  );
});

// 3. 取消任务
btnCancel.addEventListener("click", () => {
  if (bgAbortController) {
    bgAbortController.abort();
    log(`🛑 [Abort] 外部发出取消信号，后台任务已主动终止！`);
    statusText.textContent = `任务已取消（停止于 ${((backgroundIndex / TOTAL_UNITS) * 100).toFixed(
      1,
    )}%）`;
    currentBgTask = null;
    bgAbortController = null;
  } else {
    log(`当前没有运行中的后台任务可取消`);
  }
});

// 4. 连续高优压制（通过自循环持续投递高优任务，彻底封死主线程）
let isFlooding = false;
function scheduleNextFloodTask() {
  if (!isFlooding) return;

  scheduler.postTask(
    () => {
      let acc = 0;
      // 每次跑 3000 个循环，占据约 10ms
      for (let i = 0; i < 3000; i++) acc += heavyWorkUnit(i);
      globalSink += acc;

      // 递归入队下一个高优任务，形成连绵不绝的压制链
      if (isFlooding) {
        scheduleNextFloodTask();
      }
      return false;
    },
    { priority: PriorityLevel.UserBlocking },
  );
}

btnStarve.addEventListener("click", () => {
  if (isFlooding) {
    isFlooding = false;
    btnStarve.textContent = "4. 持续高优压制 (测试防饥饿)";
    log("已停止高优压制。");
    return;
  }

  isFlooding = true;
  btnStarve.textContent = "正在持续高优压制中 (点击停止)...";
  log("💣 开启持续高优压制链：连续投递 UserBlocking 霸占主线程...");
  scheduleNextFloodTask();
});

const strategyText = scheduler.isNativeYieldSupported
  ? "Native (scheduler.yield)"
  : "Fallback (MessageChannel)";
log(`调度系统启动，让出驱动模式: ${strategyText}`);
