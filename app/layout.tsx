import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ChatWidget } from "./components/chat/ChatWidget";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "AsBuilt IQ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${poppins.variable} ${jetbrainsMono.variable} font-sans bg-[#f4f6fb] text-[#1e293b] h-screen overflow-hidden`}
      >
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
