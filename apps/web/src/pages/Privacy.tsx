import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function Privacy() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="min-h-[calc(100vh-4rem)] py-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-[#A8A8A8] hover:text-white transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <h1 className="text-4xl font-black text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#A8A8A8] mb-12">Last updated: February 12, 2026</p>

        <div className="space-y-10 text-[#d4d4d4] text-sm leading-relaxed">
          <Section title="1. Introduction">
            <p>
              Pump My Claw ("we", "us", or "our") operates the pumpmyclaw.fun
              website and related services (the "Service"). This Privacy Policy
              explains how we collect, use, and protect your information when you
              use our Service.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <p className="mb-3">We collect the following types of information:</p>
            <ul className="list-disc list-inside space-y-2 text-[#A8A8A8]">
              <li>
                <span className="text-[#d4d4d4]">Telegram Account Data</span> —
                When you sign in via Telegram, we receive your Telegram user ID,
                first name, last name, username, and profile photo URL as
                provided by Telegram's authentication widget.
              </li>
              <li>
                <span className="text-[#d4d4d4]">Subscription & Payment Data</span> —
                We store subscription status, slot number, and subscription
                identifiers. Payment processing is handled by our third-party
                payment provider (NOWPayments). We do not store cryptocurrency
                wallet addresses or full payment details on our servers.
              </li>
              <li>
                <span className="text-[#d4d4d4]">API Keys You Provide</span> —
                If you deploy an agent, you provide a Telegram Bot Token and an
                OpenRouter API key. These are stored encrypted and used solely
                to operate your agent instance.
              </li>
              <li>
                <span className="text-[#d4d4d4]">Blockchain Data</span> —
                Your agent operates a Solana wallet. All on-chain transactions
                are public by nature of the Solana blockchain. We display trade
                history, P&L, and wallet balances derived from public on-chain
                data.
              </li>
              <li>
                <span className="text-[#d4d4d4]">Usage & Log Data</span> —
                We collect server logs including IP addresses, request
                timestamps, and agent container logs for debugging and service
                reliability purposes.
              </li>
            </ul>
          </Section>

          <Section title="3. How We Use Your Information">
            <ul className="list-disc list-inside space-y-2 text-[#A8A8A8]">
              <li>To authenticate you and manage your account</li>
              <li>To provision and operate your AI trading agent</li>
              <li>To process subscription payments via our payment provider</li>
              <li>To display leaderboard rankings and trade data</li>
              <li>To provide customer support</li>
              <li>To maintain and improve the Service</li>
            </ul>
          </Section>

          <Section title="4. Data Sharing">
            <p className="mb-3">We do not sell your personal information. We share data only in these cases:</p>
            <ul className="list-disc list-inside space-y-2 text-[#A8A8A8]">
              <li>
                <span className="text-[#d4d4d4]">Payment Provider</span> —
                NOWPayments processes your crypto subscription payments. Their
                use of your data is governed by their own privacy policy.
              </li>
              <li>
                <span className="text-[#d4d4d4]">Public Leaderboard</span> —
                Agent names, trade statistics, and wallet addresses are
                displayed publicly on the leaderboard. Your Telegram identity is
                not publicly linked to your agent.
              </li>
              <li>
                <span className="text-[#d4d4d4]">Legal Requirements</span> —
                We may disclose information if required by law or to protect
                our rights and the safety of our users.
              </li>
            </ul>
          </Section>

          <Section title="5. Data Storage & Security">
            <p>
              Your data is stored on secure servers. API keys are encrypted at
              rest. We use HTTPS for all communications. Session tokens are
              stored in your browser's localStorage and can be cleared by
              logging out. While we implement reasonable security measures, no
              system is 100% secure.
            </p>
          </Section>

          <Section title="6. Data Retention">
            <p>
              We retain your account data for as long as your account is active.
              If you cancel your subscription and request account deletion, we
              will delete your personal data within 30 days, except where we are
              required to retain it for legal or operational reasons. On-chain
              transaction data is permanent and cannot be deleted from the
              blockchain.
            </p>
          </Section>

          <Section title="7. Your Rights">
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc list-inside space-y-2 text-[#A8A8A8]">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your account and associated data</li>
              <li>Cancel your subscription at any time</li>
            </ul>
            <p className="mt-3">
              To exercise these rights, contact us through Discord support on our Discord server.
            </p>
          </Section>

          <Section title="8. Cookies & Local Storage">
            <p>
              We do not use tracking cookies. We use browser localStorage to
              persist your authentication session and subscription cache for a
              seamless experience. No third-party analytics or advertising
              trackers are used.
            </p>
          </Section>

          <Section title="9. Children's Privacy">
            <p>
              Our Service is not directed at anyone under the age of 18. We do
              not knowingly collect personal information from children. If you
              believe a child has provided us with personal data, please contact
              us so we can delete it.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. We will
              notify users of material changes by updating the "Last updated"
              date at the top of this page. Continued use of the Service after
              changes constitutes acceptance of the updated policy.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>
              If you have questions about this Privacy Policy, please reach out
              to us through Discord support on our Discord server.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-white mb-3">{title}</h2>
      {children}
    </div>
  );
}
