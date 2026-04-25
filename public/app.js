const els = {
  apiState: document.querySelector("#apiState"),
  authForm: document.querySelector("#authForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  loginButton: document.querySelector("#loginButton"),
  registerButton: document.querySelector("#registerButton"),
  userPanel: document.querySelector("#userPanel"),
  currentUserName: document.querySelector("#currentUserName"),
  logoutButton: document.querySelector("#logoutButton"),
  accountGrid: document.querySelector("#accountGrid"),
  weightInput: document.querySelector("#weightInput"),
  targetInput: document.querySelector("#targetInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  recordDate: document.querySelector("#recordDate"),
  dayCalories: document.querySelector("#dayCalories"),
  dayTarget: document.querySelector("#dayTarget"),
  dayRemaining: document.querySelector("#dayRemaining"),
  goalFill: document.querySelector("#goalFill"),
  mealBreakdown: document.querySelector("#mealBreakdown"),
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
  refreshMealsButton: document.querySelector("#refreshMealsButton"),
};

const TOKEN_KEY = "calorieLens.authToken.v1";
const MEAL_LABELS = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

let cameraStream = null;
let currentImage = "";
let currentAnalysis = null;
let currentSource = "";
let currentUser = null;
let multiplier = 1;

boot();

function boot() {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  els.recordDate.value = localDateString();
  bindEvents();
  checkHealth();
  restoreSession();
}

function bindEvents() {
  els.authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    login();
  });
  els.registerButton.addEventListener("click", register);
  els.logoutButton.addEventListener("click", logout);
  els.saveSettingsButton.addEventListener("click", saveSettings);
  els.recordDate.addEventListener("change", loadMeals);
  els.refreshMealsButton.addEventListener("click", loadMeals);
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

async function restoreSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    renderAuthState();
    renderEmptyMeals("登录后会显示每日记录。");
    return;
  }

  try {
    const data = await apiFetch("/api/me");
    currentUser = data.user;
    renderAuthState();
    await loadMeals();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    currentUser = null;
    renderAuthState();
    renderEmptyMeals("登录后会显示每日记录。");
  }
}

async function login() {
  await submitAuth("/api/auth/login");
}

async function register() {
  await submitAuth("/api/auth/register");
}

async function submitAuth(path) {
  const username = els.usernameInput.value.trim();
  const password = els.passwordInput.value;
  if (!username || password.length < 6) {
    setStatus("请输入用户名和至少 6 位密码。", "error");
    return;
  }

  try {
    const data = await apiFetch(path, {
      method: "POST",
      body: { username, password },
      skipAuth: true,
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    currentUser = data.user;
    els.passwordInput.value = "";
    renderAuthState();
    await loadMeals();
    setStatus("账号已登录。");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Logout should still clear local state if the server token is already stale.
  }

  localStorage.removeItem(TOKEN_KEY);
  currentUser = null;
  renderAuthState();
  renderEmptyMeals("登录后会显示每日记录。");
  setStatus("已退出登录。");
}

function renderAuthState() {
  const isLoggedIn = Boolean(currentUser);
  els.authForm.hidden = isLoggedIn;
  els.userPanel.hidden = !isLoggedIn;
  els.accountGrid.hidden = !isLoggedIn;

  if (!isLoggedIn) {
    els.currentUserName.textContent = "未登录";
    return;
  }

  els.currentUserName.textContent = currentUser.username;
  els.weightInput.value = currentUser.settings.weightKg;
  els.targetInput.value = currentUser.settings.targetCalories;
  els.dayTarget.textContent = `${formatNumber(currentUser.settings.targetCalories)} kcal`;
}

async function saveSettings() {
  if (!currentUser) {
    setStatus("请先登录。", "error");
    return;
  }

  try {
    const data = await apiFetch("/api/settings", {
      method: "PUT",
      body: {
        weightKg: Number(els.weightInput.value),
        targetCalories: Number(els.targetInput.value),
      },
    });
    currentUser = data.user;
    renderAuthState();
    await loadMeals();
    setStatus("目标已保存。");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function loadMeals() {
  if (!currentUser) {
    renderEmptyMeals("登录后会显示每日记录。");
    return;
  }

  try {
    const date = els.recordDate.value || localDateString();
    const data = await apiFetch(`/api/meals?date=${encodeURIComponent(date)}`);
    renderDailySummary(data.summary);
    renderMeals(data.meals);
  } catch (error) {
    setStatus(error.message, "error");
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

    if (currentUser) {
      await saveMealRecord(currentAnalysis);
      await loadMeals();
      setStatus(currentSource === "demo" ? "已记录演示结果。" : "分析完成，已加入每日记录。");
    } else {
      setStatus("分析完成。登录后可保存到每日记录。");
    }

    checkHealth();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.analyzeButton.disabled = false;
  }
}

async function saveMealRecord(analysis) {
  const thumbnail = await createThumbnail(currentImage);
  await apiFetch("/api/meals", {
    method: "POST",
    body: {
      date: els.recordDate.value || localDateString(),
      mealType: getSelectedMealType(),
      notes: els.mealNotes.value.trim(),
      source: currentSource,
      thumbnail,
      analysis,
    },
  });
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

function renderDailySummary(summary = {}) {
  const total = summary.totalCalories || 0;
  const target = summary.targetCalories || currentUser?.settings?.targetCalories || 0;
  const remaining = summary.remainingCalories ?? target - total;
  const percent = Math.min(100, Math.round((summary.progress || 0) * 100));
  els.dayCalories.textContent = `${formatNumber(total)} kcal`;
  els.dayTarget.textContent = `${formatNumber(target)} kcal`;
  els.dayRemaining.textContent = `${formatNumber(remaining)} kcal`;
  els.goalFill.style.width = `${percent}%`;

  const byMealType = summary.byMealType || {};
  els.mealBreakdown.hidden = false;
  els.mealBreakdown.innerHTML = Object.entries(MEAL_LABELS)
    .map(([key, label]) => `<span>${label}<strong>${formatNumber(byMealType[key] || 0)} kcal</strong></span>`)
    .join("");
}

function renderMeals(meals = []) {
  if (!currentUser) {
    renderEmptyMeals("登录后会显示每日记录。");
    return;
  }

  if (!meals.length) {
    els.historyList.innerHTML = '<p class="empty-copy">这一天还没有记录。</p>';
    return;
  }

  els.historyList.innerHTML = meals
    .map(
      (meal) => `
        <article class="history-item meal-record">
          ${meal.thumbnail ? `<img src="${meal.thumbnail}" alt="${escapeHtml(meal.dishName || "餐食照片")}" />` : ""}
          <div class="history-meta">
            <span class="meal-label">${MEAL_LABELS[meal.mealType] || "餐食"}</span>
            <strong>${escapeHtml(meal.dishName || "餐食")}</strong>
            <span>${formatNumber(meal.totalCalories)} kcal · ${formatDate(meal.createdAt)}</span>
            <span>蛋白 ${formatNumber(meal.macros?.protein_g, 1)}g / 碳水 ${formatNumber(meal.macros?.carbs_g, 1)}g / 脂肪 ${formatNumber(
              meal.macros?.fat_g,
              1,
            )}g</span>
            <button class="ghost-button delete-meal-button" type="button" data-id="${meal.id}">
              <i data-lucide="trash-2"></i>
              删除
            </button>
          </div>
        </article>
      `,
    )
    .join("");

  els.historyList.querySelectorAll(".delete-meal-button").forEach((button) => {
    button.addEventListener("click", () => deleteMeal(button.dataset.id));
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderEmptyMeals(message) {
  els.dayCalories.textContent = "0 kcal";
  els.dayTarget.textContent = currentUser ? `${formatNumber(currentUser.settings.targetCalories)} kcal` : "-- kcal";
  els.dayRemaining.textContent = currentUser ? `${formatNumber(currentUser.settings.targetCalories)} kcal` : "-- kcal";
  els.goalFill.style.width = "0";
  els.mealBreakdown.hidden = true;
  els.historyList.innerHTML = `<p class="empty-copy">${escapeHtml(message)}</p>`;
}

async function deleteMeal(id) {
  try {
    await apiFetch(`/api/meals/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadMeals();
    setStatus("记录已删除。");
  } catch (error) {
    setStatus(error.message, "error");
  }
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

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && !options.skipAuth) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function getSelectedMealType() {
  return document.querySelector('input[name="mealType"]:checked')?.value || "lunch";
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

function localDateString() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}
