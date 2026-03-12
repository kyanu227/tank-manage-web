import { Inter } from "next/font/google";
import "@/app/globals.css";
import { AuthProvider } from "@/lib/contexts/AuthContext";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${inter.className} antialiased`}>
        <AuthProvider>
          <div className="page-wrapper min-h-screen bg-slate-50">
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
