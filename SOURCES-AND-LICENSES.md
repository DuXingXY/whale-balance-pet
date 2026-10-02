# 本次交付的来源与许可

本工具是独立 Windows 多站点余额桌宠，名称“鲸鱼余额”。没有修改或安装原仓库插件，也不注入 Codex。

参考仓库：https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget

主要参考：For-Codex 分支提交 `5a36d6442d272cd7fea255206f2abcd697a87563` 的 `runtime/providers.mjs`、Electron 桌面方案及角色交互。金额解析、受限 JSON 响应读取和 billing / Key 额度适配在 `core/providers.cjs` 中保留了来源注释；多站状态管理、加密存储、GUI 和此应用入口为此次新增。

素材原样复制自该提交：

- `assets/whale.png` 来自 `assets/DSniang1.png`（只更名，未修改图片）。
- `assets/rua.gif` 为原摸摸动画（未修改）。

1.2.0 另原样复制用户提供的 `dsh-whale-widget-0.3.17-package/assets/DSniang02.png` 和 `Ya1.mp3`。气泡在界面中通过 SVG 轮廓裁切显示，原 PNG 文件没有改动；点击音效直接播放原 MP3。旧 `rua.gif` 仍保留在包内，本版本点击反馈改用角色的轻微压扁回弹。上述素材不声明为此次原创，素材权利不因本工具代码的 MIT 许可而扩大。

上游 MIT 代码许可原文保存在 `LICENSE-UPSTREAM`。原分支的 `UPSTREAM-PROVENANCE.md` 原文保留，仅代表上游项目的来源说明，不表示此工具包含其全部功能。角色、动画素材按上游 as-is 随挂件分发，不授予额外再许可，不声明为此次原创。本仓库为独立 Windows 改编版，按用户授权公开发布。公开发布不改变素材的权利归属或上游许可边界。

余额协议参考：

- BB API：https://www.bb-api.com/，用户带 Key 测试截图确认 `/v1/usage` 钱包响应。
- Sub2API 网关实现：https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/handler/gateway_handler.go
- OpenRouter 官方：https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits （需管理 Key）
- Kimi / Moonshot 官方：https://platform.kimi.com/docs/api/balance
- DeepSeek 官方：https://api-docs.deepseek.com/api/get-user-balance

运行时 Electron 44.5.1 / Chromium 的许可及第三方声明保存在程序目录根部。Electron safeStorage 文档：https://www.electronjs.org/docs/latest/api/safe-storage

本次新增代码和文档按 MIT 提供；角色素材许可边界独立于代码。

## 1.3.0 用户提供的皮肤

- `assets/skin-orange.png`：用户附件 `a1468e515fd78c46844efd1373b0e086.png`，原样复制。
- `assets/skin-purple.png`：用户附件 `9c3c999631f2af35c70738454ed436f9.png`，原样复制。只在界面显示时收起透明留白，PNG 文件未修改。
- `assets/skin-white.png`：用户附件 `2586d7345ec01d8c92ceb3d2fc226a0b.png`，保留的原图。
- `assets/skin-white-cutout.png`：白发皮肤透明底版本，使用内置 `image_gen` 工具进行背景提取，未使用 CLI/API Key。尽量保留原角色的面部、衣服、装饰与姿态；不声明角色设计为原创。

白发透明底最终交付位置：本程序目录下 `resources/app/assets/skin-white-cutout.png`。其他皮肤位于相同 assets 目录。皮肤来源和权利独立于本工具的代码许可。

内置工具实际提示词（`transparent_background: true`）：

```text
Use case: background-extraction. Edit target: the attached white/lavender-haired chibi illustration. Intended asset: a Windows desktop pet transparent PNG cutout. Remove only the opaque black background, including the background gaps inside the loop of hair above her head and gaps between strands at the silhouette. Preserve the existing character as faithfully as possible: exact face, sleepy purple eyes, long pale hair, swept forelock, pointed ears, navy outlines, knot-shaped accessories and dangling beads, pale lace clothing, bust pose and bottom crop. Keep the subject's dark outlines and decorations opaque; no black rectangular background, no new backdrop, no shadow outside the illustration, no text, no watermark. Do not redesign, recolor, change expression, add accessories, or invent body parts. Real transparent alpha channel, clean antialiased cutout.
```
