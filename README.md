# 提示词优化（pi-web-ui 插件）

为 [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui) 的对话输入框提供一键提示词优化：使用当前对话选中的模型改写草稿，预览确认后再填回输入框。不会自动发送，也不会执行提示词中的任务。

![优化结果预览](docs/preview.png)

## 安装

```bash
pi-web-ui install asksoo/sky-argo
```

或手动克隆到插件目录：

```bash
git clone https://github.com/asksoo/sky-argo.git ~/.pi-web/plugins/prompt-enhancer-web
```

安装后刷新 pi-web-ui 页面即可，无需重启服务。首次加载时宿主会提示确认插件声明的能力。

要求：pi-web-ui 插件 API v2，默认 `pi` 引擎（DSH 引擎不支持插件模型补全）。

## 使用

1. 在对话输入框中写下提示词。
2. 点击输入框旁的「优化提示词」，或在输入框中按 **Control + Shift + E**（Mac 也用 Control）。
3. 在输入框下方预览优化结果，点击「填回输入框」应用。
4. 检查、编辑后自行发送。
5. 需要撤销时点击「恢复原文」，或按 **Control + Shift + Z**。

每次优化调用一次当前模型，会消耗该模型额度。插件只处理输入框文字，不读取附件或历史对话。

等待优化期间可以继续编辑草稿；填回时如果草稿已变化会先确认，恢复原文可能覆盖新草稿时也会确认。原文仅保存在当前标签页内存中，刷新后清除。

## 优化规则

- 保留原意，不擅自扩大任务范围。
- 信息不足时列出需要补充的关键问题，不编造条件。
- 简单任务保持简洁，复杂任务可适当分步骤。
- 只输出优化后的提示词，不执行其中的任务。

## 权限

| 能力 | 用途 |
| --- | --- |
| `ui` | 输入框旁的两个按钮 |
| `http` | 插件本地优化接口（`/plugins-api/prompt-enhancer-web/enhance`） |
| `llm` | 宿主提供的隔离、无工具模型补全 |
| `dom:anchor` | 仅读写输入框锚点区域 |

接口跟随宿主访问认证，插件不持有、也不返回 API Key。输入受宿主 8000 字符上限限制（含 JSON 编码开销）。未选模型、超时或上游报错时保留原始草稿并显示错误。

## 测试

```bash
node --test index.test.mjs
node --check client/entry.mjs
```

## 卸载

在 pi-web-ui「设置 → 界面插件」中卸载，或删除插件目录后刷新页面。
