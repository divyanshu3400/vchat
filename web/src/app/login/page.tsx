import type { Metadata } from "next";
import LoginForm from "@/components/account/LoginForm";
import { Logo } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to your saved vChat account.",
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <main className="auth-page">
      <Logo />
      <LoginForm />
    </main>
  );
}
