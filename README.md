# CalorieLens

本地网页应用：拍照或上传食物照片，估算总热量、份量、宏量营养素和不确定范围。

## 运行

```powershell
npm start
```

打开 `http://localhost:5173`。

未配置 API key 时，页面会进入演示模式，方便先检查拍照和界面流程。

## 使用硅基流动 API

在 PowerShell 里进入项目目录后运行：

```powershell
$env:AI_PROVIDER="siliconflow"
$env:SILICONFLOW_API_KEY="你的硅基流动 API Key"
$env:SILICONFLOW_MODEL="Qwen/Qwen2.5-VL-32B-Instruct"
npm start
```

`SILICONFLOW_MODEL` 必须是支持图片输入的视觉模型。默认值是 `Qwen/Qwen2.5-VL-32B-Instruct`，如果控制台提示模型不存在或无权限，就在硅基流动控制台里换成你账号可用的视觉模型。

环境变量只对当前 PowerShell 窗口生效。关闭窗口后，下次运行需要重新设置。

## 使用 OpenAI API

```powershell
$env:AI_PROVIDER="openai"
$env:OPENAI_API_KEY="你的 OpenAI API Key"
$env:OPENAI_MODEL="gpt-5.5"
npm start
```

`OPENAI_MODEL` 可以不设，默认使用 `gpt-5.5`。GPT-5 系列默认使用低推理强度和低输出 verbosity，以减少等待时间；可通过 `OPENAI_REASONING_EFFORT` 和 `OPENAI_TEXT_VERBOSITY` 调整。

## 部署到 Render 免费 Web Service

本项目已经包含 `render.yaml`。部署时不要把 API key 写进代码或提交到 GitHub，Render 会在后台要求你填写 `SILICONFLOW_API_KEY`。

1. 在 GitHub 新建一个空仓库，例如 `calorielens`。
2. 在本地项目目录提交并推送代码：

```powershell
cd C:\Users\R9000P\Documents\Codex\2026-04-25\app
git init C:\Users\R9000P\Documents\Codex\2026-04-25\app
git add .gitignore package.json README.md render.yaml server.mjs public
git commit -m "Initial CalorieLens app"
git branch -M main
git remote add origin https://github.com/你的GitHub用户名/calorielens.git
git push -u origin main
```

3. 打开 Render Dashboard，选择 New > Blueprint。
4. 连接 GitHub，并选择刚才的 `calorielens` 仓库。
5. Render 读取 `render.yaml` 后，填写密钥 `SILICONFLOW_API_KEY`。
6. 点击 Apply，等待部署完成。
7. 部署完成后打开 Render 给你的 `https://...onrender.com` 网址。

## 功能

- 调用摄像头拍照，或上传 PNG/JPG/WebP。
- 将图片在浏览器端压缩后发送到后端。
- 后端支持 OpenAI Responses API 和硅基流动 Chat Completions API。硅基流动视觉模型不强制使用 JSON mode，避免部分模型报 `Json mode is not supported for this model`。
- 显示总热量、估算范围、宏量营养素、食物拆分和估算依据。
- 可用份量滑杆手动修正总热量。
- 最近 5 次分析保存在浏览器本机。

## 注意

照片估算无法替代称重、营养标签或医疗饮食建议。烹调用油、酱汁和被遮挡食材会显著影响结果。
