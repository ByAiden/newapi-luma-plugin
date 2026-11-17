---
changelogVersion: 1
plugin: "changeyu0229_luma"
version: "1.2.0"
locale: "zh-CN"
---
# Changelog

## [1.2.0]

### Added

- 可以把另一个 New API 网关作为上游：把插件绑定到 New API 渠道（类型 60），Base URL 填同样安装了本插件的网关。请求发往该网关的 `/changeyu0229_luma/v1/generations` 路径，用它的令牌作为 Bearer 密钥。详见 README 的「经由另一个 New API 网关」。
- 原生 generation 返回保留 `usage.credits_charged`，前面的网关可以按相同的积分结算。
