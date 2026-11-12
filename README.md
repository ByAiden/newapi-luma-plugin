---
translations:
  zh-CN: README.zh-CN.md
---
# Luma Ray

**English** | [简体中文](README.zh-CN.md)

Generates, extends, edits and reframes videos with Luma's Ray 3.2 model through the [Luma Agents API](https://docs.agents.lumalabs.ai/).

## Channel setup

- Install the plugin, then add a channel of the Task Plugin type and bind it to `changeyu0229_luma`.
- The key is a Luma Agents API key from the [Luma API Platform](https://platform.lumalabs.ai/). These keys start with `luma-api-`.
- Leave the API address empty to use `https://agents.lumalabs.ai`. Enter another address only when you reach Luma through a proxy, and leave `/v1` off the end.
- Add `ray-3.2` to the channel's models. A channel can also offer it under another name through model mapping.

The plugin uses the current Luma Agents API only. Keys and model names of the retired Dream Machine API (`ray-2`, `ray-flash-2`, `api.lumalabs.ai/dream-machine`) do not work with it.

## Models and endpoints

| Endpoint | What it does | Models |
| --- | --- | --- |
| `POST /v1/generations` | Luma's own request body: text to video, image to video, keyframes, extension (`type: "video"`), editing (`video_edit`) and reframing (`video_reframe`) | `ray-3.2` |
| `POST /v1/videos` | OpenAI video API: `prompt`, `seconds`, `size`, `input_reference`, plus Luma's `aspect_ratio`, `resolution`, `loop` and `hdr` | `ray-3.2` |

The Luma path also works under the plugin's prefix, as `/changeyu0229_luma/v1/generations`.

Clients poll a task from the Luma path at `GET /v1/generations/{id}`. The reply keeps Luma's generation object; when the video is done, `output[0].url` is the gateway's download address, which keeps working after Luma's own one-hour link expires. Luma's team and usage details are left out.
For a task from `POST /v1/videos`, clients poll `GET /v1/videos/{task_id}` and download the file from `GET /v1/videos/{task_id}/content`.

To extend, edit or reframe an earlier video, pass the gateway task id of that video as `generation_id`, for example `"video": {"start_frame": {"generation_id": "task_..."}}` or `"source": {"generation_id": "task_..."}`. The gateway checks that the task belongs to the caller and sends Luma's own id upstream.

## Billing

The price table has one field, "Luma credit unit price". Each task is charged by the Luma credits it costs, so set the price of one credit, for example `tier("base", u("credits") * P)` where `P` is your price per credit in USD.

- When the task is submitted, the gateway reserves the credits from Luma's published pay-as-you-go table for the operation, resolution, duration and dynamic range in the request. A generation without a resolution or duration is charged as `720p` and `5s`, which the plugin sends to Luma explicitly.
- An extension is charged as one 5-second block. Reframing is charged per second of output. An edit without a `duration` reserves the 10-second price.
- When Luma reports `usage.credits_charged` by the time the task finishes, the task settles on that count. Otherwise the reserved count stands. A count of zero, as on Provisioned Throughput plans, is ignored.
- Failed generations are refunded in full, including the rare `budget_exhausted` failure that Luma may charge in part.

Luma may change its credit table before general availability. Check the [Luma pricing page](https://docs.agents.lumalabs.ai/guides/pricing/) when you set prices.

## Example

```bash
curl https://your-gateway.example.com/v1/generations \
  -H "Authorization: Bearer $NEWAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "ray-3.2", "type": "video", "prompt": "A slow dolly shot through a misty greenhouse at sunrise", "aspect_ratio": "16:9", "video": {"resolution": "720p", "duration": "5s"}}'
```

Poll the task with the `id` from the reply:

```bash
curl https://your-gateway.example.com/v1/generations/{id} \
  -H "Authorization: Bearer $NEWAPI_TOKEN"
```

## Limits

- Resolutions are `360p`, `540p`, `720p` and `1080p`; durations are `5s` and `10s`; aspect ratios are `9:16`, `3:4`, `1:1`, `4:3`, `16:9` and `21:9`.
- HDR needs `720p` or `1080p` and a 5-second clip. Extensions and reframes are standard dynamic range only.
- `start_frame` and `end_frame` do not work with `10s`; use `keyframes` with `keyframe_indexes` for 10-second image-guided videos.
- Images and videos are passed as URLs or base64 data with a `media_type`. Requests with `file_id`, `callback_url` or `image_ref` are rejected, and fields Luma does not document for video are dropped.
- Image models (`uni-1`, `uni-1-max`) are not part of this plugin.
