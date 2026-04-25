import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "app-db.json");
const AI_PROVIDER = normalizeProvider(
  process.env.AI_PROVIDER || (process.env.SILICONFLOW_API_KEY ? "siliconflow" : "openai"),
);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "low";
const OPENAI_TEXT_VERBOSITY = process.env.OPENAI_TEXT_VERBOSITY || "low";
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
const SILICONFLOW_BASE_URL = process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.com/v1";
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || "Qwen/Qwen2.5-VL-32B-Instruct";
const ACTIVE_API_KEY = AI_PROVIDER === "siliconflow" ? SILICONFLOW_API_KEY : OPENAI_API_KEY;
const ACTIVE_MODEL = AI_PROVIDER === "siliconflow" ? SILICONFLOW_MODEL : OPENAI_MODEL;
const ACTIVE_PROVIDER_LABEL = AI_PROVIDER === "siliconflow" ? "SiliconFlow" : "OpenAI";
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const TOKEN_BYTES = 32;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dish_name: { type: "string" },
    total_calories: { type: "number" },
    calorie_range: {
      type: "object",
      additionalProperties: false,
      properties: {
        low: { type: "number" },
        high: { type: "number" },
      },
      required: ["low", "high"],
    },
    confidence: { type: "number" },
    portion_summary: { type: "string" },
    macros: {
      type: "object",
      additionalProperties: false,
      properties: {
        protein_g: { type: "number" },
        carbs_g: { type: "number" },
        fat_g: { type: "number" },
      },
      required: ["protein_g", "carbs_g", "fat_g"],
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          estimated_portion: { type: "string" },
          calories: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
          confidence: { type: "number" },
          notes: { type: "string" },
        },
        required: [
          "name",
          "estimated_portion",
          "calories",
          "protein_g",
          "carbs_g",
          "fat_g",
          "confidence",
          "notes",
        ],
      },
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
    },
    health_notes: {
      type: "array",
      items: { type: "string" },
    },
    not_food_warning: { type: "string" },
  },
  required: [
    "dish_name",
    "total_calories",
    "calorie_range",
    "confidence",
    "portion_summary",
    "macros",
    "items",
    "assumptions",
    "health_notes",
    "not_food_warning",
  ],
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        aiConfigured: Boolean(ACTIVE_API_KEY),
        provider: AI_PROVIDER,
        providerLabel: ACTIVE_PROVIDER_LABEL,
        model: ACTIVE_MODEL,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      return handleRegister(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      return handleLogin(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      return handleLogout(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      return handleMe(req, res);
    }

    if (req.method === "PUT" && url.pathname === "/api/settings") {
      return handleSettings(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/meals") {
      return handleGetMeals(req, res, url);
    }

    if (req.method === "POST" && url.pathname === "/api/meals") {
      return handleCreateMeal(req, res);
    }

    const mealDeleteMatch = url.pathname.match(/^\/api\/meals\/([^/]+)$/);
    if (req.method === "DELETE" && mealDeleteMatch) {
      return handleDeleteMeal(req, res, mealDeleteMatch[1]);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    return serveStatic(url.pathname, req, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CalorieLens running at http://localhost:${PORT}`);
  console.log(`AI provider: ${ACTIVE_PROVIDER_LABEL}, model: ${ACTIVE_MODEL}`);
  if (!ACTIVE_API_KEY) {
    console.log(`${getProviderKeyName()} is not set. The app will return demo results.`);
  }
});

async function handleAnalyze(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
    return sendJson(res, status, { error: error.message });
  }

  const image = typeof payload.image === "string" ? payload.image : "";
  const notes = typeof payload.notes === "string" ? payload.notes.slice(0, 500) : "";

  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(image)) {
    return sendJson(res, 400, { error: "请上传 PNG、JPG 或 WebP 图片。" });
  }

  if (!ACTIVE_API_KEY) {
    return sendJson(res, 200, {
      source: "demo",
      analysis: createDemoAnalysis(notes),
    });
  }

  try {
    const analysis = await analyzeFoodImage(image, notes);
    return sendJson(res, 200, {
      source: AI_PROVIDER,
      provider: ACTIVE_PROVIDER_LABEL,
      model: ACTIVE_MODEL,
      analysis: normalizeAnalysis(analysis),
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 502, {
      error: `AI 分析失败。请检查 ${getProviderKeyName()}、模型权限或稍后重试。`,
      detail: error.message,
    });
  }
}

async function handleRegister(req, res) {
  const payload = await readJsonBodySafe(req, res);
  if (!payload) return;

  const username = normalizeUsername(payload.username);
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!username || password.length < 6) {
    return sendJson(res, 400, { error: "用户名不能为空，密码至少 6 位。" });
  }

  const db = await readDb();
  if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return sendJson(res, 409, { error: "这个用户名已经存在。" });
  }

  const passwordRecord = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash: passwordRecord.hash,
    passwordSalt: passwordRecord.salt,
    createdAt: new Date().toISOString(),
    settings: {
      weightKg: 65,
      targetCalories: 1800,
    },
  };
  const session = createSession(user.id);
  db.users.push(user);
  db.sessions.push(session);
  await writeDb(db);

  return sendJson(res, 201, {
    token: session.token,
    user: publicUser(user),
  });
}

async function handleLogin(req, res) {
  const payload = await readJsonBodySafe(req, res);
  if (!payload) return;

  const username = normalizeUsername(payload.username);
  const password = typeof payload.password === "string" ? payload.password : "";
  const db = await readDb();
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());

  if (!user || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
    return sendJson(res, 401, { error: "用户名或密码不正确。" });
  }

  const session = createSession(user.id);
  db.sessions = db.sessions.filter((item) => item.userId !== user.id || !isExpiredSession(item));
  db.sessions.push(session);
  await writeDb(db);

  return sendJson(res, 200, {
    token: session.token,
    user: publicUser(user),
  });
}

async function handleLogout(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    return sendJson(res, 200, { ok: true });
  }

  const db = await readDb();
  db.sessions = db.sessions.filter((session) => session.token !== token);
  await writeDb(db);
  return sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  return sendJson(res, 200, { user: publicUser(auth.user) });
}

async function handleSettings(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const payload = await readJsonBodySafe(req, res);
  if (!payload) return;

  const weightKg = clamp(numberOrZero(payload.weightKg), 20, 350);
  const targetCalories = clamp(numberOrZero(payload.targetCalories), 500, 6000);
  if (!weightKg || !targetCalories) {
    return sendJson(res, 400, { error: "请输入有效的体重和目标热量。" });
  }

  auth.user.settings = {
    weightKg: roundNumber(weightKg, 1),
    targetCalories: Math.round(targetCalories),
  };
  await writeDb(auth.db);
  return sendJson(res, 200, { user: publicUser(auth.user) });
}

async function handleGetMeals(req, res, url) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const date = sanitizeDate(url.searchParams.get("date")) || todayDate();
  const meals = auth.db.meals
    .filter((meal) => meal.userId === auth.user.id && meal.date === date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sendJson(res, 200, {
    date,
    summary: summarizeMeals(meals, auth.user.settings),
    meals,
  });
}

async function handleCreateMeal(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const payload = await readJsonBodySafe(req, res);
  if (!payload) return;

  const analysis = normalizeAnalysis(payload.analysis || {});
  const mealType = normalizeMealType(payload.mealType);
  const date = sanitizeDate(payload.date) || todayDate();
  const thumbnail = sanitizeThumbnail(payload.thumbnail);
  const notes = typeof payload.notes === "string" ? payload.notes.slice(0, 500) : "";
  const source = typeof payload.source === "string" ? payload.source.slice(0, 40) : "unknown";

  const meal = {
    id: crypto.randomUUID(),
    userId: auth.user.id,
    date,
    mealType,
    createdAt: new Date().toISOString(),
    source,
    notes,
    thumbnail,
    dishName: analysis.dish_name,
    totalCalories: analysis.total_calories,
    calorieRange: analysis.calorie_range,
    macros: analysis.macros,
    analysis,
  };

  auth.db.meals.push(meal);
  await writeDb(auth.db);
  return sendJson(res, 201, { meal, summary: summarizeMealsForDate(auth.db, auth.user, date) });
}

async function handleDeleteMeal(req, res, mealId) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const existing = auth.db.meals.find((meal) => meal.id === mealId && meal.userId === auth.user.id);
  if (!existing) {
    return sendJson(res, 404, { error: "记录不存在。" });
  }

  auth.db.meals = auth.db.meals.filter((meal) => meal.id !== mealId);
  await writeDb(auth.db);
  return sendJson(res, 200, {
    ok: true,
    summary: summarizeMealsForDate(auth.db, auth.user, existing.date),
  });
}

async function analyzeFoodImage(imageDataUrl, notes) {
  if (AI_PROVIDER === "siliconflow") {
    return analyzeWithSiliconFlow(imageDataUrl, notes);
  }

  return analyzeWithOpenAI(imageDataUrl, notes);
}

async function analyzeWithOpenAI(imageDataUrl, notes) {
  const requestBody = {
    model: OPENAI_MODEL,
    max_output_tokens: 1400,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildNutritionPrompt(notes),
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "food_calorie_analysis",
        strict: true,
        schema: analysisSchema,
      },
    },
  };

  if (/^gpt-5/i.test(OPENAI_MODEL)) {
    requestBody.reasoning = { effort: OPENAI_REASONING_EFFORT };
    requestBody.text.verbosity = OPENAI_TEXT_VERBOSITY;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`OpenAI returned non-JSON response: ${responseText.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data?.error?.message || responseText.slice(0, 300);
    throw new Error(message);
  }

  const outputText = extractOutputText(data);
  if (!outputText) {
    throw new Error("OpenAI response did not include output text.");
  }

  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw new Error(`Could not parse structured output: ${error.message}`);
  }
}

async function analyzeWithSiliconFlow(imageDataUrl, notes) {
  const response = await fetch(`${SILICONFLOW_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SILICONFLOW_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${buildNutritionPrompt(notes)}

请严格只返回一个 JSON 对象，不要 Markdown，不要代码块。JSON 字段必须包含：
dish_name, total_calories, calorie_range.low, calorie_range.high, confidence,
portion_summary, macros.protein_g, macros.carbs_g, macros.fat_g, items,
assumptions, health_notes, not_food_warning。`,
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl,
                detail: "low",
              },
            },
          ],
        },
      ],
      max_tokens: 1400,
      temperature: 0.2,
    }),
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`SiliconFlow returned non-JSON response: ${responseText.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data?.error?.message || responseText.slice(0, 300);
    throw new Error(message);
  }

  const outputText = data?.choices?.[0]?.message?.content;
  if (typeof outputText !== "string" || !outputText.trim()) {
    throw new Error("SiliconFlow response did not include message content.");
  }

  return parseJsonObject(outputText);
}

function buildNutritionPrompt(notes) {
  const userNotes = notes.trim()
    ? `\n用户补充信息：${notes.trim()}`
    : "\n用户没有提供额外份量信息。";

  return `你是一名谨慎的营养估算助手。请分析图片中可见、可食用的食物，估算总热量、热量范围、宏量营养素和每个食物项的份量。${userNotes}

要求：
- 所有人类可读文本使用简体中文。
- 只估算画面中可见的食物和饮品，不要把餐具、包装或背景当成食物。
- 如果不是食物图片，把 total_calories、宏量营养素和每个食物项热量设为 0，并在 not_food_warning 写明原因。
- calorie_range 要反映照片估算的不确定性。
- confidence 使用 0 到 1 的数字，无法判断份量时要降低置信度。
- assumptions 写清楚估算所依赖的关键假设，例如烹调用油、酱汁、米饭份量。
- health_notes 只给简短、非医疗诊断的建议，强调结果是估算值。`;
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  const parts = [];
  for (const outputItem of data.output || []) {
    for (const contentItem of outputItem.content || []) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        parts.push(contentItem.text);
      }
    }
  }
  return parts.join("").trim();
}

function parseJsonObject(text) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("AI response was not a JSON object.");
    }
    return JSON.parse(match[0]);
  }
}

async function serveStatic(urlPath, req, res) {
  const safePath = decodeURIComponent(urlPath.split("?")[0]);
  const requestedPath = safePath === "/" ? "/index.html" : safePath;
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  const relativePath = path.relative(PUBLIC_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  const finalPath = existsSync(filePath) ? filePath : path.join(PUBLIC_DIR, "index.html");
  const ext = path.extname(finalPath).toLowerCase();
  const contentType = mimeTypes.get(ext) || "application/octet-stream";

  try {
    const body = req.method === "HEAD" ? "" : await readFile(finalPath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("图片太大，请压缩后再试。");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("请求体不是有效 JSON。"));
      }
    });

    req.on("error", reject);
  });
}

async function readJsonBodySafe(req, res) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
    sendJson(res, status, { error: error.message });
    return null;
  }
}

async function readDb() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    return { users: [], sessions: [], meals: [] };
  }

  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const db = JSON.parse(raw);
    return {
      users: Array.isArray(db.users) ? db.users : [],
      sessions: Array.isArray(db.sessions) ? db.sessions : [],
      meals: Array.isArray(db.meals) ? db.meals : [],
    };
  } catch {
    return { users: [], sessions: [], meals: [] };
  }
}

async function writeDb(db) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

async function requireAuth(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "请先登录。" });
    return null;
  }

  const db = await readDb();
  const session = db.sessions.find((item) => item.token === token);
  if (!session || isExpiredSession(session)) {
    db.sessions = db.sessions.filter((item) => item.token !== token);
    await writeDb(db);
    sendJson(res, 401, { error: "登录已过期，请重新登录。" });
    return null;
  }

  const user = db.users.find((item) => item.id === session.userId);
  if (!user) {
    sendJson(res, 401, { error: "账号不存在。" });
    return null;
  }

  return { db, user, session };
}

function createDemoAnalysis(notes) {
  return {
    dish_name: "演示：鸡蛋牛肉米饭餐盘",
    total_calories: 690,
    calorie_range: { low: 560, high: 840 },
    confidence: 0.42,
    portion_summary: notes
      ? `演示模式已收到备注：“${notes}”。配置 ${getProviderKeyName()} 后会按照片内容估算。`
      : `当前未配置 ${getProviderKeyName()}，以下结果是演示数据，不代表照片内容。`,
    macros: {
      protein_g: 38,
      carbs_g: 78,
      fat_g: 24,
    },
    items: [
      {
        name: "米饭",
        estimated_portion: "约 1 碗，180 克",
        calories: 235,
        protein_g: 4,
        carbs_g: 52,
        fat_g: 1,
        confidence: 0.45,
        notes: "主食份量对总热量影响较大。",
      },
      {
        name: "牛肉",
        estimated_portion: "约 100 克",
        calories: 220,
        protein_g: 26,
        carbs_g: 3,
        fat_g: 12,
        confidence: 0.42,
        notes: "油脂和酱汁会提高热量。",
      },
      {
        name: "煎蛋和蔬菜",
        estimated_portion: "鸡蛋 1 个，蔬菜少量",
        calories: 235,
        protein_g: 8,
        carbs_g: 23,
        fat_g: 11,
        confidence: 0.4,
        notes: "烹调用油按中等用量估算。",
      },
    ],
    assumptions: [
      "这是演示结果，用于检查页面流程。",
      `真实识别需要在启动服务前设置 ${getProviderKeyName()}。`,
      "热量估计会受份量、烹调用油和酱汁影响。",
    ],
    health_notes: [
      "照片识别热量只能作为饮食记录参考。",
      "需要精确控糖、控脂或医疗饮食时，应以称重和营养标签为准。",
    ],
    not_food_warning: "",
  };
}

function normalizeAnalysis(input) {
  const analysis = input && typeof input === "object" ? input : {};
  const calories = numberOrZero(analysis.total_calories);
  const low = numberOrZero(analysis.calorie_range?.low);
  const high = numberOrZero(analysis.calorie_range?.high);

  return {
    dish_name: stringOr(analysis.dish_name, "未命名餐食"),
    total_calories: calories,
    calorie_range: {
      low: low || Math.max(0, Math.round(calories * 0.8)),
      high: high || Math.round(calories * 1.25),
    },
    confidence: clamp(numberOrZero(analysis.confidence), 0, 1),
    portion_summary: stringOr(analysis.portion_summary, "模型未提供份量说明。"),
    macros: {
      protein_g: numberOrZero(analysis.macros?.protein_g),
      carbs_g: numberOrZero(analysis.macros?.carbs_g),
      fat_g: numberOrZero(analysis.macros?.fat_g),
    },
    items: Array.isArray(analysis.items)
      ? analysis.items.map((item) => ({
          name: stringOr(item.name, "食物项"),
          estimated_portion: stringOr(item.estimated_portion, "份量不明"),
          calories: numberOrZero(item.calories),
          protein_g: numberOrZero(item.protein_g),
          carbs_g: numberOrZero(item.carbs_g),
          fat_g: numberOrZero(item.fat_g),
          confidence: clamp(numberOrZero(item.confidence), 0, 1),
          notes: stringOr(item.notes, ""),
        }))
      : [],
    assumptions: stringArrayOr(analysis.assumptions),
    health_notes: stringArrayOr(analysis.health_notes),
    not_food_warning: stringOr(analysis.not_food_warning, ""),
  };
}

function summarizeMealsForDate(db, user, date) {
  const meals = db.meals.filter((meal) => meal.userId === user.id && meal.date === date);
  return summarizeMeals(meals, user.settings);
}

function summarizeMeals(meals, settings = {}) {
  const totalCalories = meals.reduce((sum, meal) => sum + numberOrZero(meal.totalCalories), 0);
  const macros = meals.reduce(
    (sum, meal) => ({
      protein_g: sum.protein_g + numberOrZero(meal.macros?.protein_g),
      carbs_g: sum.carbs_g + numberOrZero(meal.macros?.carbs_g),
      fat_g: sum.fat_g + numberOrZero(meal.macros?.fat_g),
    }),
    { protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const byMealType = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  for (const meal of meals) {
    byMealType[normalizeMealType(meal.mealType)] += numberOrZero(meal.totalCalories);
  }

  const targetCalories = numberOrZero(settings.targetCalories) || 1800;
  return {
    totalCalories: Math.round(totalCalories),
    targetCalories,
    remainingCalories: Math.round(targetCalories - totalCalories),
    progress: clamp(totalCalories / targetCalories, 0, 1.5),
    macros: {
      protein_g: roundNumber(macros.protein_g, 1),
      carbs_g: roundNumber(macros.carbs_g, 1),
      fat_g: roundNumber(macros.fat_g, 1),
    },
    byMealType,
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return provider === "siliconflow" ? "siliconflow" : "openai";
}

function normalizeMealType(value) {
  const mealType = String(value || "").trim().toLowerCase();
  return ["breakfast", "lunch", "dinner", "snack"].includes(mealType) ? mealType : "lunch";
}

function sanitizeDate(value) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function sanitizeThumbnail(value) {
  const thumbnail = typeof value === "string" ? value : "";
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(thumbnail) ? thumbnail.slice(0, 900000) : "";
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

function getProviderKeyName() {
  return AI_PROVIDER === "siliconflow" ? "SILICONFLOW_API_KEY" : "OPENAI_API_KEY";
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function createSession(userId) {
  const now = Date.now();
  return {
    token: crypto.randomBytes(TOKEN_BYTES).toString("base64url"),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
}

function isExpiredSession(session) {
  return Date.parse(session.expiresAt) < Date.now();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    settings: {
      weightKg: numberOrZero(user.settings?.weightKg) || 65,
      targetCalories: numberOrZero(user.settings?.targetCalories) || 1800,
    },
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ salt, hash: derivedKey.toString("hex") });
    });
  });
}

function verifyPassword(password, salt, expectedHash) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      const actual = Buffer.from(derivedKey.toString("hex"), "hex");
      const expected = Buffer.from(expectedHash, "hex");
      resolve(actual.length === expected.length && crypto.timingSafeEqual(actual, expected));
    });
  });
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function stringArrayOr(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function roundNumber(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}
