import { TaskScheduler, PriorityLevel } from "./scheduler";

const btnBlock = document.getElementById("btn-block") as HTMLButtonElement;
const btnSlice = document.getElementById("btn-slice") as HTMLButtonElement;
const progressFill = document.getElementById("progress") as HTMLDivElement;
const statusText = document.getElementById("status") as HTMLDivElement;
const logContainer = document.getElementById("log") as HTMLDivElement;
const fpsVal = document.getElementById("fps-val") as HTMLDivElement;

const spinnerCanvas = document.getElementById("raf-spinner") as HTMLCanvasElement;
const sCtx = spinnerCanvas.getContext("2d")!;
const scheduler = new TaskScheduler();

// 1. requestAnimationFrame 实时 FPS 监控
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

// 2. 算力消耗单元（防死代码消除）
let globalSink = 0;
function heavyWorkUnit(i: number): number {
  let acc = i;
  for (let j = 0; j < 3000; j++) {
    acc = ((acc ^ j) * 1664525 + 1013904223) | 0;
  }
  return acc;
}

// 3. 替换为优先级控制按钮
btnBlock.textContent = "启动后台长任务 (Background, 30万单元)";
btnSlice.textContent = "插队高优用户操作 (UserBlocking)";
btnSlice.className = "btn-block";
btnBlock.className = "btn-slice";

const TOTAL_UNITS = 300_000;
let backgroundIndex = 0;

// 触发低优后台切片
btnBlock.addEventListener("click", () => {
  if (backgroundIndex > 0 && backgroundIndex < TOTAL_UNITS) {
    log("后台任务正在运行中...");
    return;
  }

  backgroundIndex = 0;
  progressFill.style.width = "0%";
  log(`[Background] 任务入队 (优先级: Background)...`);

  const t0 = performance.now();

  scheduler.postTask((didTimeout) => {
    const sliceStart = performance.now();

    // 在单切片内运行子任务，直到用尽时间切片或当前任务到期
    while (backgroundIndex < TOTAL_UNITS) {
      globalSink += heavyWorkUnit(backgroundIndex);
      backgroundIndex++;

      // 5ms 边界检测
      if (performance.now() - sliceStart >= 5 && !didTimeout) {
        const ratio = backgroundIndex / TOTAL_UNITS;
        progressFill.style.width = `${(ratio * 100).toFixed(1)}%`;
        statusText.textContent = `后台切片推进中: ${(ratio * 100).toFixed(0)}%`;
        return true; // 返回 true：未完结，保留在堆中继续切片
      }
    }

    // 执行完毕
    const elapsed = performance.now() - t0;
    progressFill.style.width = "100%";
    statusText.textContent = `后台任务全部执行完成，总耗时: ${elapsed.toFixed(1)} ms`;
    log(`[Background] 任务执行完毕，耗时 ${elapsed.toFixed(1)} ms`);
    return false;
  }, PriorityLevel.Background);
});

// 突发高优事件（模拟用户突然触发的紧急动作）
btnSlice.addEventListener("click", () => {
  log(`⚡ [UserBlocking] 高优用户任务突发插队！`);

  scheduler.postTask(() => {
    const t0 = performance.now();
    let localAcc = 0;

    // 运行 2,000 个高优计算单元
    for (let i = 0; i < 2000; i++) {
      localAcc += heavyWorkUnit(i);
    }
    globalSink += localAcc;

    const cost = performance.now() - t0;
    log(`⚡⚡ [UserBlocking] 高优任务优先处理完毕！耗时: ${cost.toFixed(2)} ms`);
    return false;
  }, PriorityLevel.UserBlocking);
});
