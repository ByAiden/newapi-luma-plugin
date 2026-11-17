---
changelogVersion: 1
plugin: "changeyu0229_luma"
version: "1.2.0"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.2.0]

### Added

- Another New API gateway can be the upstream: bind the plugin to a New API channel (type 60) whose base URL is a gateway that has this plugin too. Requests go to that gateway's `/changeyu0229_luma/v1/generations` path with its token as a Bearer key. See "Through another New API gateway" in the README.
- The native generation reply keeps `usage.credits_charged`, so a gateway in front settles on the same credits.
