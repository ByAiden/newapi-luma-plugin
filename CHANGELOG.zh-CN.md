---
changelogVersion: 1
plugin: "changeyu0229_luma"
version: "1.0.0"
locale: "zh-CN"
---
# Changelog

## [1.0.0]

### Added

- 使用 Luma `ray-3.2` 模型生成视频：文生视频、首尾帧、最多 64 个关键帧，输出 360p 到 1080p，时长 5 或 10 秒，支持循环和 HDR。
- 以网关任务 ID 作为 `generation_id`，延长、编辑或重构之前生成的视频。
- 支持 Luma 原生接口 `POST /v1/generations` 和 `GET /v1/generations/{id}`，以及 OpenAI 视频接口 `POST /v1/videos`。
- 每个任务按 Luma 积分计费：按 Luma 公布的积分表预扣，按 Luma 返回的实际积分结算。
- 通过网关下载完成的视频；网关会向 Luma 换取新链接，Luma 链接一小时过期后仍可下载。
