import "./globals.css";

export const metadata = {
  title: "throTl",
  description: "A hands-on lab for understanding rate limiting."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
