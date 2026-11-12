---
changelogVersion: 1
plugin: "changeyu0229_luma"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.0]

### Added

- Generate videos with Luma's `ray-3.2` model from text, from a start and end frame, or from up to 64 keyframes, with 360p to 1080p output, 5 or 10 seconds, looping and HDR.
- Extend, edit and reframe earlier videos by passing their gateway task id as `generation_id`.
- Call Luma's own `POST /v1/generations` and `GET /v1/generations/{id}`, or the OpenAI video API at `POST /v1/videos`.
- Charge each task by Luma credits, reserved from Luma's published credit table and settled on the credits Luma reports.
- Download finished videos through the gateway, which fetches a fresh link from Luma so downloads keep working after Luma's one-hour link expires.
