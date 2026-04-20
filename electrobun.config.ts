import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "mado",
    identifier: "dev.mado.app",
    version: "0.2.0",
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
  },
} satisfies ElectrobunConfig;
