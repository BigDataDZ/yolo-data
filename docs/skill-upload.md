# 公共 Skill 上传与验收

在「智能体 → 公共 Skills」中，管理员可以上传 Markdown、启用/停用公共 Skill，以及删除外部目录或手动上传的条目。内置 Skill 可停用，不能删除。会话认证模式下，管理 API 仅允许管理员调用；匿名用户返回 401，普通用户返回 403。

## 上传规则

- 支持 `.md`、`.markdown`，内容必须是非空文本，UTF-8 字节大小不超过 200KiB。页面在读取文件前检查扩展名与大小；API 独立执行校验。
- 支持 UTF-8 BOM 与 CRLF。带 frontmatter 时必须有结束的 `---`，且正文不能为空。
- `name`、`description`、`code` 使用文本标量。`phases` 支持 `PRE_PLAN`、`PLAN`、`POST_EXECUTE`，上传时归一为大写。
- 普通 Markdown 没有 frontmatter 时，文件名（去掉扩展名）作为身份，不再把不同文件都归到 `unnamed-skill`。
- 相同归一化 code 的上传更新原条目，保留其启停状态和智能体引用。上传不会自动挂载到智能体，也不会自动启用原本已停用的条目。
- JSON 对象之外的请求、非字符串内容、二进制控制字符和非法状态值会被拒绝，目录不产生部分写入。

示例：

```markdown
---
name: sales-analysis-method
description: 销售分析的步骤与验证方法
phases: [PRE_PLAN, PLAN, POST_EXECUTE]
---

## Workflow
按已经冻结的查询契约分析结果。

## Validate
核验合计、日期范围与结论使用的数据。
```

## 引用与显示

上传来源 `UPLOAD` 与目录来源 `SKILL_MD` 都参与阶段指导。停用后，已有绑定保留，但有效 Skill 列表不包含它；重新启用后恢复。删除会清理绑定引用。

名称、说明、文件名和引用提示在页面中转义显示，HTML 片段作为文本。删除已被引用的 Skill 时，页面提示受影响的智能体，并允许取消。

## 验证

`npm test` 包含真实 HTTP/SQLite 的权限、非法输入、重复上传、阶段指导与引用生命周期测试，以及编码/字节边界测试。

浏览器测试用独立临时平台库和真实登录会话，覆盖选择与拖拽文件、上传/更新、启停、取消/确认删除、HTML 文本显示和普通用户访问。测试不连接业务数据库、不调用外部模型。

```powershell
npm install --no-save --package-lock=false @playwright/test
npx playwright install chromium
$env:YOLO_SKILL_BROWSER_TEST = '1'
node --test tests/skillCatalog.browser.test.js
```

本机已有 Edge 时，可设置 `$env:YOLO_BROWSER_CHANNEL = 'msedge'`。CI 复用已安装的 Chromium，截图保存为 `skill-browser` artifact。
