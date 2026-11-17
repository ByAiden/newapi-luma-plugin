---
translations:
  zh-CN: README.zh-CN.md
---
# Luma

**English** | [简体中文](README.zh-CN.md)

Generates, extends, edits and reframes videos with Luma's Ray 3.2 model, and generates and edits images with uni-1 and uni-1-max, through the [Luma Agents API](https://docs.agents.lumalabs.ai/).

## Channel setup

- Install the plugin, then add a channel of the Task Plugin type and bind it to `changeyu0229_luma`.
- The key is a Luma Agents API key from the [Luma API Platform](https://platform.lumalabs.ai/). These keys start with `luma-api-`. One key serves both video and image models.
- Leave the API address empty to use `https://agents.lumalabs.ai`. Enter another address only when you reach Luma through a proxy, and leave `/v1` off the end.
- Add the models you offer to the channel: `ray-3.2`, `uni-1`, `uni-1-max`. A channel can also offer them under other names through model mapping.

The plugin uses the current Luma Agents API only. Keys and model names of the retired Dream Machine API (`ray-2`, `ray-flash-2`, `api.lumalabs.ai/dream-machine`) do not work with it.

## Models and endpoints

| Endpoint | What it does | Models |
| --- | --- | --- |
| `POST /v1/generations` | Luma's own request body. Video: text to video, image to video, keyframes, extension (`type: "video"`), editing (`video_edit`) and reframing (`video_reframe`). Images: text to image and reference images (`image`), editing (`image_edit`) | `ray-3.2`, `uni-1`, `uni-1-max` |
| `POST /v1/videos` | OpenAI video API: `prompt`, `seconds`, `size`, `input_reference`, plus Luma's `aspect_ratio`, `resolution`, `loop` and `hdr` | `ray-3.2` |
| `POST /v1/images/generations` | OpenAI Images API: `prompt`, `size`, `output_format`, plus Luma's `aspect_ratio`, `style`, `web_search` and `image_ref` | `uni-1`, `uni-1-max` |
| `POST /v1/images/edits` | OpenAI image edits: the first `image` is the image to edit and any further images are references | `uni-1`, `uni-1-max` |

The Luma path also works under the plugin's prefix, as `/changeyu0229_luma/v1/generations`. Without a `type`, a request to `ray-3.2` is a video and a request to `uni-1` or `uni-1-max` is an image; a request to a mapped model name needs an explicit `type`.

Clients poll a task from the Luma path at `GET /v1/generations/{id}`. The reply keeps Luma's generation object; when the output is done, each `output[].url` is the gateway's download address, which keeps working after Luma's own one-hour link expires. Luma's team details are left out; of the usage only `credits_charged` is kept.
For a task from `POST /v1/videos`, clients poll `GET /v1/videos/{task_id}` and download the file from `GET /v1/videos/{task_id}/content`. The OpenAI Images endpoints wait for the image and answer with its URL, or with base64 data when the request sets `response_format: "b64_json"`.

To extend, edit or reframe an earlier video, or edit an earlier image, pass the gateway task id of that output as `generation_id`, for example `"video": {"start_frame": {"generation_id": "task_..."}}` or `"source": {"generation_id": "task_..."}`. The gateway checks that the task belongs to the caller and sends Luma's own id upstream.

## Billing

The price table has one field, "Luma credit unit price". Each task is charged by the Luma credits it costs, so set the price of one credit, for example `tier("base", u("credits") * P)` where `P` is your price per credit in USD. The same field covers every model; to price image and video credits differently, save a separate expression per model.

- When the task is submitted, the gateway reserves the credits from Luma's published pay-as-you-go table. Videos are priced by operation, resolution, duration and dynamic range. A video without a resolution or duration is charged as `720p` and `5s`, which the plugin sends to Luma explicitly.
- A video extension is charged as one 5-second block. Reframing is charged per second of output. A video edit without a `duration` reserves the 10-second price.
- An image costs a base price per model, 14 credits on `uni-1` and 34 on `uni-1-max`, plus one credit for each input image: the image being edited and each reference image.
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

An image through the OpenAI Images API:

```bash
curl https://your-gateway.example.com/v1/images/generations \
  -H "Authorization: Bearer $NEWAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "uni-1", "prompt": "A paper boat on a calm pond, watercolor", "size": "1024x1024"}'
```

## Through another New API gateway

A second gateway can sell Luma through yours. Install this plugin, at the same version, on both gateways:

- On the gateway that calls Luma, set up the Task Plugin channel above.
- On the other gateway, create a **New API** channel (type 60). Its base URL is the first gateway's address and its key is a token from the first gateway. Pick `changeyu0229_luma` under Upstream task plugins and add the models.

The outer gateway sends Luma's own requests to the first gateway's `/changeyu0229_luma/v1/generations` path with the token as a Bearer key and polls them there. Outputs download through the first gateway's download addresses, so set its server address (`ServerAddress`) to an address that the outer gateway, and clients of the OpenAI Images endpoints, can reach: those endpoints answer with the first gateway's image address, as they answer with Luma's own URL otherwise. Each gateway bills its own users with its own task expressions; the expression above works on both.

- Both gateways settle on the credits Luma reports: the first gateway's reply now passes on `usage.credits_charged`.
- Extending, editing or reframing an earlier output works with the outer gateway's task id; the outer gateway sends the first gateway's id upstream.

## Limits

- Video resolutions are `360p`, `540p`, `720p` and `1080p`; durations are `5s` and `10s`; aspect ratios are `9:16`, `3:4`, `1:1`, `4:3`, `16:9` and `21:9`.
- HDR needs `720p` or `1080p` and a 5-second clip. Extensions and reframes are standard dynamic range only.
- `start_frame` and `end_frame` do not work with `10s`; use `keyframes` with `keyframe_indexes` for 10-second image-guided videos.
- Image aspect ratios are `3:1`, `2:1`, `16:9`, `3:2`, `1:1`, `2:3`, `9:16`, `1:2` and `1:3`; `style: "manga"` takes a portrait ratio. On the OpenAI Images API, `size` picks the nearest ratio. Each request returns one image, so `n` must be 1, and `mask` is not supported.
- An image request takes up to 9 reference images, an edit up to 8.
- Images and videos are passed as URLs or base64 data with a `media_type`. Requests with `file_id` or `callback_url` are rejected, and fields Luma does not document are dropped.
- Image layering (`type: "layering"`) has no published price and is not supported. Luma's GLM chat models are a separate product with their own keys; add them as an ordinary OpenAI channel instead.
