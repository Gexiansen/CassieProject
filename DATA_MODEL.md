# CassieProject schema v4 数据模型

## 目标

schema v4 是一次断代重构。正式应用只读写 v4，不再解析旧数组、schema v2／v3、完整备份 v1／v2／v3、旧偏好或历史收入。旧数据通过仓库外的一次性转换工具生成 v4 完整备份。

以下能力继续保留：整数分金额、UUID、版本校验、存储失败反馈、导入预览、导入前保护、异常数据锁定、删除撤销和离线使用。

## 本地存储

为避免手机端每次操作都重写全部数据，本地状态按职责分开保存：

- `cassie_records_v4`：支出记录。
- `cassie_settings_v4`：家庭成员、默认成员和分类。
- `cassie_plans_v4`：预算、专项、目标、月结和无支出日期。
- `cassie_backup_meta_v4`：最近一次完整备份时间和摘要。

每个主存储对象都必须包含 `schemaVersion: 4` 和 `updatedAt`。内存中可以组合为 `appState`，但保存时只写发生变化的部分。

旧键只用于检测是否需要显示升级引导，不解析、不覆盖、不自动删除。

## 通用约束

- 所有业务 ID 都是 1～80 位的字母、数字、下划线或连字符。
- 新建业务对象使用 `crypto.randomUUID()`。
- 金额使用大于 0 的安全整数分；选填预算可为 `null`。
- 日期使用有效的 `YYYY-MM-DD`，月份使用有效的 `YYYY-MM`。
- 时间使用 ISO 8601 字符串。
- 用户文本在保存前去除首尾空白并按字段长度截断。
- 导入数据必须整体校验；发现无效引用时拒绝恢复，不静默丢弃记录。

## 支出记录

```json
{
  "id": "UUID",
  "date": "2026-07-19",
  "amountCents": 1234,
  "categoryId": "food-vegetable",
  "beneficiaryId": "family",
  "projectId": "",
  "note": "晚餐食材",
  "createdAt": "2026-07-19T10:00:00.000Z",
  "updatedAt": "2026-07-19T10:00:00.000Z"
}
```

约束：

- v4 只有支出记录，不再保存 `type`。
- `categoryId` 必须引用设置中存在的细分类；停用分类仍可被历史记录引用。
- `beneficiaryId` 必须引用设置中存在的获益方；停用成员仍可被历史记录引用。
- `projectId` 为空或引用规划中存在的正式专项。
- `note` 最多 20 个字符。
- 新记录不能使用已停用的分类或成员。
- 转换工具遇到无法映射的分类或成员时必须报告并停止，不得猜测。

## 家庭获益方

```json
{
  "id": "family",
  "name": "共同",
  "kind": "shared",
  "active": true
}
```

```json
{
  "id": "UUID",
  "name": "丈夫",
  "kind": "member",
  "active": true
}
```

约束：

- 数组顺序就是快速记账页的显示顺序。
- `family` 是保留 ID，`kind` 固定为 `shared`，不能停用或删除。
- 其他成员使用 `kind: "member"`，支持新增、改名、排序、停用和恢复。
- 名称为 1～6 个字符，同一设置中不能重名。
- 最多同时启用 8 个获益方，包括“共同”。
- `defaultBeneficiaryId` 必须引用启用的获益方；无效时回退 `family`。
- 历史记录引用的停用成员继续保留在设置中，不做硬删除。

默认设置预置“共同、妻子、丈夫、儿子”，沿用稳定 ID `family`、`wife`、`husband`、`son`，用户可以调整名称、顺序和启用状态。

## 分类

```json
{
  "id": "food",
  "name": "食品生鲜",
  "color": "#22c55e",
  "active": true,
  "items": [
    {
      "id": "food-vegetable",
      "name": "买菜",
      "active": true,
      "beneficiaryIds": ["family", "wife", "husband", "son"]
    }
  ]
}
```

约束：

- 大类 ID 和细分类 ID 均稳定；所有细分类 ID 在全局唯一。
- 记录只保存细分类 `categoryId`，不再保存大类与细分类双字段。
- 大类名称和细分类名称最多 12 个字符。
- 颜色必须是六位十六进制颜色。
- `beneficiaryIds` 至少包含一个存在的获益方 ID，可以引用停用成员。
- 改名和排序不改变历史记录。
- 停用分类只阻止新增记录，历史记录和统计继续使用。
- 最近一笔和高频分类从当前账目实时计算，不持久化收藏、模板或最近分类。

## 规划数据

`cassie_plans_v4` 包含：

```json
{
  "schemaVersion": 4,
  "updatedAt": "",
  "budgets": {},
  "projects": [],
  "currentProjectId": "",
  "goals": [],
  "reviews": {},
  "noSpendDates": []
}
```

### 月度预算

以 `YYYY-MM` 为键，每月只保存：

- `availableCents`：本月可支配金额，选填。
- `totalCents`：本月日常预算，选填。
- `updatedAt`。

不再保存分类预算，也不再用历史收入推导可支配金额。

### 正式专项

保留 `id`、`name`、`type`、`budgetCents`、`startDate`、`endDate`、`people`、`status`、`createdAt` 和 `updatedAt`。

- 类型限定为旅行、装修、节日、医疗、教育、搬家和其他。
- 状态限定为进行中或已完成。
- 只有旅行专项保存 1～20 的参与人数。
- `currentProjectId` 只能引用进行中的专项。
- 旧 `tag` 不进入 v4。

### 财务目标

保留目标 ID、名称、类型、目标金额、目标日期、状态、投入记录及时间字段。投入记录包含 ID、日期、整数分金额、20 字备注和创建时间。

### 月结

每月只保存：

- `highlight`：最多 120 字的一个结论。
- `action`：一个行动，包含 ID、最多 40 字文本、完成状态和时间字段。
- `updatedAt`。

不再保存旧 `adjustment` 或额外行动。

### 无支出日期

保存去重、升序排列的有效日期。某日新增支出后自动移除该日期。

## 完整备份 v4

```json
{
  "appName": "CassieProject",
  "backupVersion": 4,
  "schemaVersion": 4,
  "exportedAt": "2026-07-19T10:00:00.000Z",
  "summary": {
    "recordCount": 0,
    "expenseCents": 0
  },
  "records": {},
  "settings": {},
  "plans": {}
}
```

正式应用只接受 `backupVersion: 4` 和 `schemaVersion: 4`。导入流程为：选择文件、整体校验、展示摘要、明确确认、保护当前数据、写入三个主存储、失败时回滚、重新读取并核对摘要。

不再提供旧版合并账目或只覆盖账目。未知版本提示需要先转换。

## v3 到 v4 一次性转换

转换工具不被正式页面加载，真实备份不进入 Git。转换规则：

- 只转换 `type: "expense"`，历史收入计数并排除。
- `cat/sub` 映射为全局唯一 `categoryId`。
- `beneficiaryId` 必须映射到 v4 获益方；`unassigned` 必须由用户明确指定目标成员。
- `projectId` 保留，旧 `tag` 只进入转换报告。
- 预算只保留 `availableCents` 和 `totalCents`。
- 月结只保留 `highlight` 和第一条行动。
- 收藏、模板、分类预算、旧复盘字段和旧专项标签不进入 v4。

转换报告必须给出原始记录数、支出数、排除收入数、总支出、日期范围、未映射分类、未映射成员和无效专项。只有未映射项为 0 且转换前后支出总额一致时才生成可导入文件。

## 手机体验约束

- 快速记账保持“打开—输入金额—点击分类—完成”，默认成员或当前专项不增加必选步骤。
- 1～4 个获益方显示一行，5～8 个显示两行，不使用横向滑动。
- 高频触控目标至少 44px，表单控件字号不低于 16px。
- 分类使用纯文字，大类只作标题，细分类可直接保存。
- 记账弹窗初始焦点不进入金额输入框，避免手机浏览器自动放大。
- 390×844 视口不得产生横向溢出。
- Service Worker 更新不得在用户记账过程中强制刷新，也不得混用新旧资源。
