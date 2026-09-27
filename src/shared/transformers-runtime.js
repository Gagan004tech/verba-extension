// Configures @xenova/transformers' ONNX Runtime WASM backend to run
// inside a Manifest V3 service worker.
//
// MV3 service workers don't implement URL.createObjectURL - onnxruntime-web's
// default backend uses it for multi-threading (a Blob-URL worker pool) and
// for "proxy" mode (offloading inference to a worker to protect a UI thread).
// A service worker has neither a UI thread to protect nor the ability to
// spawn that worker pool, so both are disabled below.

import { env } from "@xenova/transformers";

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;