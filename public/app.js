const els = {
  apiState: document.querySelector("#apiState"),
  cameraButton: document.querySelector("#cameraButton"),
  captureButton: document.querySelector("#captureButton"),
  clearButton: document.querySelector("#clearButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  fileInput: document.querySelector("#fileInput"),
  cameraVideo: document.querySelector("#cameraVideo"),
  previewImage: document.querySelector("#previewImage"),
  captureCanvas: document.querySelector("#captureCanvas"),
  emptyState: document.querySelector("#emptyState"),
  dropZone: document.querySelector("#dropZone"),
  mealNotes: document.querySelector("#mealNotes"),
  statusLine: document.querySelector("#statusLine"),
  confidenceBadge: document.querySelector("#confidenceBadge"),
  totalCalories: document.querySelector("#totalCalories"),
  calorieRange: document.querySelector("#calorieRange"),
  portionMultiplier: document.querySelector("#portionMultiplier"),
  multiplierValue: document.querySelector("#multiplierValue"),
  warningBox: document.querySelector("#warningBox"),
  proteinBar: document.querySelector("#proteinBar"),
  carbsBar: document.querySelector("#carbsBar"),
  fatBar: document.querySelector("#fatBar"),
  proteinValue: document.querySelector("#proteinValue"),
  carbsValue: document.querySelector("#carbsValue"),
  fatValue: document.querySelector("#fatValue"),
  itemsList: document.querySelector("#itemsList"),
  portionSummary: document.querySelector("#portionSummary"),
  assumptionsList: document.querySelector("#assumptionsList"),
  historyList: document.querySelector("#historyList"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
};

const HISTORY_KEY = "calorieLens.history.v1";

let cameraStream = null;
let currentImage = "";
let currentAnalysis = null;
let currentSource = "";
let multiplier = 1;

boot();

function boot() {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  checkHealth();
  bindEvents();
  renderHistory();
}

function bindEvents() {
  els.cameraButton.addEventListener("click", startCamera);
  els.captureButton.addEventListener("click", capturePhoto);
  els.clearButton.addEventListener("click", resetCapture);
  els.analyzeButton.addEventListener("click", analyzeCurrentImage);
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    if (file) {
      useImageFile(file);
    }
  });

  els.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropZone.classList.add("drag-over");
  });

  els.dropZone.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("drag-over");
  });

  els.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("drag-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      useImageFile(file);
    }
  });

  els.portionMultiplier.addEventListener("input", () => {
    multiplier = Number(els.portionMultiplier.value);
    els.multiplierValue.textContent = `${multiplier.toFixed(1)}x`;
    if (currentAnalysis) {
      renderAnalysis(currentAnalysis, currentSource);
    }
  });

  els.clearHistoryButton.addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    els.apiState.classList.toggle("ready", data.aiConfigured);
    els.apiState.classList.toggle("demo", !data.aiConfigured);
    const providerName = data.providerLabel || "AI";
    els.apiState.textContent = data.aiConfigured
      ? `${providerName} 已连接：${data.model}`
      : `演示模式：未配置 ${providerName} API key`;
  } catch {
    els.apiState.textContent = "服务不可用";
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("当前浏览器不支持摄像头，请改用上传照片。", "error");
    return;
  }

  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1600 },
        height: { ideal: 1200 },
      },
      audio: false,
    });

    els.cameraVideo.srcObject = cameraStream;
    await els.cameraVideo.play();
    currentImage = "";
    showVideo();
    els.captureButton.disabled = false;
    els.analyzeButton.disabled = true;
    setStatus("相机已开启，确认画面后点击拍照。");
  } catch (error) {
    setStatus(`无法打开相机：${error.message}`, "error");
  }
}

function capturePhoto() {
  if (!els.cameraVideo.videoWidth) {
    setStatus("相机画面还没有准备好。", "error");
    return;
  }

  currentImage = drawElementToDataUrl(els.cameraVideo);
  els.previewImage.src = currentImage;
  showImage();
  els.captureButton.disabled = true;
  els.analyzeButton.disabled = false;
  stopCamera();
  setStatus("照片已捕获，可以开始分析。");
}

async function useImageFile(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("请选择图片文件。", "error");
    return;
  }

  try {
    stopCamera();
    currentImage = await resizeFileToDataUrl(file);
    els.previewImage.src = currentImage;
    showImage();
    els.captureButton.disabled = true;
    els.analyzeButton.disabled = false;
    setStatus("图片已载入，可以开始分析。");
  } catch (error) {
    setStatus(`图片读取失败：${error.message}`, "error");
  }
}

async function analyzeCurrentImage() {
  if (!currentImage) {
    setStatus("请先拍照或上传图片。", "error");
    return;
  }

  els.analyzeButton.disabled = true;
  setStatus("正在识别食物和估算热量...");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: currentImage,
        notes: els.mealNotes.value.trim(),
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.error || "分析失败");
    }

    currentAnalysis = data.analysis;
    currentSource = data.source || "openai";
    multiplier = 1;
    els.portionMultiplier.value = "1";
    els.multiplierValue.textContent = "1.0x";
    els.portionMultiplier.disabled = false;
    renderAnalysis(currentAnalysis, currentSource);
    await saveHistory(currentAnalysis);
    setStatus(currentSource === "demo" ? "已显示演示结果。配置 API key 后可识别真实照片。" : "分析完成。");
    checkHealth();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.analyzeButton.disabled = false;
  }
}

function renderAnalysis(analysis, source) {
  const scaled = scaleAnalysis(analysis, multiplier);
  const confidence = Math.round((analysis.confidence || 0) * 100);
  const isDemo = source === "demo";

  els.confidenceBadge.textContent = isDemo ? "演示数据" : `置信度 ${confidence}%`;
  els.totalCalories.textContent = formatNumber(scaled.total_calories);
  els.calorieRange.textContent = `${formatNumber(scaled.calorie_range.low)} - ${formatNumber(
    scaled.calorie_range.high,
  )} kcal · ${analysis.dish_name || "餐食"}`;
  els.portionSummary.textContent = analysis.portion_summary || "暂无份量说明。";

  renderWarning(analysis, source);
  renderMacros(scaled.macros);
  renderItems(scaled.items);
  renderAssumptions(analysis);
}

function scaleAnalysis(analysis, ratio) {
  return {
    ...analysis,
    total_calories: round(analysis.total_calories * ratio),
    calorie_range: {
      low: round(analysis.calorie_range.low * ratio),
      high: round(analysis.calorie_range.high * ratio),
    },
    macros: {
      protein_g: round(analysis.macros.protein_g * ratio, 1),
      carbs_g: round(analysis.macros.carbs_g * ratio, 1),
      fat_g: round(analysis.macros.fat_g * ratio, 1),
    },
    items: analysis.items.map((item) => ({
      ...item,
      calories: round(item.calories * ratio),
      protein_g: round(item.protein_g * ratio, 1),
      carbs_g: round(item.carbs_g * ratio, 1),
      fat_g: round(item.fat_g * ratio, 1),
    })),
  };
}

function renderWarning(analysis, source) {
  const messages = [];
  if (source === "demo") {
    messages.push("当前是演示模式，结果不代表上传图片内容。");
  }
  if (analysis.not_food_warning) {
    messages.push(analysis.not_food_warning);
  }
  if (analysis.health_notes?.length) {
    messages.push(...analysis.health_notes);
  }

  els.warningBox.hidden = messages.length === 0;
  els.warningBox.textContent = messages.join(" ");
}

function renderMacros(macros) {
  const proteinCalories = macros.protein_g * 4;
  const carbsCalories = macros.carbs_g * 4;
  const fatCalories = macros.fat_g * 9;
  const total = Math.max(1, proteinCalories + carbsCalories + fatCalories);

  els.proteinValue.textContent = `${formatNumber(macros.protein_g, 1)}g`;
  els.carbsValue.textContent = `${formatNumber(macros.carbs_g, 1)}g`;
  els.fatValue.textContent = `${formatNumber(macros.fat_g, 1)}g`;

  els.proteinBar.style.width = `${Math.max(4, (proteinCalories / total) * 100)}%`;
  els.carbsBar.style.width = `${Math.max(4, (carbsCalories / total) * 100)}%`;
  els.fatBar.style.width = `${Math.max(4, (fatCalories / total) * 100)}%`;
}

function renderItems(items) {
  if (!items?.length) {
    els.itemsList.innerHTML = '<p class="empty-copy">没有识别到明确的食物项。</p>';
    return;
  }

  els.itemsList.innerHTML = items
    .map(
      (item) => `
        <article class="food-item">
          <div>
            <h4>${escapeHtml(item.name)}</h4>
            <p>${escapeHtml(item.estimated_portion)} · 蛋白 ${formatNumber(item.protein_g, 1)}g / 碳水 ${formatNumber(
              item.carbs_g,
              1,
            )}g / 脂肪 ${formatNumber(item.fat_g, 1)}g</p>
            ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
          </div>
          <strong>${formatNumber(item.calories)} kcal</strong>
        </article>
      `,
    )
    .join("");
}

function renderAssumptions(analysis) {
  const assumptions = [...(analysis.assumptions || [])];
  if (!assumptions.length) {
    els.assumptionsList.innerHTML = '<li>模型未返回额外假设。</li>';
    return;
  }

  els.assumptionsList.innerHTML = assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function resetCapture() {
  stopCamera();
  currentImage = "";
  currentAnalysis = null;
  currentSource = "";
  els.previewImage.removeAttribute("src");
  els.fileInput.value = "";
  els.captureButton.disabled = true;
  els.analyzeButton.disabled = true;
  els.portionMultiplier.disabled = true;
  els.portionMultiplier.value = "1";
  els.multiplierValue.textContent = "1.0x";
  showEmpty();
  resetResults();
  setStatus("等待照片。");
}

function resetResults() {
  els.confidenceBadge.textContent = "--";
  els.totalCalories.textContent = "--";
  els.calorieRange.textContent = "上传照片后显示估算范围";
  els.warningBox.hidden = true;
  els.proteinValue.textContent = "--";
  els.carbsValue.textContent = "--";
  els.fatValue.textContent = "--";
  els.proteinBar.style.width = "0";
  els.carbsBar.style.width = "0";
  els.fatBar.style.width = "0";
  els.itemsList.innerHTML = '<p class="empty-copy">分析后会显示每个食物项的份量和热量。</p>';
  els.portionSummary.textContent = "暂无。";
  els.assumptionsList.innerHTML = "";
}

function showVideo() {
  els.emptyState.hidden = true;
  els.previewImage.hidden = true;
  els.cameraVideo.hidden = false;
}

function showImage() {
  els.emptyState.hidden = true;
  els.cameraVideo.hidden = true;
  els.previewImage.hidden = false;
}

function showEmpty() {
  els.emptyState.hidden = false;
  els.cameraVideo.hidden = true;
  els.previewImage.hidden = true;
}

function stopCamera() {
  if (!cameraStream) {
    return;
  }
  for (const track of cameraStream.getTracks()) {
    track.stop();
  }
  cameraStream = null;
  els.cameraVideo.srcObject = null;
}

function drawElementToDataUrl(source) {
  const maxEdge = 1600;
  const sourceWidth = source.videoWidth || source.naturalWidth;
  const sourceHeight = source.videoHeight || source.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  els.captureCanvas.width = width;
  els.captureCanvas.height = height;
  const context = els.captureCanvas.getContext("2d");
  context.drawImage(source, 0, 0, width, height);
  return els.captureCanvas.toDataURL("image/jpeg", 0.86);
}

function resizeFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      try {
        resolve(drawElementToDataUrl(image));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取该图片。"));
    };
    image.src = objectUrl;
  });
}

async function saveHistory(analysis) {
  try {
    const history = readHistory();
    const thumbnail = await createThumbnail(currentImage);
    history.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      source: currentSource,
      thumbnail,
      analysis,
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 5)));
    renderHistory();
  } catch {
    setStatus("分析完成，但本地历史记录空间不足，未保存缩略图。");
  }
}

function renderHistory() {
  const history = readHistory();
  if (!history.length) {
    els.historyList.innerHTML = '<p class="empty-copy">还没有分析记录。</p>';
    return;
  }

  els.historyList.innerHTML = history
    .map(
      (entry) => `
        <button class="history-item" type="button" data-id="${entry.id}">
          <img src="${entry.thumbnail}" alt="${escapeHtml(entry.analysis.dish_name || "餐食照片")}" />
          <span class="history-meta">
            <strong>${escapeHtml(entry.analysis.dish_name || "餐食")}</strong>
            <span>${formatNumber(entry.analysis.total_calories)} kcal · ${formatDate(entry.createdAt)}</span>
          </span>
        </button>
      `,
    )
    .join("");

  els.historyList.querySelectorAll(".history-item").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = history.find((item) => item.id === button.dataset.id);
      if (!entry) {
        return;
      }
      currentAnalysis = entry.analysis;
      currentSource = entry.source;
      currentImage = entry.thumbnail;
      els.previewImage.src = entry.thumbnail;
      showImage();
      els.analyzeButton.disabled = false;
      els.portionMultiplier.disabled = false;
      multiplier = 1;
      els.portionMultiplier.value = "1";
      els.multiplierValue.textContent = "1.0x";
      renderAnalysis(currentAnalysis, currentSource);
      setStatus("已载入历史记录。");
    });
  });
}

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createThumbnail(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const maxWidth = 360;
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    image.onerror = () => reject(new Error("无法生成缩略图。"));
    image.src = dataUrl;
  });
}

function setStatus(message, type = "info") {
  els.statusLine.textContent = message;
  els.statusLine.style.color = type === "error" ? "var(--danger)" : "var(--muted)";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(number);
}

function formatDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}
