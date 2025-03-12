import "./globals.css";

export const metadata = {
  title: "Receive Calls on Chatwoot using Twilio and Dyte",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
