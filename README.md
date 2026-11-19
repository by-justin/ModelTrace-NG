# ModelTrace

ModelTrace 是一个模型归因工具：让待测模型给出三组 1–355 的“随机”整数，根据每个模型挑数字的习惯，在指纹库中判断最可能的模型和厂商。

ModelTrace identifies which language model is answering from three lists of "random" integers.
The site is static and scores replies in the browser; an optional Go API offers the same scoring to
agents and collects stamped crowd samples.

## 组成

```text
web/        静态网站（React + Vite），只需粘贴回复；用 TinyGo WebAssembly 在浏览器本地评分
core/       评分核心：一个纯 Go 函数 trace.Categorize，原生用于 API，TinyGo 编译给浏览器
backend/    极简无状态 REST API（Go + gin）：/v1/categorize、/v1/stamp、/v1/submissions
pipeline/   离线 Python：采集参考回答、构建指纹库、导出二进制指纹库与对照测试
schema/     二进制指纹库格式（FlatBuffers）
data/       参考回答（references/ 与两份早期数据）和构建好的指纹库（bank/）
```

设计意图与各项决策的理由见 [docs/design.md](docs/design.md)（英文）。

数据流：`pipeline.collect` 采集 → `data/references/*.jsonl` → `pipeline.build` → `data/bank/bank.fb` → `core`（浏览器与 API 共用）。

## 本地运行

```bash
python -m pip install -r pipeline/requirements.txt   # 另需 go、tinygo（含 binaryen 的 wasm-opt）、node
make references bank   # 把 staging/ 中采集到的回答导入 data/references，重建指纹库与对照测试
make test              # Go 核心与 API、WebAssembly 对照、网站测试
make dev               # 本地运行静态网站；make site 生成 web/dist
make api               # 可选：本地运行 API（:8080）
```

`make help` 列出全部目标；工具路径可用 `PYTHON=`、`TINYGO=`、`NPM=` 覆盖。

网站默认不连接任何服务器（`web/public/config.json` 中 `apiBase` 为 `null`）。填入 API 地址后，每次分析会在后台附带 ALTCHA 工作量证明匿名分享，用户可在结果页关闭；失败时静默忽略。

## 判定方法

- **模型概率**：数值分布（355 维）与按位置分块的序列特征，去除提示词设置带来的主要偏移方向后，与每个模型的平均指纹比较，再用校准温度做 softmax。
- **厂商概率**：独立的厂商分类器（逻辑回归）与按厂商汇总的模型概率各占一半，能把指纹库之外的新版本归到正确的厂商。
- **是否为已知模型**：与最接近模型的未缩放相似度低于阈值（5% 的真实样本低于该值）时判为未知模型。
- **判定等级**：`match`（明确匹配）/ `family`（仅确定厂商）/ `uncertain` / `unknown`。非 `match` 时网页会请用户说明模型。

当前指纹库：54 个模型、12 个厂商。按“留出一整组提示词设置”测试，三条回复正确率 97.2%，单条 87.3%；厂商三条回复正确率 99.4%，对完全未见过的模型为 76%（见 `data/bank/report.json`）。指纹无法区分的版本合并显示（如 GPT-6 Astra / GPT-6.1 Sol）。

### 来源

每个模型注明回答来源：官方 API 或订阅、厂商授权的云平台、运行全精度权重的第三方托管，或转售渠道。早期的 Claude 数据经由转售商采集，在与官方来源核对前标为“转售 · 未验证”。

## 声明

测试结果仅供参考，并非判断模型的决定性证据。

本项目只能识别指纹库中的模型；待测模型不在指纹库中时，应显示为未知模型或仅确定厂商。

系统提示词会明显改变模型的偏好，在 Claude Code 等带长系统提示词的环境中测试，结果偏差较大。

## 致谢

感谢 [hanlinwenyuan/hlwy-ai-checker](https://github.com/hanlinwenyuan/hlwy-ai-checker)。该项目较早将语言模型的随机数字生成偏差用于第三方 API 渠道一致性检查，为 ModelTrace 提供了重要参考。

[LINUX DO](https://linux.do/)
