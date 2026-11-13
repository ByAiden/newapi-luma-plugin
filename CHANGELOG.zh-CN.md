---
changelogVersion: 1
plugin: luma
version: 1.1.0
locale: "zh-CN"
---

# Changelog

## [1.1.0]

### Added

- 使用 Luma `ray-3.2` 模型生成视频：文生视频、首尾帧、最多 64 个关键帧，输出 360p 到 1080p，时长 5 或 10 秒，支持循环和 HDR。
- 以网关任务 ID 作为 `generation_id`，延长、编辑或重构之前生成的视频。
- 使用 `uni-1` 和 `uni-1-max` 生成图片（文字加最多 9 张参考图）和修改图片，可以用网关任务 ID 引用之前的生成结果。
- 支持 Luma 原生接口 `POST /v1/generations` 和 `GET /v1/generations/{id}`、OpenAI 视频接口 `POST /v1/videos`，以及 OpenAI 图片接口 `POST /v1/images/generations` 和 `POST /v1/images/edits`。
- 每个任务按 Luma 积分计费：按 Luma 公布的积分表预扣，按 Luma 返回的实际积分结算。
- 通过网关下载生成结果；网关会向 Luma 换取新链接，Luma 链接一小时过期后仍可下载。
