type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  const write = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    const entry = {
      level,
      scope,
      message,
      time: new Date().toISOString(),
      ...(context ? { context: redactContext(context) } : {})
    };

    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context)
  };
}

function redactContext(context: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      const normalized = key.toLowerCase();
      if (normalized.includes("token") || normalized.includes("secret") || normalized.includes("password")) {
        return [key, "[redacted]"];
      }
      return [key, value];
    })
  );
}
