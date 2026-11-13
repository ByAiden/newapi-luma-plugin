---
changelogVersion: 1
plugin: luma
version: 1.1.0
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---

# Changelog

## [1.1.0]

### Added

- Generate videos with Luma's `ray-3.2` model from text, from a start and end frame, or from up to 64 keyframes, with 360p to 1080p output, 5 or 10 seconds, looping and HDR.
- Extend, edit and reframe earlier videos by passing their gateway task id as `generation_id`.
- Generate images with `uni-1` and `uni-1-max` from text and up to 9 reference images, and edit images, including earlier outputs named by their gateway task id.
- Call Luma's own `POST /v1/generations` and `GET /v1/generations/{id}`, the OpenAI video API at `POST /v1/videos`, or the OpenAI Images API at `POST /v1/images/generations` and `POST /v1/images/edits`.
- Charge each task by Luma credits, reserved from Luma's published credit table and settled on the credits Luma reports.
- Download finished outputs through the gateway, which fetches a fresh link from Luma so downloads keep working after Luma's one-hour link expires.
