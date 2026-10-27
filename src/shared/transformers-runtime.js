// Configures @xenova/transformers' ONNX Runtime WASM backend to run
// inside a Manifest V3 service worker and sidepanel with local model loading.

import { env } from "@xenova/transformers";

env.allowRemoteModels = false;
env.allowLocalModels = true;

if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
  env.localModelPath = chrome.runtime.getURL("models/");
}

env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;