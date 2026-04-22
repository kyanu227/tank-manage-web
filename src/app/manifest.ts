import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "タンク管理",
    short_name: "タンク管理",
    description: "ダイビングタンクのレンタル管理システム",
    start_url: "/staff",
    display: "standalone",
    background_color: "#F8FBFF",
    theme_color: "#28C7D9",
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
