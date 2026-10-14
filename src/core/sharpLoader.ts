export type SharpInstance = {
  jpeg: (options?: Record<string, unknown>) => SharpInstance;
  png: (options?: Record<string, unknown>) => SharpInstance;
  webp: (options?: Record<string, unknown>) => SharpInstance;
  gif: (options?: Record<string, unknown>) => SharpInstance;
  tiff: (options?: Record<string, unknown>) => SharpInstance;
  avif: (options?: Record<string, unknown>) => SharpInstance;
  raw: (options?: Record<string, unknown>) => SharpInstance;
  resize: (options?: Record<string, unknown>) => SharpInstance;
  toBuffer: () => Promise<Buffer>;
  toFile: (path: string) => Promise<unknown>;
};

type SharpFactory = (input?: unknown, options?: unknown) => SharpInstance;

let cached: SharpFactory | null | undefined;

export async function loadSharp(): Promise<{
  sharp: SharpFactory | null;
  message: string;
}> {
  if (cached !== undefined) {
    return {
      sharp: cached,
      message: cached ? "sharp loaded." : "sharp is unavailable (optional dependency).",
    };
  }
  try {
    const mod = await import("sharp");
    const factory = (mod.default ?? mod) as unknown as SharpFactory;
    cached = factory;
    return { sharp: factory, message: "sharp loaded." };
  } catch {
    cached = null;
    return {
      sharp: null,
      message:
        "sharp could not be loaded (optional dependency). " +
        "Pixel-hash and fixture generation are disabled. Fix: npm install sharp.",
    };
  }
}
