import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "mado",
    identifier: "com.ridgeroot.mado",
    version: "0.4.1",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      // github-markdown-css: GitHub 互換スタイリング
      "node_modules/github-markdown-css/github-markdown.css": "views/mainview/github-markdown.css",
      // highlight.js: コードブロックのシンタックスハイライト用テーマ
      "node_modules/highlight.js/styles/github.css": "views/mainview/hljs-github.css",
      "node_modules/highlight.js/styles/github-dark.css": "views/mainview/hljs-github-dark.css",
    },
    mac: {
      // codesign: Electrobun が helper / launcher / framework まで全署名する。
      //   `ELECTROBUN_DEVELOPER_ID` env が必要（"Developer ID Application: ..."）。
      // notarize: false に固定。公証は Electrobun ではなく fastlane の
      //   `notarize_app` lane に外出し（fastlane/Fastfile 参照）。
      //   理由: ~/git/.envrc が fastlane 流の APP_STORE_CONNECT_API_KEY_*
      //   を持っており、PEM の path 化を fastlane の app_store_connect_api_key
      //   action に任せると tempfile 管理が完結する。詳細は docs/signing-setup.md。
      codesign: true,
      notarize: false,
      createDmg: true,
      entitlements: {
        // Bun runtime の JIT に必要（hardened runtime 下でも JIT を許可）
        "com.apple.security.cs.allow-jit": true,
        // bun の動的コード生成に必要
        "com.apple.security.cs.allow-unsigned-executable-memory": true,
        // node-gyp 系の動的ライブラリ読み込みに必要
        "com.apple.security.cs.disable-library-validation": true,
      },
      // App icon。Electrobun が iconutil で .icns に変換して
      // Contents/Resources/AppIcon.icns に配置する。
      // master SVG: assets/icon.svg
      icons: "assets/icon.iconset",
    },
  },
} satisfies ElectrobunConfig;
