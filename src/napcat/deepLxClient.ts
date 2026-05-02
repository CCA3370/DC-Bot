import type { AppConfig } from "../shared/config.js";

type DeepLxConfig = AppConfig["deeplx"];

interface DeepLxTranslationResponse {
  data?: unknown;
  translations?: Array<{ text?: unknown }>;
  result?: unknown;
}

export class DeepLxClient {
  constructor(private config: DeepLxConfig) {}

  getConfig() {
    return { ...this.config };
  }

  updateConfig(config: DeepLxConfig) {
    this.config = { ...config };
  }

  isConfigured() {
    return this.config.endpoint.length > 0;
  }

  async translateToChinese(text: string) {
    const sourceText = text.trim();
    if (!this.isConfigured() || sourceText.length === 0) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.endpoint}/translate`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {})
        },
        body: JSON.stringify({
          text: sourceText,
          source_lang: "auto",
          target_lang: "ZH"
        })
      });

      if (!response.ok) {
        throw new Error(`DeepLX translate failed with HTTP ${response.status}`);
      }

      return parseDeepLxTranslationResponse(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseDeepLxTranslationResponse(body: unknown) {
  const response = body as DeepLxTranslationResponse;
  const directData = parseTranslationValue(response.data);
  if (directData) {
    return directData;
  }

  const translatedText = response.translations?.[0]?.text;
  if (typeof translatedText === "string" && translatedText.trim().length > 0) {
    return translatedText.trim();
  }

  if (typeof response.result === "string" && response.result.trim().length > 0) {
    return response.result.trim();
  }

  throw new Error("DeepLX translate returned an invalid response");
}

function parseTranslationValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "translation", "translatedText"]) {
    const translated = record[key];
    if (typeof translated === "string" && translated.trim().length > 0) {
      return translated.trim();
    }
  }

  return null;
}
