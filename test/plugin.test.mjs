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
  assert.deepEqual(meta.models, ["ray-3.2"]);
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
  assert.throws(() => decodeNative({ model: "ray-3.2", type: "image", prompt: "x" }), /type must be one of/);
  assert.throws(() => decodeNative({ model: "ray-3.2" }), /prompt is required/);
  assert.throws(() => decodeNative({ model: "ray-3.2", prompt: "x".repeat(6001) }), /6000/);
  assert.throws(() => decodeNative({ prompt: "x" }), /model is required/);
  const dropped = decodeNative({ model: "ray-3.2", prompt: "x", output_format: "png", web_search: true });
  assert.equal(dropped.requestBody.output_format, undefined);
  assert.equal(dropped.requestBody.web_search, undefined);
});

test("a mapped model sends ray-3.2 upstream and keeps the alias", () => {
  const intent = decodeNative({ model: "luma-video", prompt: "x" });
  const request = plugin.buildSubmitRequest(driver(intent, { model: "luma-video", upstreamModel: "ray-3.2" }));
  assert.equal(request.body.model, "ray-3.2");
  assert.throws(() => plugin.buildSubmitRequest(driver(intent, { model: "luma-video", upstreamModel: "ray-2" })), /not a supported/);
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
  assert.equal(view.usage, undefined);
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
