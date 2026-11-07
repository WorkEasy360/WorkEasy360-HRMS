import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { FeedbackProvider } from "@/components/feedback";
import { AuthProvider } from "@/lib/auth-context";
import { themeScript } from "@/ui";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "WorkEasy360 HRMS", template: "%s · WorkEasy360" },
  description: "Attendance, leave, payroll and people management for your organization.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Applies a saved theme choice before first paint, so dark never flashes light. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-canvas text-body">
        <AuthProvider>
          <FeedbackProvider>{children}</FeedbackProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
