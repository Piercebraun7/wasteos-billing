import type { Metadata } from "next";
import { Geist_Mono, Rethink_Sans, Roboto_Flex } from "next/font/google";
import "./globals.css";

// Kaizen brand fonts: Rethink Sans for headlines, Roboto Flex for body.
const rethink = Rethink_Sans({ variable: "--font-rethink", subsets: ["latin"] });
const robotoFlex = Roboto_Flex({ variable: "--font-roboto-flex", subsets: ["latin"] });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kaizen Billing",
  description: "Billing and accounts receivable for Kaizen Waste, LLC",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${rethink.variable} ${robotoFlex.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
