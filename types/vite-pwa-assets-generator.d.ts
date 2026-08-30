declare module '@vite-pwa/assets-generator/config' {
  export type BuiltInPreset = string;
  export interface Preset {
    name?: string;
  }
}

declare module '@vite-pwa/assets-generator/api' {
  export interface ImageAssetsInstructions {
    [key: string]: unknown;
  }
  export interface IconAsset<T = unknown> {
    buffer?: Uint8Array;
    htmlLink?: T;
    [key: string]: unknown;
  }
  export interface FaviconLink {
    [key: string]: unknown;
  }
  export interface HtmlLink {
    [key: string]: unknown;
  }
  export interface AppleSplashScreenLink {
    [key: string]: unknown;
  }
  export interface HtmlLinkPreset {
    [key: string]: unknown;
  }
}
