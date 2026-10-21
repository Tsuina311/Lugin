interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly VITE_LUGIN_GOLDFISH_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
