# 组件来源与许可

通用界面组件来自 **shadcn/ui 官方 Radix registry**，2026-09-07 使用锁定的 `shadcn@4.21.0` 引入。配置为 `new-york`、`rsc: false`、`tsx: false`、Tailwind CSS 4 与 CSS 主题变量。

- 官方源码仓库：https://github.com/shadcn-ui/ui
- 本次 registry：https://ui.shadcn.com/r/styles/new-york-v4/button.json （其他组件使用相同目录和组件名）
- 配置文档：https://ui.shadcn.com/docs/components-json
- 源码位置：`src/components/ui/`，Sidebar 的配套 hook 在 `src/hooks/use-mobile.js`。
- shadcn/ui 采用 MIT 许可，全文保留在 `licenses/shadcn-ui-MIT.md`。

已引入并用于业务界面的组件：Button、Tooltip、Badge、Input、Label、Textarea、Select、Checkbox、Sidebar、Sheet、Dropdown Menu、Avatar、Alert Dialog、Dialog、Table、Card、Pagination、Toggle Group、Tabs、Switch、Skeleton、Progress、Alert、Sonner。Separator 和 Toggle 是配套组件。

本地适配包括：JSX 输出、工具函数导向 `@/lib/utils`、按钮的胶囊形状和 44px 点击区域、中文弹层名称、固定深色通知主题、移除客户端项目不需要的 RSC 指令。组件行为由 Radix 提供，业务组件继续通过原有 API 读写资料。

| 依赖 | 来源与许可 |
| --- | --- |
| Radix UI | https://github.com/radix-ui/primitives · MIT |
| Sonner | https://github.com/emilkowalski/sonner · MIT |
| Tailwind CSS | https://github.com/tailwindlabs/tailwindcss · MIT |
| class-variance-authority | https://github.com/joe-bell/cva · Apache-2.0 |
| clsx / tailwind-merge | 各 npm 包随附 MIT 许可 |
| Lucide | https://github.com/lucide-icons/lucide · ISC |
| JetBrains Mono | https://github.com/JetBrains/JetBrainsMono · SIL OFL 1.1，全文见 `licenses/JetBrains-Mono-OFL.txt` |

依赖版本在 `package.json` 中固定，传递依赖由 `package-lock.json` 锁定。未引入付费模板或另一套通用 UI 组件库。现有 GSAP 动效依赖继续按其自带许可使用。

## 学习路线组件

- `@xyflow/react@12.11.6`：React Flow 核心画布，MIT。来源：[xyflow](https://github.com/xyflow/xyflow)，许可保存在 `licenses/react-flow-MIT.txt`。保留画布上的 React Flow 署名。
- React Flow UI **Base Node**：2026-09-07 从[官方 registry](https://ui.reactflow.dev/base-node)取得原始组件，来源快照为 `artifacts/react-flow-base-node.json`，JSX 适配在 `src/components/ui/base-node.jsx`，实际用于学习节点。删除 TypeScript 类型，通过业务样式调整色彩、尺寸和焦点；[官方组件与 MIT 许可入口](https://reactflow.dev/ui/components/base-node)。
- `@dagrejs/dagre@3.1.1`：自动布局，MIT。来源：[Dagre](https://github.com/dagrejs/dagre)，许可保存在 `licenses/dagre-MIT.txt`。只在点击“一键整理”时动态加载。
- 未使用 React Flow Pro 付费模板，也未移植 SkillTreeOSS、Learningmap 或 roadmap.sh 的代码或内容。

## 分类与标签组件

`src/taxonomy/` 为本项目的业务组合，复用已有 shadcn/ui 的 Button、Input、Label、Badge、Select、Tabs、Dialog 和 Alert，以及 Lucide 图标。标签选择器使用可搜索多选交互并处理创建、去重及失败重试；没有引入第三方标签库、付费组件或新的依赖。既有组件许可继续适用。
# Sites 云端适配依赖

`@openai/sites-vite-plugin`、Vite、Drizzle ORM / Kit、Wrangler、Busboy 及 StreamSearch 使用各自随包提供的 MIT 许可；源码来自官方 npm 发布包，版本固定在 package-lock.json。Cloudflare Workers 本地验证由 Wrangler 依赖的 Miniflare / workerd 提供。
