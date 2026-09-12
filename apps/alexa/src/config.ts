/**
 * Config for hosting targets that cannot set environment variables.
 *
 * Alexa-hosted skills give you no env-var editor on the Lambda, so the backend
 * URL/key are baked into the bundle at build time via esbuild `--define`
 * (see scripts/build-hosted.sh). Real env vars still win, so local/dev and a
 * self-managed Lambda keep working unchanged.
 */
import { RelayClient } from "@relay/contract/client";
import { setRelay } from "./handlers.js";

declare const __RELAY_API_URL__: string;
declare const __RELAY_API_KEY__: string;

// `typeof` guard so this is safe when the defines are absent (tsx, local, smoke).
const bakedUrl = typeof __RELAY_API_URL__ === "string" ? __RELAY_API_URL__ : "";
const bakedKey = typeof __RELAY_API_KEY__ === "string" ? __RELAY_API_KEY__ : "";

export function applyBakedConfig(): void {
  const baseUrl = process.env.RELAY_API_URL || bakedUrl;
  if (!baseUrl) return; // nothing baked, nothing in env: fromEnv() will throw loudly
  setRelay(new RelayClient({ baseUrl, apiKey: process.env.RELAY_API_KEY || bakedKey || undefined }));
}
