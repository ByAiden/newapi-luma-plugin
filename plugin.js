// Luma Agents API (docs.agents.lumalabs.ai): Ray 3.2 video (text to video,
// image to video, multi-keyframe video, extending a finished video, video
// editing and aspect-ratio reframing) and uni-1 / uni-1-max images (text to
// image, reference images and image editing). Every operation is one
// POST /v1/generations, polled at GET /v1/generations/{id}.
const VIDEO_MODELS = ["ray-3.2"];
const IMAGE_MODELS = ["uni-1", "uni-1-max"];
const ALL_MODELS = VIDEO_MODELS.concat(IMAGE_MODELS);

const VIDEO_TYPES = ["video", "video_edit", "video_reframe"];
// Layering (type "layering") has no published price, so it is not offered.
const IMAGE_TYPES = ["image", "image_edit"];
const TYPES = VIDEO_TYPES.concat(IMAGE_TYPES);
const ASPECT_RATIOS = ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"];
const IMAGE_ASPECT_RATIOS = ["3:1", "2:1", "16:9", "3:2", "1:1", "2:3", "9:16", "1:2", "1:3"];
const MANGA_ASPECT_RATIOS = ["2:3", "9:16", "1:2", "1:3"];
const IMAGE_STYLES = ["auto", "manga"];
const OUTPUT_FORMATS = ["png", "jpeg"];
const RESOLUTIONS = ["360p", "540p", "720p", "1080p"];
const DURATIONS = ["5s", "10s"];
const EDIT_STRENGTHS = ["adhere_1", "adhere_2", "adhere_3", "flex_1", "flex_2", "flex_3", "reimagine_1", "reimagine_2", "reimagine_3"];
const DEFAULT_RESOLUTION = "720p";
const DEFAULT_DURATION = "5s";
const MAX_PROMPT_LENGTH = 6000;
const MAX_KEYFRAMES = 64;
const FRAMES_PER_SECOND = 24;
// An image request holds up to 9 reference images; an edit's source takes one
// of those slots.
const MAX_IMAGE_REFS = { image: 9, image_edit: 8 };

// Luma's published pay-as-you-go list prices, in Luma credits
// (docs.agents.lumalabs.ai/guides/pricing). They reserve a task's charge; a
// task settles on usage.credits_charged when Luma reports it.
const GENERATION_CREDITS = {
  sdr: { "360p": { 5: 20, 10: 60 }, "540p": { 5: 50, 10: 150 }, "720p": { 5: 100, 10: 300 }, "1080p": { 5: 400, 10: 1200 } },
  hdr: { "720p": { 5: 200 }, "1080p": { 5: 800 } },
  hdr_exr: { "720p": { 5: 300 }, "1080p": { 5: 1200 } },
};
// An extension always bills one 5-second block. Luma lists no 360p extension
// price, so it reserves the 540p one.
const EXTEND_CREDITS = { "360p": 50, "540p": 50, "720p": 100, "1080p": 400 };
const REFRAME_CREDITS_PER_SECOND = { "360p": 10, "540p": 20, "720p": 40, "1080p": 120 };
const EDIT_CREDITS = { "360p": { 5: 180, 10: 360 }, "540p": { 5: 240, 10: 480 }, "720p": { 5: 360, 10: 720 }, "1080p": { 5: 720, 10: 1440 } };
const EDIT_DYNAMIC_RANGE_FACTOR = { sdr: 1, hdr: 2, hdr_exr: 3 };
// A text-to-image costs the base price; each input image (an edit's source or
// a reference image) adds one credit.
const IMAGE_BASE_CREDITS = { "uni-1": 14, "uni-1-max": 34 };
// The highest credit count one task can cost: a 10-second 1080p HDR + EXR edit.
const MAX_CREDITS = 4320;

const USAGE_SCHEMA = {
  credits: {
    type: "number",
    unit: "credit",
    description: { en: "Luma credit unit price", zh: "Luma 积分单价" },
  },
};

export const meta = {
  apiVersion: 1,
  key: "changeyu0229_luma",
  name: "Luma",
  icon: "Luma.Color",
  description: {
    en: "Luma Ray 3.2 video (text-to-video, image-to-video, keyframes, extension, editing, and reframing) and uni-1 image generation and editing",
    zh: "Luma Ray 3.2 视频（文生视频、图生视频、关键帧、视频延长、视频编辑、画幅重构）与 uni-1 图片生成和编辑",
  },
  version: "1.0.0",
  author: { name: "ChangeYu0229", url: "https://github.com/ChangeYu0229" },
  website: "https://docs.agents.lumalabs.ai/",
  baseUrl: "https://agents.lumalabs.ai",
  models: ALL_MODELS,
  fetchMode: "per_task",
  usageSchema: USAGE_SCHEMA,
  usageExamples: [
    { label: "video 720p 5s", facts: { credits: 100 } },
    { label: "video 1080p 10s", facts: { credits: 1200 } },
    { label: "video 1080p 5s HDR", facts: { credits: 800 } },
    { label: "video extend 720p", facts: { credits: 100 } },
    { label: "video edit 720p 10s", facts: { credits: 720 } },
    { label: "video reframe 720p 5s", facts: { credits: 200 } },
    { label: "uni-1 image", facts: { credits: 14 } },
    { label: "uni-1 edit · 2 refs", facts: { credits: 17 } },
    { label: "uni-1-max image", facts: { credits: 34 } },
  ],
  routes: [
    { method: "POST", path: "/v1/generations", type: "submit", decode: "createGeneration", render: "generationCreated", models: ALL_MODELS },
    { method: "GET", path: "/v1/generations/:generation_id", type: "query", taskIdParam: "generation_id", render: "generationStatus" },
  ],
  protocols: [
    { name: "openai_video", models: VIDEO_MODELS },
    { name: "openai_image", models: IMAGE_MODELS },
  ],
};

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function present(value) {
  return value !== undefined && value !== null;
}

function given(value) {
  return present(value) && value !== "";
}

function isImageType(type) {
  return IMAGE_TYPES.includes(type);
}

// The model the channel sends upstream: the mapped name first, then the
// client's.
function upstreamModel(identity) {
  const names = [identity.upstreamModel, identity.model].map(trimmed).filter(Boolean);
  for (const name of names) {
    if (ALL_MODELS.includes(name)) return name;
  }
  throw new Error((names[0] || "model") + " is not a supported Luma model; use " + ALL_MODELS.join(", "));
}

function checkModelType(model, type) {
  if (VIDEO_MODELS.includes(model) && !VIDEO_TYPES.includes(type)) throw new Error(model + " takes type " + VIDEO_TYPES.join(", "));
  if (IMAGE_MODELS.includes(model) && !IMAGE_TYPES.includes(type)) throw new Error(model + " takes type " + IMAGE_TYPES.join(", "));
}

function optionalBoolean(value, name) {
  if (!present(value)) return undefined;
  if (typeof value !== "boolean") throw new Error(name + " must be true or false");
  return value;
}

function optionalString(value, name) {
  if (!present(value)) return "";
  if (typeof value !== "string") throw new Error(name + " must be a string");
  return value.trim();
}

function enumValue(value, name, allowed) {
  const text = trimmed(value).toLowerCase();
  if (!allowed.includes(text)) throw new Error(name + " must be one of " + allowed.join(", "));
  return text;
}

function durationValue(value) {
  const text = typeof value === "number" ? value + "s" : trimmed(value).toLowerCase();
  const normalized = /^\d+$/.test(text) ? text + "s" : text;
  if (!DURATIONS.includes(normalized)) throw new Error("duration must be 5s or 10s");
  return normalized;
}

// Media references are a URL, inline base64 data with its media type, a
// gateway file placeholder, or, where Luma takes one, an earlier generation.
// Generations are named by their gateway task ids, which the gateway checks
// belong to the caller before the driver swaps in Luma's ids. A file_id would
// name a file in the gateway's own Luma account, which callers must not reach.
function mediaRef(value, name, options) {
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(name + " must not be empty");
    return { url: value.trim() };
  }
  const object = plainObject(value);
  if (!object) throw new Error(name + " must be a URL or an object");
  if (present(object.file_id)) throw new Error(name + ".file_id is not supported; pass a url or base64 data");
  const fields = ["url", "data", "generation_id"].filter(function (key) {
    return present(object[key]);
  });
  if (fields.length !== 1) throw new Error(name + " must have exactly one of url, data" + (options.generation ? " or generation_id" : ""));
  const mediaType = optionalString(object.media_type, name + ".media_type");
  if (options.video && fields[0] !== "generation_id" && !/^video\//.test(mediaType)) throw new Error(name + ".media_type must be a video/* type such as video/mp4");
  if (fields[0] === "generation_id") {
    if (!options.generation) throw new Error(name + ".generation_id is not supported here");
    const id = optionalString(object.generation_id, name + ".generation_id");
    if (!id) throw new Error(name + ".generation_id must not be empty");
    return { generation_id: id };
  }
  if (fields[0] === "url") {
    const url = optionalString(object.url, name + ".url");
    if (!url) throw new Error(name + ".url must not be empty");
    const ref = { url: url };
    if (mediaType) ref.media_type = mediaType;
    return ref;
  }
  // data is base64 text or a gateway file placeholder from a multipart upload.
  if (plainObject(object.data) && object.data.__fileRef) {
    if (!mediaType) throw new Error(name + ".media_type is required with uploaded data");
    return { data: object.data, media_type: mediaType };
  }
  const data = optionalString(object.data, name + ".data");
  if (!data) throw new Error(name + ".data must not be empty");
  if (!mediaType) throw new Error(name + ".media_type is required with base64 data");
  return { data: data, media_type: mediaType };
}

function keyframeSet(frames, indexes, name, maxIndex) {
  if (!present(frames) && !present(indexes)) return null;
  if (!Array.isArray(frames) || !Array.isArray(indexes)) throw new Error(name + "keyframes and " + name + "keyframe_indexes must both be arrays");
  if (frames.length < 1 || frames.length > MAX_KEYFRAMES) throw new Error(name + "keyframes must hold 1 to " + MAX_KEYFRAMES + " images");
  if (frames.length !== indexes.length) throw new Error(name + "keyframes and " + name + "keyframe_indexes must have the same length");
  const seen = {};
  const checked = indexes.map(function (index, position) {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || (maxIndex !== null && index > maxIndex))
      throw new Error(name + "keyframe_indexes[" + position + "] must be an integer from 0" + (maxIndex !== null ? " to " + maxIndex : ""));
    if (seen[index]) throw new Error(name + "keyframe_indexes must be unique");
    seen[index] = true;
    return index;
  });
  return {
    keyframes: frames.map(function (frame, position) {
      return mediaRef(frame, name + "keyframes[" + position + "]", { generation: true });
    }),
    keyframe_indexes: checked,
  };
}

function dynamicRange(video) {
  if (video.exr_export && !video.hdr) throw new Error("video.exr_export requires video.hdr");
  return video.hdr ? (video.exr_export ? "hdr_exr" : "hdr") : "sdr";
}

// Validates a Luma request body and keeps only Luma's documented fields, so
// an unlisted field cannot change what the reserved charge covers. The type
// defaults by model: video for ray-3.2, image for uni-1. A channel alias names
// no model, so it needs an explicit type.
function lumaRequest(source, model) {
  if (present(source.callback_url)) throw new Error("callback_url is not supported; query the generation instead");
  let type;
  if (present(source.type)) type = enumValue(source.type, "type", TYPES);
  else if (VIDEO_MODELS.includes(model)) type = "video";
  else if (IMAGE_MODELS.includes(model)) type = "image";
  else throw new Error("type is required");
  if (ALL_MODELS.includes(model)) checkModelType(model, type);
  const prompt = optionalString(source.prompt, "prompt");
  if (!prompt) throw new Error("prompt is required");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("prompt must be at most " + MAX_PROMPT_LENGTH + " characters");
  const body = { type: type, prompt: prompt };
  const userId = optionalString(source.user_id, "user_id");
  if (userId) {
    if (userId.length > 256) throw new Error("user_id must be at most 256 characters");
    body.user_id = userId;
  }
  return isImageType(type) ? imageRequest(source, body) : videoRequest(source, body);
}

// uni-1 images. aspect_ratio and output_format stay unset unless given, so
// the model picks them; neither changes the price.
function imageRequest(source, body) {
  const type = body.type;
  if (present(source.video)) throw new Error("video is only valid for video types");
  if (present(source.aspect_ratio)) body.aspect_ratio = enumValue(source.aspect_ratio, "aspect_ratio", IMAGE_ASPECT_RATIOS);
  if (present(source.style)) body.style = enumValue(source.style, "style", IMAGE_STYLES);
  if (type === "image" && body.style === "manga" && body.aspect_ratio && !MANGA_ASPECT_RATIOS.includes(body.aspect_ratio))
    throw new Error("style manga takes a portrait aspect_ratio: " + MANGA_ASPECT_RATIOS.join(", "));
  if (present(source.output_format)) {
    const format = trimmed(source.output_format).toLowerCase() === "jpg" ? "jpeg" : source.output_format;
    body.output_format = enumValue(format, "output_format", OUTPUT_FORMATS);
  }
  const webSearch = optionalBoolean(source.web_search, "web_search");
  if (webSearch !== undefined) body.web_search = webSearch;
  if (present(source.image_ref)) {
    if (!Array.isArray(source.image_ref)) throw new Error("image_ref must be an array");
    if (source.image_ref.length > MAX_IMAGE_REFS[type]) throw new Error("image_ref takes at most " + MAX_IMAGE_REFS[type] + " images on " + type);
    if (source.image_ref.length)
      body.image_ref = source.image_ref.map(function (ref, index) {
        return mediaRef(ref, "image_ref[" + index + "]", { generation: false });
      });
  }
  if (type === "image_edit") {
    if (!present(source.source)) throw new Error("source is required for image_edit");
    body.source = mediaRef(source.source, "source", { generation: true });
    if (body.source.data && !/^image\//.test(body.source.media_type)) throw new Error("source.media_type must be an image/* type");
    return { action: "image_edit", body: body, range: "sdr" };
  }
  if (present(source.source)) throw new Error("source is only valid for image_edit, video_edit and video_reframe");
  return { action: body.image_ref ? "image_reference" : "text_to_image", body: body, range: "sdr" };
}

// Ray 3.2 videos. Resolution and duration are always sent where they set the
// price, so the charge matches what Luma renders even if its defaults change.
function videoRequest(source, body) {
  const type = body.type;
  if (present(source.image_ref)) throw new Error("image_ref is not supported on video requests");
  for (const key of ["style", "output_format", "web_search"]) {
    if (present(source[key])) throw new Error(key + " is only valid for image types");
  }
  const input = present(source.video) ? plainObject(source.video) : {};
  if (!input) throw new Error("video must be an object");
  const video = {};
  video.resolution = present(input.resolution) ? enumValue(input.resolution, "video.resolution", RESOLUTIONS) : DEFAULT_RESOLUTION;
  if (present(input.duration)) video.duration = durationValue(input.duration);
  const hdr = optionalBoolean(input.hdr, "video.hdr");
  const exr = optionalBoolean(input.exr_export, "video.exr_export");
  const loop = optionalBoolean(input.loop, "video.loop");
  if (hdr !== undefined) video.hdr = hdr;
  if (exr !== undefined) video.exr_export = exr;
  const range = dynamicRange(video);
  if (range !== "sdr" && (video.resolution === "360p" || video.resolution === "540p")) throw new Error("video.hdr requires 720p or 1080p");

  if (present(source.aspect_ratio)) body.aspect_ratio = enumValue(source.aspect_ratio, "aspect_ratio", ASPECT_RATIOS);

  let operation;
  if (type === "video") {
    if (present(source.source)) throw new Error("source is only valid for image_edit, video_edit and video_reframe");
    if (present(input.edit)) throw new Error("video.edit is only valid for video_edit");
    if (present(input.source_position)) throw new Error("video.source_position is only valid for video_reframe");
    if (!video.duration) video.duration = DEFAULT_DURATION;
    const seconds = parseInt(video.duration, 10);
    const startFrame = present(input.start_frame) ? mediaRef(input.start_frame, "video.start_frame", { generation: true }) : null;
    const endFrame = present(input.end_frame) ? mediaRef(input.end_frame, "video.end_frame", { generation: true }) : null;
    const keyframes = keyframeSet(input.keyframes, input.keyframe_indexes, "video.", seconds * FRAMES_PER_SECOND);
    if (keyframes && (startFrame || endFrame)) throw new Error("video.keyframes cannot be combined with video.start_frame or video.end_frame");
    if (keyframes && loop) throw new Error("video.loop cannot be combined with video.keyframes");
    const extensions = [startFrame, endFrame].filter(function (frame) {
      return frame && frame.generation_id;
    });
    if (extensions.length > 1 || (extensions.length === 1 && startFrame && endFrame))
      throw new Error("extending takes exactly one generation_id in video.start_frame or video.end_frame and no other frame");
    if ((startFrame || endFrame) && seconds === 10) throw new Error("video.start_frame and video.end_frame are not supported with a 10s duration");
    if (range !== "sdr" && seconds === 10) throw new Error("video.hdr is not supported with a 10s duration");
    if (loop && (seconds === 10 || range !== "sdr" || endFrame)) throw new Error("video.loop is not supported with a 10s duration, video.hdr or video.end_frame");
    if (extensions.length && range !== "sdr") throw new Error("extending a video supports standard dynamic range only");
    if (startFrame) video.start_frame = startFrame;
    if (endFrame) video.end_frame = endFrame;
    if (keyframes) Object.assign(video, keyframes);
    if (loop !== undefined) video.loop = loop;
    if (extensions.length) operation = "video_extend";
    else operation = startFrame || endFrame || keyframes ? "image_to_video" : "text_to_video";
  } else {
    if (!present(source.source)) throw new Error("source is required for " + type);
    body.source = mediaRef(source.source, "source", { generation: true, video: true });
    if (present(input.end_frame)) throw new Error("video.end_frame is only valid for type video");
    if (present(input.keyframes) || present(input.keyframe_indexes)) throw new Error("use video.edit.keyframes to anchor an edit");
    if (loop !== undefined) throw new Error("video.loop is only valid for type video");
    if (type === "video_edit") {
      if (present(input.source_position)) throw new Error("video.source_position is only valid for video_reframe");
      const startFrame = present(input.start_frame) ? mediaRef(input.start_frame, "video.start_frame", { generation: true }) : null;
      if (startFrame) video.start_frame = startFrame;
      if (present(input.edit)) {
        const edit = plainObject(input.edit);
        if (!edit) throw new Error("video.edit must be an object");
        const out = {};
        const auto = optionalBoolean(edit.auto_controls, "video.edit.auto_controls");
        if (auto !== undefined) out.auto_controls = auto;
        if (present(edit.strength)) out.strength = enumValue(edit.strength, "video.edit.strength", EDIT_STRENGTHS);
        if (present(edit.controls)) {
          if (!plainObject(edit.controls)) throw new Error("video.edit.controls must be an object");
          if (auto) throw new Error("video.edit.controls cannot be combined with auto_controls true");
          out.controls = edit.controls;
        }
        const keyframes = keyframeSet(edit.keyframes, edit.keyframe_indexes, "video.edit.", null);
        if (keyframes && startFrame) throw new Error("video.edit.keyframes cannot be combined with video.start_frame");
        if (keyframes) Object.assign(out, keyframes);
        video.edit = out;
      }
      operation = "video_edit";
    } else {
      if (!body.aspect_ratio) throw new Error("aspect_ratio is required for video_reframe");
      if (range !== "sdr") throw new Error("video_reframe supports standard dynamic range only");
      if (present(input.start_frame) || present(input.edit)) throw new Error("video_reframe does not take video.start_frame or video.edit");
      if (video.resolution === "1080p" && (body.aspect_ratio === "9:16" || body.aspect_ratio === "3:4"))
        throw new Error("video_reframe to a vertical aspect ratio supports up to 720p");
      if (present(input.source_position)) {
        const position = plainObject(input.source_position);
        if (!position) throw new Error("video.source_position must be an object");
        const rect = {};
        for (const key of ["x_norm", "y_norm", "w_norm", "h_norm"]) {
          const number = position[key];
          if (typeof number !== "number" || !Number.isFinite(number)) throw new Error("video.source_position." + key + " must be a number");
          rect[key] = number;
        }
        video.source_position = rect;
      }
      if (!video.duration) video.duration = DEFAULT_DURATION;
      operation = "video_reframe";
    }
  }
  body.video = video;
  return { action: operation, body: body, range: range };
}

// The credits a request reserves on the model the channel sends upstream. An
// edit without a duration reserves the 10-second price, the longest edit Luma
// bills.
function estimatedCredits(request, model) {
  checkModelType(model, request.body.type);
  let credits;
  if (isImageType(request.body.type)) {
    credits = IMAGE_BASE_CREDITS[model] + (request.body.source ? 1 : 0) + (request.body.image_ref || []).length;
  } else {
    const video = request.body.video;
    const seconds = video.duration ? parseInt(video.duration, 10) : 10;
    if (request.action === "video_extend") credits = EXTEND_CREDITS[video.resolution];
    else if (request.action === "video_reframe") credits = REFRAME_CREDITS_PER_SECOND[video.resolution] * seconds;
    else if (request.action === "video_edit") credits = EDIT_CREDITS[video.resolution][seconds] * EDIT_DYNAMIC_RANGE_FACTOR[request.range];
    else credits = (GENERATION_CREDITS[request.range][video.resolution] || {})[seconds];
  }
  if (!(credits > 0)) throw new Error("this combination of resolution, duration and HDR has no Luma price");
  return Math.min(credits, MAX_CREDITS);
}

// Every generation id the body names, in the positions Luma reads them.
function generationIds(body) {
  const ids = [];
  const add = function (ref) {
    if (ref && ref.generation_id && !ids.includes(ref.generation_id)) ids.push(ref.generation_id);
  };
  const video = body.video || {};
  add(body.source);
  add(video.start_frame);
  add(video.end_frame);
  (video.keyframes || []).forEach(add);
  ((video.edit && video.edit.keyframes) || []).forEach(add);
  return ids;
}

// Replaces gateway task ids with the Luma generation ids of the tasks the
// gateway resolved for this request.
function withUpstreamIds(body, originTasks) {
  const ids = {};
  for (const task of originTasks || []) {
    if (task && task.taskId && trimmed(task.upstreamTaskId)) ids[task.taskId] = trimmed(task.upstreamTaskId);
  }
  const swap = function (ref) {
    if (!ref || !ref.generation_id) return ref;
    const id = ids[ref.generation_id];
    if (!id) throw new Error("generation " + ref.generation_id + " is not available");
    return { generation_id: id };
  };
  const out = Object.assign({}, body);
  if (out.source) out.source = swap(out.source);
  if (out.video) {
    const video = Object.assign({}, out.video);
    if (video.start_frame) video.start_frame = swap(video.start_frame);
    if (video.end_frame) video.end_frame = swap(video.end_frame);
    if (video.keyframes) video.keyframes = video.keyframes.map(swap);
    if (video.edit && video.edit.keyframes) video.edit = Object.assign({}, video.edit, { keyframes: video.edit.keyframes.map(swap) });
    out.video = video;
  }
  return out;
}

function submitIntent(model, request) {
  const intent = { kind: "submit", model: model, action: request.action, requestBody: Object.assign({}, request.body, { model: model }) };
  const ids = generationIds(request.body);
  if (ids.length) intent.originTaskIds = ids;
  return intent;
}

function imageMimeType(url) {
  const path = trimmed(url).split("?")[0].toLowerCase();
  if (/\.png$/.test(path)) return "image/png";
  if (/\.jpe?g$/.test(path)) return "image/jpeg";
  return "";
}

// The artifact key of each output entry: the first video is "video", images
// are "image-1", "image-2", ... in output order; other entries have none.
function outputKeys(output) {
  let images = 0;
  let video = false;
  return (Array.isArray(output) ? output : []).map(function (item) {
    if (!plainObject(item) || !trimmed(item.url)) return "";
    if (item.type === "video" && !video) {
      video = true;
      return "video";
    }
    if (item.type === "image") return "image-" + ++images;
    return "";
  });
}

// The deliverables of a completed generation, each with its Luma URL.
function artifactEntries(data) {
  const object = plainObject(data);
  if (!object || object.state !== "completed" || !Array.isArray(object.output)) return [];
  const keys = outputKeys(object.output);
  const entries = [];
  object.output.forEach(function (item, index) {
    if (!keys[index]) return;
    const entry = { key: keys[index], type: item.type, url: trimmed(item.url) };
    const mimeType = item.type === "video" ? "video/mp4" : imageMimeType(item.url);
    if (mimeType) entry.mimeType = mimeType;
    entries.push(entry);
  });
  return entries;
}

function failureReason(data) {
  const object = plainObject(data) || {};
  const reason = trimmed(object.failure_reason);
  const code = trimmed(object.failure_code);
  if (reason && code) return reason + " (" + code + ")";
  return reason || code || "generation failed";
}

// Luma's generation object without the account details it carries (team,
// usage). Output URLs become the gateway's download addresses, which do not
// expire after an hour as Luma's presigned URLs do.
function publicGeneration(data, taskId, artifacts) {
  const object = plainObject(data) || {};
  const out = { id: taskId };
  for (const key of ["type", "state", "model", "created_at", "failure_reason", "failure_code", "user_id"]) {
    if (object[key] !== undefined) out[key] = object[key];
  }
  const output = Array.isArray(object.output) ? object.output : [];
  const keys = outputKeys(output);
  out.output = output.map(function (item, index) {
    const entry = Object.assign({}, plainObject(item) || {});
    const artifact = artifacts && keys[index] ? artifacts[keys[index]] : null;
    if (artifact && trimmed(artifact.url)) entry.url = trimmed(artifact.url);
    return entry;
  });
  return out;
}

export const native = {
  // Luma's own body. A model is required, as the route checks.
  createGeneration: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = plainObject(ctx.body.value);
    if (!body) throw new Error("request body must be an object");
    const model = trimmed(body.model);
    if (!model) throw new Error("model is required");
    return submitIntent(model, lumaRequest(body, model));
  },
  generationCreated: function (ctx, task) {
    return publicGeneration(task.data, task.task_id, null);
  },
  generationStatus: function (ctx, task) {
    const data = plainObject(task.data) || {};
    // The gateway can fail a task Luma still reports as running, after poll
    // failures or the task timeout.
    if (task.status === "FAILURE" && data.state !== "failed") {
      return Object.assign(publicGeneration(data, task.task_id, null), {
        state: "failed",
        failure_reason: task.fail_reason || "generation failed",
        failure_code: "gateway_failed",
      });
    }
    return publicGeneration(data, task.task_id, ctx.artifacts);
  },
  error: function (ctx, error) {
    return { detail: error.message, error: { code: error.code } };
  },
};

export function buildSubmitRequest(ctx) {
  const model = upstreamModel(ctx);
  const request = lumaRequest(ctx.requestBody || {}, model);
  checkModelType(model, request.body.type);
  const body = withUpstreamIds(request.body, ctx.originTasks);
  body.model = model;
  return {
    url: ctx.baseUrl + "/v1/generations",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: request.action,
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = plainObject(resp.body);
  const id = body ? trimmed(body.id) : "";
  if (!id) throw new Error("Luma did not return a generation id");
  return { taskId: id, taskData: body };
}

export function extractUsage(ctx) {
  // Legacy per-call prices have no ratio to scale.
  if (ctx.usagePurpose === "billing_ratios") return null;
  const model = upstreamModel(ctx);
  return { credits: estimatedCredits(lumaRequest(ctx.requestBody || {}, model), model) };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/generations/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(ctx, body) {
  const data = plainObject(body);
  const state = data ? data.state : undefined;
  if (state === "queued") return { status: "QUEUED" };
  if (state === "processing" || state === "dreaming") return { status: "IN_PROGRESS" };
  if (state === "completed") return artifactEntries(data).length ? { status: "SUCCESS" } : { status: "FAILURE", reason: "Luma returned no output" };
  // Luma refunds failed generations, except a budget_exhausted one it may
  // charge in part; the gateway refunds them all.
  if (state === "failed") return { status: "FAILURE", reason: failureReason(data) };
  return { status: "UNKNOWN", reason: "unrecognized state: " + String(state || "") };
}

// Luma reports what it charged once billing settles, which can come after the
// output is done. A missing or zero count (such as on Provisioned Throughput)
// keeps the reserved list price.
export function extractUsageOnComplete(task, result, body) {
  const data = plainObject(body);
  if (!data || data.state !== "completed") return null;
  const usage = plainObject(data.usage);
  const credits = usage ? Number(usage.credits_charged) : NaN;
  if (!(credits > 0) || !Number.isFinite(credits)) return null;
  return { credits: Math.min(credits, MAX_CREDITS) };
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  return artifactEntries(task.data).map(function (entry) {
    const artifact = { key: entry.key, type: entry.type };
    if (entry.mimeType) artifact.mimeType = entry.mimeType;
    return artifact;
  });
}

function artifactURL(data, key) {
  for (const entry of artifactEntries(data)) {
    if (entry.key === key) return entry.url;
  }
  return "";
}

// Luma's output URLs expire after an hour, so a download asks Luma for a
// fresh one first and falls back to the URL from the last poll.
export function buildContentRequest(ctx) {
  let url = "";
  if (trimmed(ctx.upstreamTaskId)) {
    try {
      const response = utils.fetch({
        url: ctx.baseUrl + "/v1/generations/" + encodeURIComponent(ctx.upstreamTaskId),
        headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
      });
      if (response.status === 200) url = artifactURL(response.body, ctx.artifactKey);
    } catch (_error) {
      url = "";
    }
  }
  if (!url) url = artifactURL(ctx.data, ctx.artifactKey);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

function nearestRatio(width, height, ratios) {
  let best = ratios[0];
  let nearest = Infinity;
  for (const ratio of ratios) {
    const sides = ratio.split(":").map(Number);
    const distance = Math.abs(Math.log(width / height) - Math.log(sides[0] / sides[1]));
    if (distance < nearest) {
      nearest = distance;
      best = ratio;
    }
  }
  return best;
}

function sizeParts(size, hint) {
  const parts = trimmed(size).toLowerCase().replace("*", "x").split("x");
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (parts.length !== 2 || !(width > 0) || !(height > 0)) throw new Error("size must be WIDTHxHEIGHT" + hint);
  return { width: width, height: height };
}

// OpenAI-style WIDTHxHEIGHT sizes select the nearest Luma aspect ratio and
// the resolution of the shorter side.
function sizeOptions(size) {
  const text = trimmed(size).toLowerCase();
  if (RESOLUTIONS.includes(text)) return { resolution: text };
  const sides = sizeParts(text, " or one of " + RESOLUTIONS.join(", "));
  const shorter = Math.min(sides.width, sides.height);
  const resolution = shorter >= 1080 ? "1080p" : shorter >= 720 ? "720p" : shorter >= 540 ? "540p" : "360p";
  return { aspect_ratio: nearestRatio(sides.width, sides.height, ASPECT_RATIOS), resolution: resolution };
}

function booleanField(value, name) {
  if (value === undefined || typeof value === "boolean") return value;
  if (value === "true" || value === "false") return value === "true";
  throw new Error(name + " must be true or false");
}

// The OpenAI video API: prompt, seconds, size and input_reference (the first
// frame), plus Luma's aspect_ratio, resolution, loop and hdr.
function openAIVideoRequest(req, model) {
  const video = {};
  const sized = given(req.size) ? sizeOptions(req.size) : {};
  const seconds = given(req.seconds) ? req.seconds : req.duration;
  if (given(seconds)) video.duration = durationValue(seconds);
  const resolution = given(req.resolution) ? req.resolution : sized.resolution;
  if (resolution) video.resolution = resolution;
  const loop = booleanField(req.loop, "loop");
  const hdr = booleanField(req.hdr, "hdr");
  if (loop !== undefined) video.loop = loop;
  if (hdr !== undefined) video.hdr = hdr;
  if (given(req.input_reference)) video.start_frame = req.input_reference;
  const source = { type: "video", prompt: req.prompt, video: video };
  const aspectRatio = given(req.aspect_ratio) ? req.aspect_ratio : sized.aspect_ratio;
  if (aspectRatio) source.aspect_ratio = aspectRatio;
  if (given(req.user)) source.user_id = req.user;
  return lumaRequest(source, model);
}

// An OpenAI image given as a URL string, {image_url}, {url} or Luma's own
// reference object.
function openAIImage(value) {
  const object = plainObject(value);
  if (object && present(object.image_url)) return typeof object.image_url === "string" ? object.image_url : plainObject(object.image_url) ? object.image_url.url : object.image_url;
  return value;
}

// The OpenAI Images API: prompt, size (the nearest Luma aspect ratio) and
// output_format, plus Luma's aspect_ratio, style, web_search and image_ref.
// An edit's first image is the source and the others are references. Luma
// returns one image, so n is 1.
function openAIImageRequest(req, operation, images, model) {
  if (given(req.n) && Number(req.n) !== 1) throw new Error("n must be 1; Luma returns one image per request");
  if (given(req.mask)) throw new Error("mask is not supported; describe the edit in the prompt");
  const source = { type: operation === "edit" ? "image_edit" : "image", prompt: req.prompt };
  if (given(req.aspect_ratio)) source.aspect_ratio = req.aspect_ratio;
  else if (given(req.size) && trimmed(req.size).toLowerCase() !== "auto") {
    const sides = sizeParts(req.size, " or auto");
    source.aspect_ratio = nearestRatio(sides.width, sides.height, IMAGE_ASPECT_RATIOS);
  }
  if (given(req.style)) source.style = req.style;
  if (given(req.output_format)) source.output_format = req.output_format;
  const webSearch = booleanField(req.web_search, "web_search");
  if (webSearch !== undefined) source.web_search = webSearch;
  if (given(req.user)) source.user_id = req.user;
  const refs = images.slice();
  if (operation === "edit") {
    if (!refs.length) throw new Error("image is required");
    source.source = refs.shift();
  }
  if (present(req.image_ref)) {
    if (!Array.isArray(req.image_ref)) throw new Error("image_ref must be an array");
    refs.push.apply(refs, req.image_ref);
  }
  if (refs.length) source.image_ref = refs;
  return lumaRequest(source, model);
}

function protocolModel(ctx) {
  try {
    return upstreamModel({ upstreamModel: ctx.upstreamModel, model: ctx.model });
  } catch (_error) {
    return trimmed(ctx.model);
  }
}

// Multipart text fields, each given once.
function formFields(body) {
  const req = {};
  const fields = body.fields || {};
  for (const name of Object.keys(fields)) {
    if (fields[name].length > 1) throw new Error(name + " must be provided once");
    req[name] = fields[name][0];
  }
  return req;
}

function uploadedImage(file, name) {
  if (!/^image\//.test(file.mimeType || "")) throw new Error(name + " must be an image");
  return { data: { __fileRef: file.ref, encoding: "base64" }, media_type: file.mimeType };
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
      let req;
      if (ctx.body.kind === "json") {
        req = plainObject(ctx.body.value);
        if (!req) throw new Error("JSON object required");
        if (present(req.input_reference)) req = Object.assign({}, req, { input_reference: openAIImage(req.input_reference) });
      } else {
        req = formFields(ctx.body);
        const files = ctx.body.files || [];
        for (const file of files) {
          if (file.field !== "input_reference") throw new Error("unexpected file field: " + file.field);
        }
        if (files.length > 1) throw new Error("input_reference must be provided once");
        if (files.length) req.input_reference = uploadedImage(files[0], "input_reference");
      }
      const request = openAIVideoRequest(req, protocolModel(ctx));
      return submitIntent(ctx.model, request);
    },
    // The host owns id, status, progress and timestamps.
    render: function (ctx, task) {
      const data = plainObject(task.data) || {};
      const output = { object: "video" };
      if (task.status === "FAILURE")
        output.error = { code: trimmed(data.failure_code) || "video_generation_failed", message: task.fail_reason || failureReason(data) };
      return output;
    },
  },
  openai_image: {
    decodeRequest: function (ctx) {
      if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
      const operation = ctx.operation === "edit" ? "edit" : "generate";
      let req;
      let images = [];
      if (ctx.body.kind === "json") {
        req = plainObject(ctx.body.value);
        if (!req) throw new Error("JSON object required");
        if (present(req.images)) {
          if (!Array.isArray(req.images)) throw new Error("images must be an array");
          images = req.images.map(openAIImage);
        }
        if (present(req.image)) images = (Array.isArray(req.image) ? req.image : [req.image]).map(openAIImage).concat(images);
      } else {
        req = formFields(ctx.body);
        for (const file of ctx.body.files || []) {
          if (file.field !== "image" && file.field !== "image[]") throw new Error("unexpected file field: " + file.field);
          images.push(uploadedImage(file, "image"));
        }
        if (given(req.image)) images.unshift(req.image);
      }
      if (operation === "generate" && images.length) throw new Error("image is only valid on /v1/images/edits; use image_ref for reference images");
      const request = openAIImageRequest(req, operation, images, protocolModel(ctx));
      return submitIntent(ctx.model, request);
    },
    render: function (ctx, task) {
      return {
        data: artifactEntries(task.data)
          .filter(function (entry) {
            return entry.type === "image";
          })
          .map(function (entry) {
            return { url: entry.url };
          }),
      };
    },
  },
};
