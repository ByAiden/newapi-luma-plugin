// Runs the plugin's hooks the way the gateway calls them: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";

let fetchImpl = () => {
  throw new Error("utils.fetch is not available");
};
globalThis.utils = { fetch: (request) => fetchImpl(request) };

const plugin = await import("../plugin.js");
const { meta, native, protocols } = plugin;

const BASE = "https://agents.lumalabs.ai";

function decodeNative(body) {
  return native.createGeneration({ method: "POST", path: "/v1/generations", params: {}, query: {}, requestHeaders: {}, body: { kind: "json", value: body } });
}

function driver(intent, extra) {
  return Object.assign(
    { requestBody: intent.requestBody, action: intent.action, model: intent.model, upstreamModel: intent.model, baseUrl: BASE, apiKey: "luma-api-test", authHeader: "Bearer luma-api-test", upstream: { kind: "vendor" }, config: {}, files: [], publicTaskId: "task_new" },
    extra || {},
  );
}

function credits(body) {
  const intent = decodeNative(body);
  return plugin.extractUsage(driver(intent)).credits;
}

test("manifest follows the community rules", () => {
  assert.equal(meta.apiVersion, 1);
  assert.equal(meta.key, "changeyu0229_luma");
  assert.match(meta.key, /^changeyu0229_[a-z0-9_]+$/);
  assert.ok(meta.key.length <= 30);
  assert.match(meta.version, /^\d+\.\d+\.\d+$/);
  assert.equal(meta.baseUrl, BASE);
  for (const example of meta.usageExamples) assert.deepEqual(Object.keys(example.facts), Object.keys(meta.usageSchema));
  assert.ok(!JSON.stringify(meta.description).includes("$"));
});

test("text to video sends defaults and reserves the list price", () => {
  const intent = decodeNative({ model: "ray-3.2", prompt: "A fox in snow" });
  assert.equal(intent.action, "text_to_video");
  assert.equal(intent.originTaskIds, undefined);
  const request = plugin.buildSubmitRequest(driver(intent));
  assert.equal(request.url, BASE + "/v1/generations");
  assert.equal(request.headers.Authorization, "Bearer luma-api-test");
  assert.deepEqual(request.body, { model: "ray-3.2", type: "video", prompt: "A fox in snow", video: { resolution: "720p", duration: "5s" } });
  assert.equal(plugin.extractUsage(driver(intent)).credits, 100);
  assert.equal(plugin.extractUsage(Object.assign(driver(intent), { usagePurpose: "billing_ratios" })), null);
});

test("generation prices follow resolution, duration and dynamic range", () => {
  assert.equal(credits({ model: "ray-3.2", prompt: "x", video: { resolution: "360p" } }), 20);
  assert.equal(credits({ model: "ray-3.2", prompt: "x", video: { resolution: "540p", duration: "10s" } }), 150);
  assert.equal(credits({ model: "ray-3.2", prompt: "x", video: { resolution: "1080p", duration: 10 } }), 1200);
  assert.equal(credits({ model: "ray-3.2", prompt: "x", video: { resolution: "1080p", hdr: true } }), 800);
  assert.equal(credits({ model: "ray-3.2", prompt: "x", video: { resolution: "720p", hdr: true, exr_export: true } }), 300);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { resolution: "720p", hdr: true, duration: "10s" } }), /10s/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { resolution: "540p", hdr: true } }), /720p or 1080p/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { exr_export: true } }), /requires video.hdr/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { duration: "7s" } }), /5s or 10s/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { resolution: "4k" } }), /video.resolution/);
});

test("image to video and keyframes", () => {
  const intent = decodeNative({ model: "ray-3.2", prompt: "x", aspect_ratio: "16:9", video: { start_frame: { url: "https://a/1.jpg" }, end_frame: "https://a/2.jpg" } });
  assert.equal(intent.action, "image_to_video");
  assert.deepEqual(intent.requestBody.video.end_frame, { url: "https://a/2.jpg" });
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { duration: "10s", start_frame: "https://a/1.jpg" } }), /10s/);
  const keyed = decodeNative({ model: "ray-3.2", prompt: "x", video: { duration: "10s", keyframes: ["https://a/1.jpg", { data: "aGk=", media_type: "image/png" }], keyframe_indexes: [0, 240] } });
  assert.equal(keyed.action, "image_to_video");
  assert.equal(plugin.extractUsage(driver(keyed)).credits, 300);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { keyframes: ["https://a/1.jpg"], keyframe_indexes: [121] } }), /0 to 120/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { keyframes: ["https://a/1.jpg"], keyframe_indexes: [0, 1] } }), /same length/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { keyframes: ["https://a/1.jpg"] } }), /both be arrays/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { keyframes: ["https://a/1.jpg"], keyframe_indexes: [0], start_frame: "https://a/1.jpg" } }), /cannot be combined/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { start_frame: { data: "aGk=" } } }), /media_type is required/);
});

test("extension names a gateway task and sends Luma's generation id", () => {
  const intent = decodeNative({ model: "ray-3.2", prompt: "keep going", video: { resolution: "1080p", start_frame: { generation_id: "task_abc" } } });
  assert.equal(intent.action, "video_extend");
  assert.deepEqual(intent.originTaskIds, ["task_abc"]);
  assert.equal(plugin.extractUsage(driver(intent)).credits, 400);
  const origin = [{ taskId: "task_abc", upstreamTaskId: "d290f1ee-luma", action: "text_to_video", status: "SUCCESS", data: {} }];
  const request = plugin.buildSubmitRequest(driver(intent, { originTasks: origin }));
  assert.deepEqual(request.body.video.start_frame, { generation_id: "d290f1ee-luma" });
  assert.equal(intent.requestBody.video.start_frame.generation_id, "task_abc");
  assert.throws(() => plugin.buildSubmitRequest(driver(intent)), /not available/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { hdr: true, start_frame: { generation_id: "t" } } }), /standard dynamic range/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { start_frame: { generation_id: "t" }, end_frame: "https://a/1.jpg" } }), /exactly one/);
});

test("video edit", () => {
  const intent = decodeNative({
    model: "ray-3.2",
    type: "video_edit",
    prompt: "moonlit film",
    source: { url: "https://a/v.mp4", media_type: "video/mp4" },
    video: { edit: { strength: "flex_2", keyframes: [{ generation_id: "task_k" }], keyframe_indexes: [30] } },
  });
  assert.equal(intent.action, "video_edit");
  assert.deepEqual(intent.originTaskIds, ["task_k"]);
  assert.equal(intent.requestBody.video.duration, undefined);
  assert.equal(plugin.extractUsage(driver(intent)).credits, 720);
  const request = plugin.buildSubmitRequest(driver(intent, { originTasks: [{ taskId: "task_k", upstreamTaskId: "luma-k" }] }));
  assert.deepEqual(request.body.video.edit.keyframes, [{ generation_id: "luma-k" }]);
  assert.equal(request.body.video.edit.strength, "flex_2");
  assert.equal(credits({ model: "ray-3.2", type: "video_edit", prompt: "x", source: { generation_id: "t" }, video: { duration: "5s", resolution: "1080p", hdr: true, exr_export: true } }), 2160);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "video_edit", prompt: "x", source: { url: "https://a/v.mp4" } }), /video\/\*/);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "video_edit", prompt: "x" }), /source is required/);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "video_edit", prompt: "x", source: { generation_id: "t" }, video: { loop: true } }), /loop/);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "video_edit", prompt: "x", source: { generation_id: "t" }, video: { edit: { auto_controls: true, controls: {} } } }), /auto_controls/);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "video_edit", prompt: "x", source: { generation_id: "t" }, video: { edit: { strength: "max" } } }), /strength/);
});

test("video reframe", () => {
  const intent = decodeNative({ model: "ray-3.2", type: "video_reframe", prompt: "widen", aspect_ratio: "21:9", source: { generation_id: "task_r" }, video: { source_position: { x_norm: 0.25, y_norm: 0, w_norm: 0.5, h_norm: 1 } } });
  assert.equal(intent.action, "video_reframe");
  assert.equal(plugin.extractUsage(driver(intent)).credits, 200);
  assert.equal(credits({ model: "ray-3.2", type: "video_reframe", prompt: "x", aspect_ratio: "16:9", source: { generation_id: "t" }, video: { resolution: "1080p", duration: "10s" } }), 1200);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "video_reframe", prompt: "x", source: { generation_id: "t" } }), /aspect_ratio is required/);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "video_reframe", prompt: "x", aspect_ratio: "9:16", source: { generation_id: "t" }, video: { resolution: "1080p" } }), /720p/);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "video_reframe", prompt: "x", aspect_ratio: "1:1", source: { generation_id: "t" }, video: { hdr: true } }), /standard dynamic range/);
});

test("refused fields and bad input", () => {
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", callback_url: "https://me" }), /callback_url/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", video: { start_frame: { file_id: "f" } } }), /file_id/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", image_ref: [] }), /image_ref/);
  assert.throws(() => decodeNative({ model: "uni-1", type: "layering", prompt: "x", source: "https://a/1.png" }), /type must be one of/);
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "image", prompt: "x" }), /ray-3.2 takes type/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x", style: "manga" }), /only valid for image types/);
  assert.throws(() => decodeNative({ model: "ray-3.2" }), /prompt is required/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x".repeat(6001) }), /6000/);
  assert.throws(() => decodeNative({ prompt: "x" }), /model is required/);
  const dropped = decodeNative({ model: "ray-3.2", prompt: "x", seed: 7, extra: { a: 1 } });
  assert.equal(dropped.requestBody.seed, undefined);
  assert.equal(dropped.requestBody.extra, undefined);
});

test("a mapped model sends ray-3.2 upstream and keeps the alias", () => {
  assert.throws(() => decodeNative({ model: "luma-video", prompt: "x" }), /type is required/);
  const intent = decodeNative({ model: "luma-video", type: "video", prompt: "x" });
  const request = plugin.buildSubmitRequest(driver(intent, { model: "luma-video", upstreamModel: "ray-3.2" }));
  assert.equal(request.body.model, "ray-3.2");
  assert.throws(() => plugin.buildSubmitRequest(driver(intent, { model: "luma-video", upstreamModel: "ray-2" })), /not a supported/);
  assert.throws(() => plugin.buildSubmitRequest(driver(intent, { model: "luma-video", upstreamModel: "uni-1" })), /uni-1 takes type/);
  const image = decodeNative({ model: "luma-image", type: "image", prompt: "x" });
  assert.equal(plugin.extractUsage(driver(image, { model: "luma-image", upstreamModel: "uni-1-max" })).credits, 34);
});

const COMPLETED = {
  id: "luma-1",
  type: "video",
  state: "completed",
  model: "ray-3.2",
  created_at: "2026-11-12T12:00:00Z",
  output: [{ type: "video", url: "https://storage.cdn-luma.com/out.mp4?X-Amz-Expires=3600" }],
  failure_reason: null,
  failure_code: null,
  usage: { credits_charged: 100 },
  team: { id: "team-1", name: "Gateway Team" },
  user_id: null,
};

test("submit and poll", () => {
  const submitted = plugin.parseSubmitResponse({}, { statusCode: 201, headers: {}, body: { id: "luma-1", state: "queued", output: [] } });
  assert.equal(submitted.taskId, "luma-1");
  assert.throws(() => plugin.parseSubmitResponse({}, { statusCode: 201, headers: {}, body: {} }), /generation id/);
  const query = plugin.buildQueryRequest({ taskId: "luma-1", baseUrl: BASE, apiKey: "k" });
  assert.equal(query.url, BASE + "/v1/generations/luma-1");
  assert.equal(query.method, "GET");
  assert.deepEqual(plugin.parseTaskResult({}, { state: "queued" }, { status: 200 }), { status: "QUEUED" });
  assert.deepEqual(plugin.parseTaskResult({}, { state: "processing" }, { status: 200 }), { status: "IN_PROGRESS" });
  assert.deepEqual(plugin.parseTaskResult({}, COMPLETED, { status: 200 }), { status: "SUCCESS" });
  assert.equal(plugin.parseTaskResult({}, { state: "completed", output: [] }, { status: 200 }).status, "FAILURE");
  const failed = plugin.parseTaskResult({}, { state: "failed", failure_reason: "Prompt blocked", failure_code: "content_moderated" }, { status: 200 });
  assert.deepEqual(failed, { status: "FAILURE", reason: "Prompt blocked (content_moderated)" });
  assert.equal(plugin.parseTaskResult({}, { state: "weird" }, { status: 200 }).status, "UNKNOWN");
  assert.equal(plugin.parseTaskResult({}, null, { status: 200 }).status, "UNKNOWN");
});

test("settles on the credits Luma reports", () => {
  assert.deepEqual(plugin.extractUsageOnComplete({}, { status: "SUCCESS" }, COMPLETED), { credits: 100 });
  assert.equal(plugin.extractUsageOnComplete({}, { status: "SUCCESS" }, Object.assign({}, COMPLETED, { usage: { credits_charged: null } })), null);
  assert.equal(plugin.extractUsageOnComplete({}, { status: "SUCCESS" }, Object.assign({}, COMPLETED, { usage: { credits_charged: 0 } })), null);
  assert.equal(plugin.extractUsageOnComplete({}, { status: "SUCCESS" }, undefined), null);
});

test("native replies hide account details and use the gateway download address", () => {
  const view = native.generationStatus({ artifacts: { video: { key: "video", type: "video", url: "https://gw/v1/videos/task_1/content?sig=1" } } }, { task_id: "task_1", status: "SUCCESS", data: COMPLETED });
  assert.equal(view.id, "task_1");
  assert.equal(view.state, "completed");
  assert.equal(view.team, undefined);
  assert.deepEqual(view.usage, { credits_charged: 100 });
  assert.equal(view.output[0].url, "https://gw/v1/videos/task_1/content?sig=1");
  const created = native.generationCreated({}, { task_id: "task_1", status: "SUBMITTED", data: { id: "luma-1", state: "queued", output: [] } });
  assert.deepEqual(created, { id: "task_1", state: "queued", output: [] });
  const gatewayFailed = native.generationStatus({ artifacts: {} }, { task_id: "task_1", status: "FAILURE", fail_reason: "timeout", data: { id: "luma-1", state: "processing", output: [] } });
  assert.equal(gatewayFailed.state, "failed");
  assert.equal(gatewayFailed.failure_reason, "timeout");
  assert.deepEqual(native.error({}, { code: "bad_request", message: "prompt is required", httpStatus: 400 }), { detail: "prompt is required", error: { code: "bad_request" } });
});

test("artifacts and download with a fresh URL", () => {
  assert.deepEqual(plugin.listArtifacts({ status: "SUCCESS", data: COMPLETED }), [{ key: "video", type: "video", mimeType: "video/mp4" }]);
  assert.deepEqual(plugin.listArtifacts({ status: "FAILURE", data: COMPLETED }), []);
  const ctx = { artifactKey: "video", data: COMPLETED, upstreamTaskId: "luma-1", baseUrl: BASE, apiKey: "k", clientRequest: { method: "GET", headers: {} } };
  let seen = null;
  fetchImpl = (request) => {
    seen = request;
    return { status: 200, headers: {}, body: Object.assign({}, COMPLETED, { output: [{ type: "video", url: "https://storage.cdn-luma.com/fresh.mp4" }] }) };
  };
  assert.deepEqual(plugin.buildContentRequest(ctx), { url: "https://storage.cdn-luma.com/fresh.mp4", method: "GET", credentialless: true });
  assert.equal(seen.url, BASE + "/v1/generations/luma-1");
  assert.equal(seen.headers.Authorization, "Bearer k");
  fetchImpl = () => {
    throw new Error("network down");
  };
  assert.equal(plugin.buildContentRequest(ctx).url, COMPLETED.output[0].url);
  assert.throws(() => plugin.buildContentRequest(Object.assign({}, ctx, { artifactKey: "exr" })), /artifact_not_found/);
});

test("OpenAI video API", () => {
  const decode = (body) => protocols.openai_video.decodeRequest(Object.assign({ protocol: "openai_video", operation: "create", model: "ray-3.2", stream: false, method: "POST", path: "/v1/videos", params: {}, query: {}, requestHeaders: {} }, { body: body }));
  const json = decode({ kind: "json", value: { model: "ray-3.2", prompt: "A city", seconds: "10", size: "1920x1080" } });
  assert.equal(json.action, "text_to_video");
  assert.equal(json.requestBody.aspect_ratio, "16:9");
  assert.deepEqual(json.requestBody.video, { resolution: "1080p", duration: "10s" });
  assert.equal(plugin.extractUsage(driver(json)).credits, 1200);
  const portrait = decode({ kind: "json", value: { model: "ray-3.2", prompt: "x", size: "720x1280", input_reference: { image_url: "https://a/1.jpg" } } });
  assert.equal(portrait.requestBody.aspect_ratio, "9:16");
  assert.equal(portrait.requestBody.video.resolution, "720p");
  assert.deepEqual(portrait.requestBody.video.start_frame, { url: "https://a/1.jpg" });
  const multipart = decode({
    kind: "multipart",
    fields: { model: ["ray-3.2"], prompt: ["A cat"], seconds: ["5"], hdr: ["true"], resolution: ["1080p"] },
    files: [{ ref: "request_file:input_reference", field: "input_reference", filename: "a.png", mimeType: "image/png", size: 10 }],
  });
  assert.equal(multipart.action, "image_to_video");
  assert.deepEqual(multipart.requestBody.video.start_frame, { data: { __fileRef: "request_file:input_reference", encoding: "base64" }, media_type: "image/png" });
  assert.equal(plugin.extractUsage(driver(multipart)).credits, 800);
  assert.throws(() => decode({ kind: "json", value: { model: "ray-3.2", prompt: "x", seconds: "8" } }), /5s or 10s/);
  assert.throws(() => decode({ kind: "multipart", fields: { prompt: ["x"] }, files: [{ ref: "r", field: "video", mimeType: "video/mp4" }] }), /unexpected file field/);
  assert.deepEqual(protocols.openai_video.render({}, { status: "SUCCESS", data: COMPLETED }), { object: "video" });
  const failed = protocols.openai_video.render({}, { status: "FAILURE", fail_reason: "Prompt blocked (content_moderated)", data: { state: "failed", failure_code: "content_moderated" } });
  assert.deepEqual(failed.error, { code: "content_moderated", message: "Prompt blocked (content_moderated)" });
});

test("hooks leave their arguments unchanged", () => {
  const body = { model: "ray-3.2", prompt: "x", video: { start_frame: { generation_id: "task_a" } } };
  const frozen = JSON.stringify(body);
  const intent = decodeNative(body);
  plugin.buildSubmitRequest(driver(intent, { originTasks: [{ taskId: "task_a", upstreamTaskId: "luma-a" }] }));
  assert.equal(JSON.stringify(body), frozen);
  assert.equal(intent.requestBody.video.start_frame.generation_id, "task_a");
});

const IMAGE_DONE = {
  id: "luma-img",
  type: "image",
  state: "completed",
  model: "uni-1",
  output: [{ type: "image", url: "https://storage.cdn-luma.com/out.png?X-Amz-Expires=3600" }],
  usage: { credits_charged: 14 },
  team: { id: "t", name: "Gateway Team" },
};

test("images: generation, references and edits", () => {
  const plain = decodeNative({ model: "uni-1", prompt: "A cat" });
  assert.equal(plain.action, "text_to_image");
  const request = plugin.buildSubmitRequest(driver(plain));
  assert.deepEqual(request.body, { model: "uni-1", type: "image", prompt: "A cat" });
  assert.equal(plugin.extractUsage(driver(plain)).credits, 14);
  const refs = decodeNative({ model: "uni-1-max", prompt: "x", aspect_ratio: "2:3", style: "manga", output_format: "jpg", web_search: true, image_ref: ["https://a/1.png", { data: "aGk=", media_type: "image/png" }] });
  assert.equal(refs.action, "image_reference");
  assert.equal(refs.requestBody.output_format, "jpeg");
  assert.equal(plugin.extractUsage(driver(refs)).credits, 36);
  const edit = decodeNative({ model: "uni-1", type: "image_edit", prompt: "sunset sky", source: { generation_id: "task_img" }, image_ref: ["https://a/r.png", "https://a/s.png"] });
  assert.equal(edit.action, "image_edit");
  assert.deepEqual(edit.originTaskIds, ["task_img"]);
  assert.equal(plugin.extractUsage(driver(edit)).credits, 17);
  const sent = plugin.buildSubmitRequest(driver(edit, { originTasks: [{ taskId: "task_img", upstreamTaskId: "luma-img" }] }));
  assert.deepEqual(sent.body.source, { generation_id: "luma-img" });
  assert.equal(sent.body.video, undefined);
  const max = Array.from({ length: 9 }, (_, i) => "https://a/" + i + ".png");
  assert.equal(credits({ model: "uni-1-max", prompt: "x", image_ref: max }), 43);
  assert.throws(() => decodeNative({ model: "uni-1", type: "image_edit", prompt: "x", source: "https://a/1.png", image_ref: max }), /at most 8/);
  assert.throws(() => decodeNative({ model: "uni-1", prompt: "x", style: "manga", aspect_ratio: "16:9" }), /portrait/);
  assert.throws(() => decodeNative({ model: "uni-1", type: "image_edit", prompt: "x" }), /source is required/);
  assert.throws(() => decodeNative({ model: "uni-1", prompt: "x", source: "https://a/1.png" }), /only valid for image_edit/);
  assert.throws(() => decodeNative({ model: "uni-1", prompt: "x", image_ref: [{ generation_id: "t" }] }), /generation_id/);
  assert.throws(() => decodeNative({ model: "uni-1", prompt: "x", video: { resolution: "720p" } }), /video types/);
  assert.throws(() => decodeNative({ model: "uni-1", type: "video", prompt: "x" }), /uni-1 takes type/);
  assert.throws(() => decodeNative({ model: "uni-1", prompt: "x", output_format: "webp" }), /output_format/);
});

test("images: poll, artifacts, native view and download", () => {
  assert.deepEqual(plugin.parseTaskResult({}, IMAGE_DONE, { status: 200 }), { status: "SUCCESS" });
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, IMAGE_DONE), { credits: 14 });
  assert.deepEqual(plugin.listArtifacts({ status: "SUCCESS", data: IMAGE_DONE }), [{ key: "image-1", type: "image", mimeType: "image/png" }]);
  const view = native.generationStatus({ artifacts: { "image-1": { url: "https://gw/a/image-1" } } }, { task_id: "task_i", status: "SUCCESS", data: IMAGE_DONE });
  assert.equal(view.output[0].url, "https://gw/a/image-1");
  assert.equal(view.team, undefined);
  fetchImpl = () => ({ status: 200, headers: {}, body: Object.assign({}, IMAGE_DONE, { output: [{ type: "image", url: "https://storage.cdn-luma.com/fresh.png" }] }) });
  const ctx = { artifactKey: "image-1", data: IMAGE_DONE, upstreamTaskId: "luma-img", baseUrl: BASE, apiKey: "k", clientRequest: { method: "GET", headers: {} } };
  assert.equal(plugin.buildContentRequest(ctx).url, "https://storage.cdn-luma.com/fresh.png");
  assert.throws(() => plugin.buildContentRequest(Object.assign({}, ctx, { artifactKey: "video" })), /artifact_not_found/);
});

test("OpenAI Images API", () => {
  const decode = (operation, body) => protocols.openai_image.decodeRequest({ protocol: "openai_image", operation, model: "uni-1", stream: false, method: "POST", path: "/v1/images", params: {}, query: {}, requestHeaders: {}, body });
  const gen = decode("generate", { kind: "json", value: { model: "uni-1", prompt: "A fox", size: "1536x1024", n: 1, response_format: "b64_json", quality: "high" } });
  assert.equal(gen.action, "text_to_image");
  assert.deepEqual(gen.requestBody, { model: "uni-1", type: "image", prompt: "A fox", aspect_ratio: "3:2" });
  assert.equal(decode("generate", { kind: "json", value: { prompt: "x", size: "auto" } }).requestBody.aspect_ratio, undefined);
  assert.throws(() => decode("generate", { kind: "json", value: { prompt: "x", n: 2 } }), /n must be 1/);
  assert.throws(() => decode("generate", { kind: "json", value: { prompt: "x", image: "https://a/1.png" } }), /only valid on/);
  const jsonEdit = decode("edit", { kind: "json", value: { prompt: "x", images: [{ image_url: "https://a/1.png" }, { image_url: "https://a/2.png" }] } });
  assert.equal(jsonEdit.action, "image_edit");
  assert.deepEqual(jsonEdit.requestBody.source, { url: "https://a/1.png" });
  assert.deepEqual(jsonEdit.requestBody.image_ref, [{ url: "https://a/2.png" }]);
  assert.equal(plugin.extractUsage(driver(jsonEdit)).credits, 16);
  const multipart = decode("edit", {
    kind: "multipart",
    fields: { prompt: ["make it night"] },
    files: [
      { ref: "request_file:image[]", field: "image[]", filename: "a.png", mimeType: "image/png", size: 1 },
      { ref: "request_file:image[]#1", field: "image[]", filename: "b.jpg", mimeType: "image/jpeg", size: 1 },
    ],
  });
  assert.deepEqual(multipart.requestBody.source, { data: { __fileRef: "request_file:image[]", encoding: "base64" }, media_type: "image/png" });
  assert.equal(multipart.requestBody.image_ref.length, 1);
  assert.throws(() => decode("edit", { kind: "json", value: { prompt: "x" } }), /image is required/);
  assert.throws(() => decode("edit", { kind: "multipart", fields: { prompt: ["x"], mask: ["m"] }, files: [] }), /mask/);
  assert.deepEqual(protocols.openai_image.render({}, { status: "SUCCESS", data: IMAGE_DONE }), { data: [{ url: IMAGE_DONE.output[0].url }] });
});

test("manifest binds each protocol to its models", () => {
  assert.deepEqual(meta.models, ["ray-3.2", "uni-1", "uni-1-max"]);
  assert.deepEqual(meta.protocols, [{ name: "openai_video", models: ["ray-3.2"] }, { name: "openai_image", models: ["uni-1", "uni-1-max"] }]);
});

test("meta is a JSON object literal the marketplace can read without running the plugin", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
  const start = source.indexOf("export const meta = ") + "export const meta = ".length;
  const literal = source.slice(start, source.indexOf(";\n", start));
  assert.deepEqual(JSON.parse(literal), JSON.parse(JSON.stringify(meta)));
});

test("PLUGIN_KEY matches meta.key and new_api is declared", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
  assert.equal(source.match(/const PLUGIN_KEY = "([^"]+)";/)[1], meta.key);
  assert.deepEqual(meta.upstreams, ["vendor", "new_api"]);
});

// The middle gateway runs this plugin too: the driver addresses its native
// routes under /{key} with the gateway token and reads what the middle's own
// presenters render.
const MIDDLE = "https://middle.example";
const viaGateway = { baseUrl: MIDDLE, apiKey: "sk-middle", authHeader: "Bearer sk-middle", upstream: { kind: "new_api" } };

test("new_api: video submit, query, settlement and content through the middle gateway", () => {
  const intent = decodeNative({ model: "ray-3.2", prompt: "A fox", video: { resolution: "1080p", duration: "10s" } });
  const request = plugin.buildSubmitRequest(driver(intent, viaGateway));
  assert.equal(request.url, MIDDLE + "/" + meta.key + "/v1/generations");
  assert.equal(request.headers.Authorization, "Bearer sk-middle");
  // The middle plugin decodes the body the outer layer sends and reserves the same credits.
  const middle = decodeNative(request.body);
  assert.deepEqual(plugin.extractUsage(driver(middle)), plugin.extractUsage(driver(intent, viaGateway)));
  assert.equal(plugin.extractUsage(driver(middle)).credits, 1200);
  const created = native.generationCreated({}, { task_id: "task_mid", status: "SUBMITTED", data: { id: "luma-1", state: "queued", output: [] } });
  assert.equal(plugin.parseSubmitResponse(driver(intent, viaGateway), { statusCode: 200, headers: {}, body: created }).taskId, "task_mid");
  const q = Object.assign({ taskId: "task_mid", model: "ray-3.2", upstreamModel: "ray-3.2" }, viaGateway);
  const queryRequest = plugin.buildQueryRequest(q);
  assert.equal(queryRequest.url, MIDDLE + "/" + meta.key + "/v1/generations/task_mid");
  assert.equal(queryRequest.headers.Authorization, "Bearer sk-middle");
  const rendered = native.generationStatus({ artifacts: { video: { key: "video", type: "video", url: "https://middle.example/signed/video" } } }, { task_id: "task_mid", status: "SUCCESS", data: COMPLETED });
  assert.equal(rendered.team, undefined);
  assert.deepEqual(rendered.usage, { credits_charged: 100 });
  const result = plugin.parseTaskResult(q, rendered, { status: 200 });
  assert.deepEqual(result, { status: "SUCCESS" });
  // The outer layer settles on the same facts as the middle layer.
  assert.deepEqual(plugin.extractUsageOnComplete(q, result, rendered), plugin.extractUsageOnComplete({}, result, COMPLETED));
  assert.deepEqual(plugin.listArtifacts({ status: "SUCCESS", data: rendered }), [{ key: "video", type: "video", mimeType: "video/mp4" }]);
  const seen = [];
  fetchImpl = (req) => {
    seen.push(req);
    return { status: 200, body: rendered };
  };
  const content = plugin.buildContentRequest(Object.assign({}, q, { upstreamTaskId: "task_mid", artifactKey: "video", clientRequest: { method: "GET" }, data: rendered }));
  assert.deepEqual(content, { url: "https://middle.example/signed/video", method: "GET", credentialless: true });
  assert.equal(seen[0].url, MIDDLE + "/" + meta.key + "/v1/generations/task_mid");
  assert.equal(seen[0].headers.Authorization, "Bearer sk-middle");
  fetchImpl = () => {
    throw new Error("utils.fetch is not available");
  };
  const failed = native.generationStatus({ artifacts: {} }, { task_id: "task_mid", status: "FAILURE", fail_reason: "timeout", data: { id: "luma-1", state: "processing", output: [] } });
  assert.equal(plugin.parseTaskResult(q, failed, { status: 200 }).status, "FAILURE");
});

test("new_api: extending a generation names the middle gateway's task id", () => {
  const intent = decodeNative({ model: "ray-3.2", prompt: "more", video: { start_frame: { generation_id: "task_outer_1" } } });
  assert.deepEqual(intent.originTaskIds, ["task_outer_1"]);
  // The outer gateway's origin task holds the middle gateway's public id as its upstream id.
  const request = plugin.buildSubmitRequest(driver(intent, Object.assign({ originTasks: [{ taskId: "task_outer_1", upstreamTaskId: "task_mid_1" }] }, viaGateway)));
  assert.deepEqual(request.body.video.start_frame, { generation_id: "task_mid_1" });
  assert.deepEqual(decodeNative(request.body).originTaskIds, ["task_mid_1"]);
});

test("new_api: images read the middle's rendered generation", () => {
  const intent = decodeNative({ model: "uni-1", prompt: "A cat" });
  const request = plugin.buildSubmitRequest(driver(intent, viaGateway));
  assert.equal(request.url, MIDDLE + "/" + meta.key + "/v1/generations");
  const rendered = native.generationStatus({ artifacts: { "image-1": { url: "https://middle.example/signed/img" } } }, { task_id: "task_img", status: "SUCCESS", data: IMAGE_DONE });
  assert.deepEqual(plugin.extractUsageOnComplete({}, { status: "SUCCESS" }, rendered), { credits: 14 });
  assert.deepEqual(protocols.openai_image.render({}, { status: "SUCCESS", data: rendered }), { data: [{ url: "https://middle.example/signed/img" }] });
});

test("a missing ctx.upstream means the vendor", () => {
  const intent = decodeNative({ model: "uni-1", prompt: "A cat" });
  const ctx = driver(intent);
  delete ctx.upstream;
  assert.equal(plugin.buildSubmitRequest(ctx).url, BASE + "/v1/generations");
});
