import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "タンク管理",
    short_name: "タンク管理",
    description: "ダイビングタンクのレンタル管理システム",
    start_url: "/staff",
    display: "standalone",
    // background_color = アプリ基底面（--bg-primary）、theme_color = ヘッダー背面。
    // 起動時に別色の flash が出ないようにするため
    background_color: "#f4f6fa",
    theme_color: "#fafbfd",
    icons: [
      {
        src: "/manifest-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/manifest-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
