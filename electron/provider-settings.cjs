"use strict";

const { safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { writeLocalJson } = require("./local-json.cjs");

const providerNames = ["gemini", "openai", "anthropic", "ollama"];

function settingsPath(home) {
  return path.join(home, ".orbit", "desktop-providers.json");
}

function readSettings(home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(home), "utf-8"));
    const profiles = {};
    for (const name of providerNames) {
      const profile = parsed.profiles?.[name];
      if (profile && typeof profile === "object") profiles[name] = profile;
    }
    return { defaultProvider: providerNames.includes(parsed.defaultProvider) ? parsed.defaultProvider : "", profiles };
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Orbit no pudo leer la configuración de proveedores.");
    return { defaultProvider: "", profiles: {} };
  }
}

function publicSettings(home) {
  const settings = readSettings(home);
  return {
    defaultProvider: settings.defaultProvider,
    profiles: Object.fromEntries(Object.entries(settings.profiles).map(([name, profile]) => [
      name, { model: profile.model, baseUrl: profile.baseUrl, liveModel: profile.liveModel, hasKey: Boolean(profile.encryptedKey) },
    ])),
  };
}

function boundedString(value, maxLength) {
  if (typeof value !== "string" || value.length > maxLength || /[\r\n\u0000]/.test(value)) {
    throw new Error("Hay un valor inválido en la configuración del proveedor.");
  }
  return value.trim();
}

function saveProvider(home, input) {
  const name = input?.provider;
  if (!providerNames.includes(name)) throw new Error("Selecciona un proveedor de Orbit.");
  const settings = readSettings(home);
  const previous = settings.profiles[name] || {};
  const profile = {
    model: boundedString(input.model, 250),
    baseUrl: boundedString(input.baseUrl, 2048),
    liveModel: name === "gemini" ? boundedString(input.liveModel, 250) : "",
    encryptedKey: previous.encryptedKey,
  };
  if (profile.baseUrl) {
    const endpoint = new URL(profile.baseUrl);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
      throw new Error("Usa una URL base HTTP o HTTPS sin credenciales ni parámetros.");
    }
    profile.baseUrl = endpoint.href.replace(/\/+$/, "");
  }
  const apiKey = name === "ollama" ? "" : boundedString(input.apiKey, 2048);
  if (input.removeKey) profile.encryptedKey = undefined;
  if (apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("El cifrado del sistema no está disponible. Configura la clave en .env.");
    profile.encryptedKey = safeStorage.encryptString(apiKey).toString("base64");
  }
  settings.profiles[name] = profile;
  if (input.useByDefault) settings.defaultProvider = name;
  else if (settings.defaultProvider === name) settings.defaultProvider = "";

  writeLocalJson(settingsPath(home), settings);
  return publicSettings(home);
}

function providerEnvironment(home, onWarning) {
  const settings = readSettings(home);
  const env = {};
  if (settings.defaultProvider) env.ORBIT_PROVIDER = settings.defaultProvider;
  for (const [name, profile] of Object.entries(settings.profiles)) {
    const prefix = name.toUpperCase();
    if (profile.model) env[prefix + "_MODEL"] = profile.model;
    if (profile.baseUrl) env[prefix + "_BASE_URL"] = profile.baseUrl;
    if (profile.liveModel && name === "gemini") env.GEMINI_LIVE_MODEL = profile.liveModel;
    if (!profile.encryptedKey || !safeStorage.isEncryptionAvailable()) continue;
    try {
      env[prefix + "_API_KEY"] = safeStorage.decryptString(Buffer.from(profile.encryptedKey, "base64"));
    } catch {
      onWarning("Orbit no pudo recuperar la clave guardada de " + name + ".");
    }
  }
  return env;
}

module.exports = { publicSettings, saveProvider, providerEnvironment };
