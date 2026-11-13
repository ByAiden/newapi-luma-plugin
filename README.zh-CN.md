---
locale: zh-CN
---
# Luma

[English](README.md) | **简体中文**

通过 [Luma Agents API](https://docs.agents.lumalabs.ai/) 调用 Luma 的 Ray 3.2 模型生成、延长、编辑视频和重构画幅，并用 uni-1、uni-1-max 生成和编辑图片。

## 渠道设置

- 安装插件后，新建“任务插件”类型的渠道，并绑定 `luma`。
- 密钥填 [Luma API Platform](https://platform.lumalabs.ai/) 里创建的 Luma Agents API Key，以 `luma-api-` 开头。同一个 Key 可同时调用视频和图片模型。
- API 地址留空即使用 `https://agents.lumalabs.ai`。只有通过代理访问 Luma 时才需要填写，末尾不要带 `/v1`。
- 渠道模型里加入要提供的模型：`ray-3.2`、`uni-1`、`uni-1-max`。也可以通过模型映射用其他名字对外提供。

插件只支持当前的 Luma Agents API。已退役的 Dream Machine API（`ray-2`、`ray-flash-2`、`api.lumalabs.ai/dream-machine`）的密钥和模型名无法使用。

## 模型与接口

| 接口 | 用途 | 模型 |
| --- | --- | --- |
| `POST /v1/generations` | Luma 原生请求体。视频：文生视频、图生视频、关键帧、视频延长（`type: "video"`）、视频编辑（`video_edit`）、画幅重构（`video_reframe`）。图片：文生图和参考图（`image`）、改图（`image_edit`） | `ray-3.2`、`uni-1`、`uni-1-max` |
| `POST /v1/videos` | OpenAI 视频接口：`prompt`、`seconds`、`size`、`input_reference`，另支持 Luma 的 `aspect_ratio`、`resolution`、`loop`、`hdr` | `ray-3.2` |
| `POST /v1/images/generations` | OpenAI 图片接口：`prompt`、`size`、`output_format`，另支持 Luma 的 `aspect_ratio`、`style`、`web_search`、`image_ref` | `uni-1`、`uni-1-max` |
| `POST /v1/images/edits` | OpenAI 改图接口：第一张 `image` 是要修改的图，其余作为参考图 | `uni-1`、`uni-1-max` |

Luma 路径也可以加插件前缀访问，即 `/luma/v1/generations`。不写 `type` 时，`ray-3.2` 默认生成视频，`uni-1`、`uni-1-max` 默认生成图片；使用映射后的模型名时必须写明 `type`。

通过 Luma 路径提交的任务，客户端轮询 `GET /v1/generations/{id}`。返回 Luma 的 generation 对象；完成后每个 `output[].url` 都是网关的下载地址，Luma 自己的链接一小时后过期，网关地址仍然可用。返回内容不包含 Luma 的团队和用量信息。
通过 `POST /v1/videos` 提交的任务，客户端轮询 `GET /v1/videos/{task_id}`，从 `GET /v1/videos/{task_id}/content` 下载视频。OpenAI 图片接口会等图片生成完再返回图片地址；请求里设置 `response_format: "b64_json"` 时返回 base64 数据。

要延长、编辑或重构之前的视频，或修改之前生成的图片，把那个结果的网关任务 ID 作为 `generation_id` 传入，例如 `"video": {"start_frame": {"generation_id": "task_..."}}` 或 `"source": {"generation_id": "task_..."}`。网关会校验任务属于调用者，再把 Luma 自己的 ID 发给上游。

## 计费

价格表只有一个字段“Luma 积分单价”。每个任务按消耗的 Luma 积分计费，只需设置每个积分的价格，例如 `tier("base", u("credits") * P)`，其中 `P` 是每积分的美元单价。所有模型共用这个字段；如果图片和视频想按不同单价收费，给每个模型分别保存表达式即可。

- 提交任务时，网关按 Luma 公布的按量付费积分表预扣积分。视频按操作类型、分辨率、时长和动态范围计算；没写分辨率或时长时按 `720p`、`5s` 计费，插件也会把这两个值明确发给 Luma。
- 视频延长按一个 5 秒档计费；画幅重构按输出秒数计费；视频编辑没写 `duration` 时预扣 10 秒的价格。
- 图片按模型收基础价：`uni-1` 14 积分，`uni-1-max` 34 积分；每张输入图（被修改的图和每张参考图）再加 1 积分。
- 任务完成时如果 Luma 已返回 `usage.credits_charged`，按这个数结算；否则保持预扣数。返回 0 的情况（例如 Provisioned Throughput 套餐）会被忽略。
- 失败的生成全额退款，包括 Luma 可能部分扣费的 `budget_exhausted` 失败。

Luma 正式发布前可能调整积分表，定价时请对照 [Luma 价格页](https://docs.agents.lumalabs.ai/guides/pricing/)。

## 示例

```bash
curl https://your-gateway.example.com/v1/generations \
  -H "Authorization: Bearer $NEWAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "ray-3.2", "type": "video", "prompt": "A slow dolly shot through a misty greenhouse at sunrise", "aspect_ratio": "16:9", "video": {"resolution": "720p", "duration": "5s"}}'
```

用返回的 `id` 轮询任务：

```bash
curl https://your-gateway.example.com/v1/generations/{id} \
  -H "Authorization: Bearer $NEWAPI_TOKEN"
```

通过 OpenAI 图片接口生成图片：

```bash
curl https://your-gateway.example.com/v1/images/generations \
  -H "Authorization: Bearer $NEWAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "uni-1", "prompt": "A paper boat on a calm pond, watercolor", "size": "1024x1024"}'
```

## 限制

- 视频分辨率：`360p`、`540p`、`720p`、`1080p`；时长：`5s`、`10s`；画幅：`9:16`、`3:4`、`1:1`、`4:3`、`16:9`、`21:9`。
- HDR 需要 `720p` 或 `1080p`，且只能 5 秒。视频延长和画幅重构只支持标准动态范围。
- `start_frame` 和 `end_frame` 不支持 `10s`；10 秒的图片引导视频请用 `keyframes` 加 `keyframe_indexes`。
- 图片画幅：`3:1`、`2:1`、`16:9`、`3:2`、`1:1`、`2:3`、`9:16`、`1:2`、`1:3`；`style: "manga"` 只能用竖版画幅。OpenAI 图片接口里的 `size` 会换算成最接近的画幅。每次只返回一张图，所以 `n` 必须为 1，也不支持 `mask`。
- 生成图片最多带 9 张参考图，改图最多 8 张。
- 图片和视频以 URL 或带 `media_type` 的 base64 数据传入。带 `file_id` 或 `callback_url` 的请求会被拒绝，Luma 未写明的字段会被丢弃。
- 图片拆图层（`type: "layering"`）Luma 未公布价格，暂不支持。Luma 的 GLM 对话模型是另一个产品、需要单独的 Key，请直接按普通 OpenAI 渠道添加。
